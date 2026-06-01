import { eq, sql } from "drizzle-orm";
import { db, pendingEmailsTable } from "@workspace/db";
import { sendEmail } from "../lib/twilio";
import { logger } from "../lib/logger";

let intervalId: NodeJS.Timeout | null = null;

export async function processPendingEmails() {
  try {
    // Use raw SQL for the atomic lock
    let result;
    try {
      result = await db.execute(sql`
        SELECT id, to_address, subject, body_html, attempts
        FROM pending_emails
        WHERE sent_at IS NULL AND attempts < max_attempts
        ORDER BY created_at ASC
        LIMIT 10
        FOR UPDATE SKIP LOCKED
      `);
    } catch (sqlErr) {
      logger.error({ err: sqlErr }, "[emailProcessor] Failed to execute atomic lock query. Does the max_attempts column exist in Supabase?");
      return;
    }

    // Handle both pg (returns object with rows) and postgres.js (returns array directly)
    const pending = Array.isArray(result) ? result : (result as any).rows;

    if (!pending || pending.length === 0) return;

    logger.info(`[emailProcessor] Processing ${pending.length} pending email(s)...`);

    for (const email of pending) {
      // Increment attempts BEFORE sending
      await db.update(pendingEmailsTable)
        .set({ attempts: sql`attempts + 1` })
        .where(eq(pendingEmailsTable.id, email.id));

      try {
        await sendEmail({
          to: email.to_address,
          subject: email.subject,
          text: email.body_html.replace(/<[^>]*>/g, ""), // Plaintext fallback
          html: email.body_html,
        });

        // Mark as successfully sent
        await db.update(pendingEmailsTable)
          .set({ sent_at: new Date() })
          .where(eq(pendingEmailsTable.id, email.id));

        logger.info(`[emailProcessor] Successfully sent email to ${email.to_address}`);
      } catch (err: any) {
        const lastError = err instanceof Error ? err.message : String(err);
        
        // Record error for debugging
        await db.update(pendingEmailsTable)
          .set({ last_error: lastError })
          .where(eq(pendingEmailsTable.id, email.id));

        logger.error(
          { err, emailId: email.id, recipient: email.to_address },
          `[emailProcessor] Failed sending email to ${email.to_address}`
        );
      }
    }
  } catch (err) {
    logger.error({ err }, "[emailProcessor] Critical error in email queue job");
  }
}

export function startEmailProcessor() {
  if (intervalId) return;
  
  logger.info("[emailProcessor] Starting background email retry processor job loop...");
  
  // Run once immediately on boot
  processPendingEmails().catch(err => {
    logger.error({ err }, "[emailProcessor] Initial run failed");
  });

  // Then schedule to run every 60 seconds
  intervalId = setInterval(() => {
    processPendingEmails().catch(err => {
      logger.error({ err }, "[emailProcessor] Scheduled run failed");
    });
  }, 60000);
}

export function stopEmailProcessor() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info("[emailProcessor] Stopped background email processor");
  }
}
