/**
 * Follow-up queue generator – background job.
 *
 * Checks the `whatsapp_automation_settings` table every 60 s and, when the
 * configured day + time matches "right now" (SAST), generates pending entries
 * in `follow_up_queue` for every member/visitor who is 2/4/6/8+ weeks absent.
 *
 * Messages are NOT sent automatically – leaders review & approve them in the
 * Follow-up Hub UI first.
 */
import { eq, and, inArray, sql, count, notInArray } from "drizzle-orm";
import {
  db,
  profilesTable,
  attendanceTable,
  whatsappTemplatesTable,
  whatsappAutomationSettingsTable,
  followUpQueueTable,
} from "@workspace/db";
import { applyTemplateVars } from "../lib/twilio";
import { logger } from "../lib/logger";

const STAGES = [2, 4, 6, 8] as const;
type Stage = (typeof STAGES)[number];

function stageFor(weeks: number | null | undefined): Stage | null {
  if (weeks == null || weeks < 2) return null;
  if (weeks >= 8) return 8;
  if (weeks >= 6) return 6;
  if (weeks >= 4) return 4;
  return 2;
}

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
      weeks_absent: sql<number>`floor((current_date - max(${attendanceTable.session_date}::date)) / 7)::int`,
    })
    .from(profilesTable)
    .innerJoin(attendanceTable, eq(profilesTable.id, attendanceTable.profile_id))
    .where(inArray(profilesTable.role, ["member", "visitor"]))
    .groupBy(profilesTable.id, profilesTable.full_name, profilesTable.phone)
    .having(
      sql`max(${attendanceTable.session_date}::date) <= (current_date - interval '2 weeks')`,
    );

  // Query: members who have NEVER checked in (weeks since registration)
  let neverAttendedRows: typeof attendedRows = [];
  if (includeNever) {
    neverAttendedRows = await db
      .select({
        id: profilesTable.id,
        full_name: profilesTable.full_name,
        phone: profilesTable.phone,
        weeks_absent: sql<number>`floor(EXTRACT(EPOCH FROM age(current_date, ${profilesTable.created_at}::date)) / 604800)::int`,
      })
      .from(profilesTable)
      .leftJoin(attendanceTable, eq(profilesTable.id, attendanceTable.profile_id))
      .where(
        and(
          inArray(profilesTable.role, ["member", "visitor"]),
          sql`${profilesTable.created_at}::date <= (current_date - interval '2 weeks')`,
        ),
      )
      .groupBy(
        profilesTable.id,
        profilesTable.full_name,
        profilesTable.phone,
        profilesTable.created_at,
      )
      .having(sql`count(${attendanceTable.id}) = 0`);
  }

  const allOverdue = [...attendedRows, ...neverAttendedRows];
  if (allOverdue.length === 0) return 0;

  // 3. Load follow_up templates
  const templates = await db
    .select()
    .from(whatsappTemplatesTable)
    .where(eq(whatsappTemplatesTable.template_type, "follow_up"));

  const templateByStage: Record<number, (typeof templates)[0]> = {};
  for (const t of templates) {
    if (t.stage_weeks != null) templateByStage[t.stage_weeks] = t;
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
    const stage = stageFor(weeks);
    if (!stage) continue;

    // Skip if already queued at this stage
    if (existingSet.has(`${row.id}:${stage}`)) continue;

    const template = templateByStage[stage];
    const messagePreview = template
      ? applyTemplateVars(template.message_text, {
          User: firstName(row.full_name),
          Leader: "JG Youth Team",
        })
      : `Follow-up (${stage}w): Hi ${firstName(row.full_name)}, we miss you at JG Youth!`;

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
    const [settings] = await db
      .select()
      .from(whatsappAutomationSettingsTable)
      .limit(1);
    if (!settings || !settings.enabled) return;

    const { dayOfWeek, hhmm } = getSastNow();
    const today = new Date().toISOString().split("T")[0];

    // Only fire if day matches and we're within ±2 min of the configured time
    if (dayOfWeek !== settings.day_of_week) return;

    const [configH, configM] = settings.time.split(":").map(Number);
    const [nowH, nowM] = hhmm.split(":").map(Number);
    const configTotal = configH * 60 + configM;
    const nowTotal = nowH * 60 + nowM;
    if (Math.abs(nowTotal - configTotal) > 2) return;

    // Prevent duplicate fires on the same day
    if (lastFiredDate === today) return;
    lastFiredDate = today;

    logger.info("[followUpGenerator] Automation window hit — generating queue…");
    const count = await generateFollowUpQueue();
    logger.info({ count }, "[followUpGenerator] Queue generation complete");
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
