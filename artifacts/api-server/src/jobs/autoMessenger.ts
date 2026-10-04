/**
 * Automated outreach job — push + email, no leader action needed.
 *
 * Runs every 60 s. Rules and message copy live in lib/autoMessages.ts:
 *   - Friday 14:00 push nudging leaders to post the weekly group announcement
 *   - Friday 15:00 re-engagement for people who've been away (once per stage)
 *   - Every day 08:00 birthday pushes: a wish to the birthday person and an
 *     announcement to everyone else
 *
 * Check-in reminders are left to the existing "check-in is open" push.
 *
 * Idempotent across restarts and multiple instances: each daily run is claimed
 * in push_send_log (unique kind+day), and each person's re-engagement stage in
 * auto_message_log (unique per absence). Does nothing before AUTO_MESSAGES_START.
 */
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  profilesTable,
  attendanceTable,
  pushSendLogTable,
  autoMessageLogTable,
  pendingEmailsTable,
  whatsappAutomationSettingsTable,
} from "@workspace/db";
import {
  automationActive,
  dueNow,
  reengagementMessage,
  renderEmailHtml,
  sessionsMissedSince,
  unsubscribeToken,
  OUTREACH_DAY_OF_WEEK,
  LEADER_GROUP_POST_TIME,
  REENGAGE_TIME,
  leaderGroupPostPayload,
  type OutboundMessage,
} from "../lib/autoMessages";
import { stageForRole } from "../lib/followUpStages";
import {
  BIRTHDAY_PUSH_TIME,
  birthdayAnnouncementPayload,
  birthdayWishPayload,
  selectBirthdays,
} from "../lib/birthdays";
import type { ProfileRole } from "../lib/directoryListParams";
import { sendPushToProfiles } from "../lib/pushSender";
import { isEmailConfigured } from "../lib/email";
import { APP_BASE_URL } from "../lib/appUrl";
import { logger } from "../lib/logger";

const OUTREACH_ROLES: ProfileRole[] = ["member", "visitor", "leader", "super_admin"];

interface Recipient {
  id: string;
  full_name: string | null;
  email: string | null;
  email_opt_out: boolean;
  role: ProfileRole;
}

/** SAST calendar date, weekday and HH:MM for "now". */
function sastNow(): { date: string; dayOfWeek: number; hhmm: string } {
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date())) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    dayOfWeek: days[parts.weekday] ?? 0,
    hhmm: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`,
  };
}

/** Claims today's run of `kind`; false if another tick/instance already did. */
async function claimRun(kind: string, date: string): Promise<boolean> {
  const claimed = await db
    .insert(pushSendLogTable)
    .values({ kind, sent_on: date })
    .onConflictDoNothing()
    .returning();
  return claimed.length > 0;
}

/** Push to the person's devices + queue an email (if they have one and haven't opted out). */
async function deliver(recipient: Recipient, msg: OutboundMessage, emailOn: boolean): Promise<void> {
  await sendPushToProfiles([recipient.id], msg.push).catch((err) =>
    logger.warn({ err, profileId: recipient.id }, "[autoMessenger] push failed"),
  );
  if (!emailOn || !recipient.email?.trim() || recipient.email_opt_out) return;
  const unsubscribeUrl =
    `${APP_BASE_URL}/api/email/unsubscribe?p=${recipient.id}&t=${unsubscribeToken(recipient.id)}`;
  await db.insert(pendingEmailsTable).values({
    to_address: recipient.email.trim(),
    subject: msg.subject,
    body_html: renderEmailHtml(msg, { appUrl: APP_BASE_URL, unsubscribeUrl }),
  });
}

const recipientColumns = {
  id: profilesTable.id,
  full_name: profilesTable.full_name,
  email: profilesTable.email,
  email_opt_out: profilesTable.email_opt_out,
  role: profilesTable.role,
};

/** Re-engagement: one message per follow-up stage per absence (stage = sessions missed). */
export async function sendReengagement(todaySast: string): Promise<number> {
  const [settings] = await db.select().from(whatsappAutomationSettingsTable).limit(1);
  const includeNever = settings?.include_never_attended ?? true;

  // Anchor = last attendance, or sign-up date for people who never came.
  const rows = await db
    .select({
      ...recipientColumns,
      last_attended: sql<string | null>`to_char(max(${attendanceTable.session_date}::date), 'YYYY-MM-DD')`,
      joined: sql<string>`to_char((${profilesTable.created_at} AT TIME ZONE 'Africa/Johannesburg')::date, 'YYYY-MM-DD')`,
    })
    .from(profilesTable)
    .leftJoin(attendanceTable, eq(attendanceTable.profile_id, profilesTable.id))
    .where(inArray(profilesTable.role, OUTREACH_ROLES))
    .groupBy(profilesTable.id);

  // Sessions actually held = dates with any check-ins. Absence is counted in
  // missed sessions, so an unrecorded Friday doesn't mark everyone absent.
  const sessionDates = (
    await db
      .selectDistinct({ d: sql<string>`to_char(${attendanceTable.session_date}::date, 'YYYY-MM-DD')` })
      .from(attendanceTable)
  ).map((r) => r.d);

  const emailOn = isEmailConfigured();
  let sent = 0;

  for (const row of rows) {
    if (!row.last_attended && !includeNever) continue;
    const anchor = row.last_attended ?? row.joined;
    const missed = sessionsMissedSince(anchor, sessionDates, todaySast);
    const stage = stageForRole(row.role as ProfileRole, missed);
    if (!stage) continue;

    // The unique constraint makes this the dedupe: only a new row gets a message.
    const claimed = await db
      .insert(autoMessageLogTable)
      .values({ profile_id: row.id, kind: "reengage", stage, anchor })
      .onConflictDoNothing()
      .returning({ id: autoMessageLogTable.id });
    if (claimed.length === 0) continue;

    await deliver(row as Recipient, reengagementMessage(row.role as ProfileRole, stage, row.full_name), emailOn);
    sent++;
  }
  return sent;
}

/**
 * Today's birthdays: wish each birthday person, and tell everyone else (all
 * roles) whose birthday it is. Returns the number of devices reached.
 */
export async function sendBirthdayPushes(todaySast: string): Promise<number> {
  const people = await db
    .select({
      id: profilesTable.id,
      full_name: profilesTable.full_name,
      avatar_url: profilesTable.avatar_url,
      date_of_birth: profilesTable.date_of_birth,
    })
    .from(profilesTable)
    .where(inArray(profilesTable.role, OUTREACH_ROLES));
  const { today } = selectBirthdays(people, todaySast);
  if (today.length === 0) return 0;

  let devices = 0;
  for (const celebrant of today) {
    devices += await sendPushToProfiles([celebrant.id], birthdayWishPayload(celebrant));
  }
  const celebrantIds = new Set(today.map((c) => c.id));
  const everyoneElse = people.filter((p) => !celebrantIds.has(p.id)).map((p) => p.id);
  devices += await sendPushToProfiles(everyoneElse, birthdayAnnouncementPayload(today));
  return devices;
}

async function tick(): Promise<void> {
  const now = sastNow();
  if (!automationActive(now.date)) return;

  // Birthdays go out every day of the week.
  if (dueNow(now.hhmm, BIRTHDAY_PUSH_TIME)) {
    if (await claimRun("auto_birthdays", now.date)) {
      const devices = await sendBirthdayPushes(now.date);
      logger.info({ devices }, "[autoMessenger] Birthday pushes sent");
    }
  }

  if (now.dayOfWeek !== OUTREACH_DAY_OF_WEEK) return;

  // Nudge leaders to post the weekly announcement to the WhatsApp group.
  if (dueNow(now.hhmm, LEADER_GROUP_POST_TIME)) {
    if (await claimRun("auto_leader_group_post", now.date)) {
      const leaders = await db
        .select({ id: profilesTable.id })
        .from(profilesTable)
        .where(inArray(profilesTable.role, ["leader", "super_admin"]));
      const devices = await sendPushToProfiles(leaders.map((l) => l.id), leaderGroupPostPayload());
      logger.info({ devices }, "[autoMessenger] Leader group-post nudge sent");
    }
  }

  // Weekly re-engagement.
  if (dueNow(now.hhmm, REENGAGE_TIME)) {
    if (await claimRun("auto_reengage", now.date)) {
      const count = await sendReengagement(now.date);
      logger.info({ count }, "[autoMessenger] Re-engagement sent");
    }
  }
}

let intervalId: NodeJS.Timeout | null = null;

export function startAutoMessenger(): void {
  if (intervalId) return;
  if (!isEmailConfigured()) {
    logger.warn("[autoMessenger] No email provider configured — automated messages will go out by push only");
  }
  intervalId = setInterval(() => {
    tick().catch((err) => logger.error({ err }, "[autoMessenger] tick failed"));
  }, 60_000);
}

export function stopAutoMessenger(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
