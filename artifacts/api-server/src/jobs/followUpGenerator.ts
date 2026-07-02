/**
 * Follow-up queue generator – background job.
 *
 * Checks the `whatsapp_automation_settings` table every 60 s and, when the
 * configured day + time matches "right now" (SAST), generates pending entries
 * in `follow_up_queue` for everyone overdue: members/visitors at 2/4/6/8
 * weeks absent, leaders/super admins on a stricter 1/2/4-week ladder.
 *
 * Messages are NOT sent automatically – leaders review & approve them in the
 * Follow-up Hub UI first.
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
} from "@workspace/db";
import {
  applyTemplateVars,
  defaultFollowUpMessage,
  FOLLOW_UP_TEMPLATE_TYPES,
  isStaffRole,
  stageForRole,
  templateTypeForRole,
} from "../lib/followUpStages";
import { logger } from "../lib/logger";

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
let lastCheckinFiredDate: string | null = null;

export async function generateCheckinReminders(): Promise<number> {
  const today = new Date().toISOString().split("T")[0];

  // Members who have opted into WhatsApp and have a phone number,
  // but do NOT have an attendance record for today.
  const overdueMembers = await db
    .select({
      id: profilesTable.id,
      full_name: profilesTable.full_name,
      phone: profilesTable.phone,
      role: profilesTable.role,
    })
    .from(profilesTable)
    .leftJoin(
      attendanceTable,
      and(
        eq(profilesTable.id, attendanceTable.profile_id),
        eq(attendanceTable.session_date, today),
      ),
    )
    .where(
      and(
        inArray(profilesTable.role, [
          "member",
          "visitor",
          "leader",
          "super_admin",
        ]),
        eq(profilesTable.whatsapp_opt_in, true),
        sql`btrim(${profilesTable.phone}) <> ''`,
        sql`${attendanceTable.id} IS NULL`, // No check-in today
      ),
    );

  if (overdueMembers.length === 0) return 0;

  // Check which profiles already have a check-in reminder (stage_weeks: 0) generated today
  const existingPending = await db
    .select({ profile_id: followUpQueueTable.profile_id })
    .from(followUpQueueTable)
    .where(
      and(
        eq(followUpQueueTable.stage_weeks, 0),
        sql`${followUpQueueTable.created_at}::date = current_date`,
      ),
    );
  
  const existingSet = new Set(existingPending.map((e) => e.profile_id));

  const inserts: {
    profile_id: string;
    stage_weeks: number;
    weeks_absent: number;
    message_preview: string;
    template_id: string | null;
    status: "pending";
  }[] = [];

  for (const row of overdueMembers) {
    if (existingSet.has(row.id)) continue;
    
    inserts.push({
      profile_id: row.id,
      stage_weeks: 0,
      weeks_absent: 0,
      message_preview: isStaffRole(row.role)
        ? `Hi ${firstName(row.full_name)}, leaders check in too — don't forget to check in for JG Youth tonight!`
        : `Hi ${firstName(row.full_name)}, don't forget to check in for JG Youth tonight!`,
      template_id: null,
      status: "pending",
    });
  }

  if (inserts.length === 0) return 0;

  await db.insert(followUpQueueTable).values(inserts);

  logger.info(
    { count: inserts.length },
    "[followUpGenerator] Queued check-in reminders for leader review",
  );

  return inserts.length;
}

export async function generateFollowUpQueue(): Promise<number> {
  // 1. Read automation settings
  const [settings] = await db
    .select()
    .from(whatsappAutomationSettingsTable)
    .limit(1);
  if (!settings || !settings.enabled) return 0;

  // 2. Find members who are 2+ weeks overdue
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
      }
    }

    // --- 2. Check-in Reminders (1 hour before window closes) ---
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
      
      if (Math.abs(nowTotal - targetTotal) <= 2 && lastCheckinFiredDate !== today) {
        lastCheckinFiredDate = today;
        logger.info("[followUpGenerator] Check-in reminder window hit (-1h) — generating queue…");
        const count = await generateCheckinReminders();
        logger.info({ count }, "[followUpGenerator] Check-in reminders generation complete");
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
