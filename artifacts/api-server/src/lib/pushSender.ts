/**
 * Sends web push notifications via VAPID. Free — messages go straight to
 * Apple/Google push servers, signed with the VAPID keys in env.
 *
 * Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…).
 * When keys are missing every send quietly no-ops (dev-safe).
 */
import webpush from "web-push";
import { inArray } from "drizzle-orm";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { logger } from "./logger";
import { shouldDeleteSubscription, type PushPayload } from "./pushLogic";

let configured = false;
let warnedUnconfigured = false;

export function isPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function ensureConfigured(): boolean {
  if (configured) return true;
  if (!isPushConfigured()) {
    if (!warnedUnconfigured) {
      logger.warn("[push] VAPID keys not set — web push disabled");
      warnedUnconfigured = true;
    }
    return false;
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:matheatauunam@gmail.com",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
  return true;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

async function removeDeadProfileSubscriptions(ids: string[]): Promise<void> {
  await db
    .delete(pushSubscriptionsTable)
    .where(inArray(pushSubscriptionsTable.id, ids));
}

/**
 * Sends to the given devices. Expired ones are passed to `removeDead` so each
 * caller cleans up its own table (JG Youth and Worship keep separate ones).
 */
export async function sendToSubscriptions(
  subs: SubscriptionRow[],
  payload: PushPayload,
  removeDead: (ids: string[]) => Promise<void> = removeDeadProfileSubscriptions,
): Promise<number> {
  if (!ensureConfigured() || subs.length === 0) return 0;
  const body = JSON.stringify(payload);
  const dead: string[] = [];
  let sent = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
        sent++;
      } catch (err) {
        const status =
          typeof (err as { statusCode?: unknown })?.statusCode === "number"
            ? (err as { statusCode: number }).statusCode
            : 0;
        if (shouldDeleteSubscription(status)) {
          dead.push(s.id);
        } else {
          logger.warn({ err, status }, "[push] send failed");
        }
      }
    }),
  );

  if (dead.length > 0) {
    await removeDead(dead);
    logger.info({ count: dead.length }, "[push] Removed expired subscriptions");
  }
  return sent;
}

/**
 * Send a push to every device of the given profiles ("all" = every
 * subscriber). Returns the number of devices successfully reached.
 */
export async function sendPushToProfiles(
  profileIds: string[] | "all",
  payload: PushPayload,
): Promise<number> {
  if (profileIds !== "all" && profileIds.length === 0) return 0;
  const subs =
    profileIds === "all"
      ? await db.select().from(pushSubscriptionsTable)
      : await db
          .select()
          .from(pushSubscriptionsTable)
          .where(inArray(pushSubscriptionsTable.profile_id, profileIds));
  return sendToSubscriptions(subs, payload);
}
