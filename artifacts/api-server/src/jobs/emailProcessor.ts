import { eq, and, lt, isNull } from "drizzle-orm";
import { db, pendingEmailsTable } from "@workspace/db";
import { sendEmail } from "../lib/twilio";
import { logger } from "../lib/logger";

let intervalId: NodeJS.Timeout | null = null;

export async function processPendingEmails() {
  try {
    // Read up to 10 rows where sent_at is NULL and attempts < 3
    const pending = await db.query.pendingEmailsTable.findFirst
      ? await db
          .select()
          .from(pendingEmailsTable)
          .where(
            and(
              isNull(pendingEmailsTable.sent_at),
              lt(pendingEmailsTable.attempts, 3)
            )
          )
          .limit(10)
      : [];

    if (pending.length === 0) return;

    logger.info(`[emailProcessor] Processing ${pending.length} pending email(s)...`);

    for (const email of pending) {
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
        const attempts = (email.attempts ?? 0) + 1;
        const lastError = err instanceof Error ? err.message : String(err);
        
        await db.update(pendingEmailsTable)
          .set({ 
            attempts,
            last_error: lastError,
          })
          .where(eq(pendingEmailsTable.id, email.id));

        logger.error(
          { err, emailId: email.id, recipient: email.to_address },
          `[emailProcessor] Failed sending email to ${email.to_address} (Attempt ${attempts}/3)`
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
