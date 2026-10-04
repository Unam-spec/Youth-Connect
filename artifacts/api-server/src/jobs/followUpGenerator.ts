/**
 * Follow-up queue generator – background job.
 *
 * Checks the `whatsapp_automation_settings` table every 60 s and, when the
 * configured day + time matches "right now" (SAST), generates pending entries
 * in `follow_up_queue` for everyone overdue: members/visitors at 2/4/6/8
 * weeks absent, leaders/super admins on a stricter 1/2/4-week ladder.
 *
 * Messages are NOT sent automatically – leaders review & approve them in the
 * Follow-up Hub UI first. Leaders are pushed when there's messaging to do:
 *   - when this week's follow-up list is made ("N people have been away")
 *   - daily at 12:00 while follow-ups are still waiting to be sent
 *   - an hour before check-in closes, to send ONE check-in reminder to the
 *     group (replaces the old per-person check-in reminder queue)
 */
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  db,
  profilesTable,
  attendanceTable,
  whatsappTemplatesTable,
  whatsappAutomationSettingsTable,
  followUpQueueTable,
  checkinWindowsTable,
  pushSendLogTable,
} from "@workspace/db";
import { checkinWindowOpenNow, checkinOpenPayload } from "../lib/pushLogic";
import { sendPushToProfiles } from "../lib/pushSender";
import {
  applyTemplateVars,
  defaultFollowUpMessage,
  FOLLOW_UP_TEMPLATE_TYPES,
  isStaffRole,
  stageForRole,
  templateTypeForRole,
  APP_URL,
} from "../lib/followUpStages";
import { logger } from "../lib/logger";
import { dueNow } from "../lib/autoMessages";
import {
  PENDING_FOLLOWUPS_TIME,
  checkinGroupNudgePayload,
  newFollowUpsPayload,
  pendingFollowUpsPayload,
} from "../lib/leaderNudges";

function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Return current SAST day-of-week (0=Sun) and HH:MM string. */
function getSastNow(): { dayOfWeek: number; hhmm: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    dayOfWeek: weekdayMap[parts["weekday"]] ?? now.getDay(),
    hhmm: `${parts["hour"]}:${parts["minute"]}`,
  };
}

/** Has the cron already fired in the current window? Prevents duplicates. */
let lastFiredDate: string | null = null;
// In-memory shortcut only — the real dedupe is the push_send_log DB unique.
let lastCheckinPushDate: string | null = null;

/** Every JG Youth leader and super admin. */
async function leaderIds(): Promise<string[]> {
  const rows = await db
    .select({ id: profilesTable.id })
    .from(profilesTable)
    .where(inArray(profilesTable.role, ["leader", "super_admin"]));
  return rows.map((r) => r.id);
}

/** SAST calendar date (YYYY-MM-DD). */
function sastDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());
}

/** Claims a once-a-day run in push_send_log; false if already done today. */
async function claimDaily(kind: string, date: string): Promise<boolean> {
  const claimed = await db
    .insert(pushSendLogTable)
    .values({ kind, sent_on: date })
    .onConflictDoNothing()
    .returning();
  return claimed.length > 0;
}

export async function generateFollowUpQueue(): Promise<number> {
  // 1. Read automation settings
  const [settings] = await db
    .select()
    .from(whatsappAutomationSettingsTable)
    .limit(1);
  if (!settings || !settings.enabled) return 0;

  // 2. Find everyone overdue (1+ week; role ladder decides who is actually due)
  const includeNever = settings.include_never_attended;

  // Query: members who HAVE checked in before
  const attendedRows = await db
    .select({
      id: profilesTable.id,
      full_name: profilesTable.full_name,
      phone: profilesTable.phone,
      role: profilesTable.role,
      weeks_absent: sql<number>`floor((current_date - max(${attendanceTable.session_date}::date)) / 7)::int`,
    })
    .from(profilesTable)
    .innerJoin(attendanceTable, eq(profilesTable.id, attendanceTable.profile_id))
    .where(
      inArray(profilesTable.role, [
        "member",
        "visitor",
        "leader",
        "super_admin",
      ]),
    )
    .groupBy(
      profilesTable.id,
      profilesTable.full_name,
      profilesTable.phone,
      profilesTable.role,
    )
    .having(
      sql`max(${attendanceTable.session_date}::date) <= (current_date - interval '1 week')`,
    );

  // Query: members who have NEVER checked in (weeks since registration)
  let neverAttendedRows: typeof attendedRows = [];
  if (includeNever) {
    neverAttendedRows = await db
      .select({
        id: profilesTable.id,
        full_name: profilesTable.full_name,
        phone: profilesTable.phone,
        role: profilesTable.role,
        weeks_absent: sql<number>`floor(EXTRACT(EPOCH FROM age(current_date, ${profilesTable.created_at}::date)) / 604800)::int`,
      })
      .from(profilesTable)
      .leftJoin(attendanceTable, eq(profilesTable.id, attendanceTable.profile_id))
      .where(
        and(
          inArray(profilesTable.role, [
            "member",
            "visitor",
            "leader",
            "super_admin",
          ]),
          sql`${profilesTable.created_at}::date <= (current_date - interval '1 week')`,
        ),
      )
      .groupBy(
        profilesTable.id,
        profilesTable.full_name,
        profilesTable.phone,
        profilesTable.role,
        profilesTable.created_at,
      )
      .having(sql`count(${attendanceTable.id}) = 0`);
  }

  const allOverdue = [...attendedRows, ...neverAttendedRows];
  if (allOverdue.length === 0) return 0;

  // 3. Load follow-up templates for every audience (member/leader/super-admin)
  const templates = await db
    .select()
    .from(whatsappTemplatesTable)
    .where(
      inArray(whatsappTemplatesTable.template_type, FOLLOW_UP_TEMPLATE_TYPES),
    );

  const templateByKey: Record<string, (typeof templates)[0]> = {};
  for (const t of templates) {
    if (t.stage_weeks != null) {
      templateByKey[`${t.template_type}:${t.stage_weeks}`] = t;
    }
  }

  // 4. Check which profiles already have a pending entry at this stage
  const existingPending = await db
    .select({
      profile_id: followUpQueueTable.profile_id,
      stage_weeks: followUpQueueTable.stage_weeks,
    })
    .from(followUpQueueTable)
    .where(
      inArray(followUpQueueTable.status, ["pending", "approved", "sent"]),
    );
  const existingSet = new Set(
    existingPending.map((e) => `${e.profile_id}:${e.stage_weeks}`),
  );

  // 5. Generate queue entries
  const inserts: {
    profile_id: string;
    stage_weeks: number;
    weeks_absent: number;
    message_preview: string;
    template_id: string | null;
    status: "pending";
  }[] = [];

  for (const row of allOverdue) {
    const weeks = Number(row.weeks_absent);
    const stage = stageForRole(row.role, weeks);
    if (!stage) continue;

    // Skip if already queued at this stage
    if (existingSet.has(`${row.id}:${stage}`)) continue;

    const template = templateByKey[`${templateTypeForRole(row.role)}:${stage}`];
    const messagePreview = template
      ? applyTemplateVars(template.message_text, {
          User: firstName(row.full_name),
          Leader: "JG Youth Team",
          Link: APP_URL,
        })
      : defaultFollowUpMessage(row.role, stage, firstName(row.full_name));

    inserts.push({
      profile_id: row.id,
      stage_weeks: stage,
      weeks_absent: weeks,
      message_preview: messagePreview,
      template_id: template?.id ?? null,
      status: "pending",
    });
  }

  if (inserts.length === 0) return 0;

  await db.insert(followUpQueueTable).values(inserts);

  logger.info(
    { count: inserts.length },
    "[followUpGenerator] Queued follow-up messages for leader review",
  );

  return inserts.length;
}

// ── Scheduler ──────────────────────────────────────────────────────────────────
let intervalId: NodeJS.Timeout | null = null;

/** Called every 60s. Checks if we're inside the configured automation window. */
async function tick() {
  try {
    const { dayOfWeek, hhmm } = getSastNow();
    const today = new Date().toISOString().split("T")[0];
    const [nowH, nowM] = hhmm.split(":").map(Number);
    const nowTotal = nowH * 60 + nowM;

    // --- 1. Weekly Follow-Ups (2/4/6/8 weeks) ---
    const [settings] = await db
      .select()
      .from(whatsappAutomationSettingsTable)
      .limit(1);
      
    if (settings && settings.enabled && settings.day_of_week === dayOfWeek) {
      const [configH, configM] = settings.time.split(":").map(Number);
      const configTotal = configH * 60 + configM;
      
      if (Math.abs(nowTotal - configTotal) <= 2 && lastFiredDate !== today) {
        lastFiredDate = today;
        logger.info("[followUpGenerator] Follow-up automation window hit — generating queue…");
        const count = await generateFollowUpQueue();
        logger.info({ count }, "[followUpGenerator] Follow-up queue generation complete");
        if (count > 0 && (await claimDaily("leader_followups_new", sastDate()))) {
          const devices = await sendPushToProfiles(await leaderIds(), newFollowUpsPayload(count));
          logger.info({ devices }, "[followUpGenerator] Leaders told about new follow-ups");
        }
      }
    }

    // --- 2. One check-in reminder for the group (1 hour before window closes).
    // Leaders get a push that opens the group message; no per-person queue.
    const activeWindow = await db
      .select()
      .from(checkinWindowsTable)
      .where(and(
        eq(checkinWindowsTable.day_of_week, dayOfWeek),
        eq(checkinWindowsTable.enabled, true)
      ))
      .limit(1);
      
    if (activeWindow.length > 0) {
      const windowEnd = activeWindow[0].end_time;
      const [endH, endM] = windowEnd.split(":").map(Number);
      const endTotal = endH * 60 + endM;
      
      // Target time is exactly 1 hour (60 minutes) before the end time
      const targetTotal = endTotal - 60;
      
      if (
        Math.abs(nowTotal - targetTotal) <= 2 &&
        (await claimDaily("leader_checkin_group", sastDate()))
      ) {
        const devices = await sendPushToProfiles(await leaderIds(), checkinGroupNudgePayload());
        logger.info({ devices }, "[followUpGenerator] Leaders nudged to send the group check-in reminder");
      }
    }

    // --- 3. Check-in OPEN push — free web push to every subscriber while the
    // window is open and today's push hasn't gone out yet. "Open now" (not
    // "just opened") so a server that was asleep or restarting at the opening
    // minute still sends on its first tick back. Dedupe is DB-backed
    // (push_send_log unique on kind+sent_on) so it can never double-send.
    if (activeWindow.length > 0) {
      const w = activeWindow[0];
      const open = checkinWindowOpenNow(
        [
          {
            day_of_week: w.day_of_week,
            start_time: w.start_time,
            end_time: w.end_time,
            enabled: w.enabled,
          },
        ],
        dayOfWeek,
        hhmm,
      );
      if (open && lastCheckinPushDate !== today) {
        const claimed = await db
          .insert(pushSendLogTable)
          .values({ kind: "checkin_open", sent_on: today })
          .onConflictDoNothing()
          .returning();
        // Claimed or already claimed by an earlier tick/instance — either way
        // this process is done for today.
        lastCheckinPushDate = today;
        if (claimed.length > 0) {
          logger.info("[followUpGenerator] Check-in window open — sending push…");
          const sent = await sendPushToProfiles("all", checkinOpenPayload());
          logger.info({ sent }, "[followUpGenerator] Check-in open push complete");
        }
      }
    }

    // --- 4. Daily: follow-up messages still waiting to be sent. Skipped on a
    // day the "new follow-ups" push already went out.
    if (dueNow(hhmm, PENDING_FOLLOWUPS_TIME)) {
      const date = sastDate();
      if (await claimDaily("leader_pending_followups", date)) {
        const [{ n }] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(followUpQueueTable)
          .where(and(eq(followUpQueueTable.status, "pending"), sql`${followUpQueueTable.stage_weeks} > 0`));
        const alreadyToldToday = await db
          .select({ kind: pushSendLogTable.kind })
          .from(pushSendLogTable)
          .where(and(eq(pushSendLogTable.kind, "leader_followups_new"), eq(pushSendLogTable.sent_on, date)));
        if (n > 0 && alreadyToldToday.length === 0) {
          const devices = await sendPushToProfiles(await leaderIds(), pendingFollowUpsPayload(n));
          logger.info({ devices, pending: n }, "[followUpGenerator] Leaders reminded of waiting follow-ups");
        }
      }
    }

  } catch (err) {
    logger.error({ err }, "[followUpGenerator] Tick error");
  }
}

export function startFollowUpGenerator() {
  if (intervalId) return;
  logger.info("[followUpGenerator] Starting background follow-up generator…");
  // Check every 60 seconds
  intervalId = setInterval(() => {
    tick().catch((err) => {
      logger.error({ err }, "[followUpGenerator] Scheduled tick failed");
    });
  }, 60_000);
}

export function stopFollowUpGenerator() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info("[followUpGenerator] Stopped follow-up generator");
  }
}
