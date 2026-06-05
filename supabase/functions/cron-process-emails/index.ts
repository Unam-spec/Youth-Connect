// Scheduled function: drains the pending_emails queue (replaces the old 60s
// setInterval emailProcessor). Invoked every minute by Supabase Cron (pg_cron + pg_net).
// No auth (verify_jwt false); only callable internally via the cron http_post.
import { eq, sql } from "npm:drizzle-orm@0.45.2";
import { db } from "../_shared/db.ts";
import { pendingEmailsTable } from "../_shared/schema.ts";
import { sendEmail } from "../_shared/email.ts";

interface PendingRow {
  id: string;
  to_address: string;
  subject: string;
  body_html: string;
}

Deno.serve(async () => {
  try {
    // Atomically claim a batch (matches the old emailProcessor lock query).
    const result = await db.execute(sql`
      SELECT id, to_address, subject, body_html
      FROM pending_emails
      WHERE sent_at IS NULL AND attempts < max_attempts
      ORDER BY created_at ASC
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    `);
    const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as PendingRow[];

    let sent = 0;
    let failed = 0;
    for (const email of rows) {
      // Increment attempts before sending.
      await db.update(pendingEmailsTable).set({ attempts: sql`attempts + 1` }).where(eq(pendingEmailsTable.id, email.id));
      try {
        await sendEmail({
          to: email.to_address,
          subject: email.subject,
          text: email.body_html.replace(/<[^>]*>/g, ""),
          html: email.body_html,
        });
        await db.update(pendingEmailsTable).set({ sent_at: new Date() }).where(eq(pendingEmailsTable.id, email.id));
        sent++;
      } catch (err) {
        const lastError = err instanceof Error ? err.message : String(err);
        await db.update(pendingEmailsTable).set({ last_error: lastError }).where(eq(pendingEmailsTable.id, email.id));
        failed++;
      }
    }

    return new Response(JSON.stringify({ processed: rows.length, sent, failed }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[cron-process-emails] error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "content-type": "application/json" } });
  }
});
