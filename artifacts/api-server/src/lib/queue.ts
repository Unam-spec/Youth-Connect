import { Queue, Worker } from "bullmq";
import { eq, sql } from "drizzle-orm";
import { db, pendingEmailsTable } from "@workspace/db";
import { sendEmail } from "./email";
import { logger } from "./logger";

let emailQueue: Queue | null = null;
let emailWorker: Worker | null = null;

function getRedisOpts() {
  const url = process.env.UPSTASH_REDIS_URL;
  if (!url) return null;

  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null as null,
    enableReadyCheck: false,
  };
}

export function getEmailQueue(): Queue | null {
  if (emailQueue) return emailQueue;

  const opts = getRedisOpts();
  if (!opts) return null;

  emailQueue = new Queue("email-queue", { connection: opts });
  return emailQueue;
}

async function processEmailBatch() {
  let result;
  try {
    result = await db.execute(sql`
      SELECT id, to_address, subject, body_html, attempts
      FROM pending_emails
      WHERE sent_at IS NULL AND attempts < 5
      ORDER BY created_at ASC
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    `);
  } catch (sqlErr) {
    logger.error({ err: sqlErr }, "[queue] Failed to query pending emails");
    return;
  }

  const pending = Array.isArray(result) ? result : (result as any).rows;
  if (!pending || pending.length === 0) return;

  logger.info(`[queue] Processing ${pending.length} pending email(s)`);

  for (const email of pending) {
    await db
      .update(pendingEmailsTable)
      .set({ attempts: sql`attempts + 1` })
      .where(eq(pendingEmailsTable.id, email.id));

    try {
      await sendEmail({
        to: email.to_address,
        subject: email.subject,
        text: email.body_html.replace(/<[^>]*>/g, ""),
        html: email.body_html,
      });

      await db
        .update(pendingEmailsTable)
        .set({ sent_at: new Date() })
        .where(eq(pendingEmailsTable.id, email.id));

      logger.info(`[queue] Sent email to ${email.to_address}`);
    } catch (err: any) {
      await db
        .update(pendingEmailsTable)
        .set({ last_error: err instanceof Error ? err.message : String(err) })
        .where(eq(pendingEmailsTable.id, email.id));

      logger.error(
        { err, emailId: email.id },
        `[queue] Failed to send email to ${email.to_address}`,
      );
    }
  }
}

export function startEmailWorker(): boolean {
  const opts = getRedisOpts();
  if (!opts) {
    logger.warn(
      "UPSTASH_REDIS_URL not configured — BullMQ email worker disabled",
    );
    return false;
  }

  const queue = getEmailQueue()!;

  queue
    .upsertJobScheduler("email-poll", { every: 60_000 }, { name: "poll" })
    .catch((err) =>
      logger.error({ err }, "[queue] Failed to create scheduler"),
    );

  emailWorker = new Worker(
    "email-queue",
    async () => {
      await processEmailBatch();
    },
    { connection: opts, concurrency: 1 },
  );

  emailWorker.on("failed", (_job, err) => {
    logger.error({ err }, "[queue] Email worker job failed");
  });

  logger.info("[queue] BullMQ email worker started");
  return true;
}

export async function stopQueue() {
  if (emailWorker) {
    await emailWorker.close();
    emailWorker = null;
  }
  if (emailQueue) {
    await emailQueue.close();
    emailQueue = null;
  }
}
