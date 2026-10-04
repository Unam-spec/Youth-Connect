import { and, eq, inArray, ne } from "drizzle-orm";
import {
  db,
  worshipAccountsTable,
  worshipNotificationsTable,
  worshipPushSubscriptionsTable,
} from "@workspace/db";
import { sendToSubscriptions } from "./pushSender";
import { logger } from "./logger";

/**
 * Worship Team notifications: an in-app inbox row per recipient, plus web push
 * to worship devices only (worship_push_subscriptions — never JG Youth's
 * table). Muted accounts still get the inbox row, just no push.
 */
async function notify(
  recipients: { id: string; notifications_muted: boolean }[],
  n: { actorId: string | null; type: string; title: string; message: string; url: string },
): Promise<void> {
  if (recipients.length === 0) return;
  await db.insert(worshipNotificationsTable).values(
    recipients.map((r) => ({
      recipient_id: r.id,
      actor_id: n.actorId,
      type: n.type,
      message: n.message,
      url: n.url,
    })),
  );

  const pushTo = recipients.filter((r) => !r.notifications_muted).map((r) => r.id);
  if (pushTo.length === 0) return;
  const subs = await db
    .select()
    .from(worshipPushSubscriptionsTable)
    .where(inArray(worshipPushSubscriptionsTable.account_id, pushTo));
  await sendToSubscriptions(subs, { title: n.title, body: n.message, url: n.url }, async (ids) => {
    await db
      .delete(worshipPushSubscriptionsTable)
      .where(inArray(worshipPushSubscriptionsTable.id, ids));
  });
}

/** Everyone else on the team hears that `actor` added a song to their list. */
export async function notifySongAdded(
  actor: { id: string; full_name: string },
  song: { id: string; title: string },
  key: string | null,
): Promise<void> {
  const recipients = await db
    .select({
      id: worshipAccountsTable.id,
      notifications_muted: worshipAccountsTable.notifications_muted,
    })
    .from(worshipAccountsTable)
    .where(and(eq(worshipAccountsTable.status, "approved"), ne(worshipAccountsTable.id, actor.id)));
  const keyText = key ? ` (key of ${key})` : "";
  await notify(recipients, {
    actorId: actor.id,
    type: "song_added",
    title: "Worship Team",
    message: `${actor.full_name} added "${song.title}"${keyText} to their list`,
    url: `/worship/songs/${song.id}`,
  });
}

/** Leaders hear about a new join request. */
export async function notifyJoinRequest(requester: { id: string; full_name: string }): Promise<void> {
  const leaders = await db
    .select({
      id: worshipAccountsTable.id,
      notifications_muted: worshipAccountsTable.notifications_muted,
    })
    .from(worshipAccountsTable)
    .where(and(eq(worshipAccountsTable.status, "approved"), eq(worshipAccountsTable.role, "leader")));
  await notify(leaders, {
    actorId: requester.id,
    type: "join_request",
    title: "Worship Team",
    message: `${requester.full_name} asked to join the worship team`,
    url: "/worship",
  });
}

/** Fire-and-forget wrapper so a slow push never delays the API response. */
export function inBackground(label: string, work: Promise<void>): void {
  work.catch((err) => logger.error({ err }, `[worship] ${label} failed`));
}
