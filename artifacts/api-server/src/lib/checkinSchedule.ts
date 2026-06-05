import { toZonedTime } from "date-fns-tz";
import { db, checkinSettingsTable, checkinWindowsTable } from "@workspace/db";

export interface CheckinWindow {
  day_of_week: number; // 0=Sun … 6=Sat (matches JS Date.getDay())
  start_time: string;  // "HH:MM" 24h SAST
  end_time: string;    // "HH:MM" 24h SAST
  enabled: boolean;
}

export interface CheckinSchedule {
  restrict_to_schedule: boolean;
  windows: CheckinWindow[];
}

/**
 * Pure open/closed decision. `nowHHMM` must be zero-padded "HH:MM".
 * Time comparison is a lexical string compare, valid for equal-length "HH:MM".
 */
export function evaluateCheckinOpen(
  restrict: boolean,
  windows: CheckinWindow[],
  dayOfWeek: number,
  nowHHMM: string,
): boolean {
  if (!restrict) return true;
  return windows.some(
    (w) =>
      w.enabled &&
      w.day_of_week === dayOfWeek &&
      nowHHMM >= w.start_time &&
      nowHHMM < w.end_time,
  );
}

const TZ = "Africa/Johannesburg";

/** Reads the schedule, normalizing windows to all 7 weekdays (0..6). */
export async function getSchedule(): Promise<CheckinSchedule> {
  const [settings, rows] = await Promise.all([
    db.query.checkinSettingsTable.findFirst(),
    db.select().from(checkinWindowsTable),
  ]);
  const byDay = new Map<number, (typeof rows)[number]>(
    rows.map((r) => [r.day_of_week, r]),
  );
  const windows: CheckinWindow[] = [];
  for (let d = 0; d < 7; d++) {
    const r = byDay.get(d);
    windows.push({
      day_of_week: d,
      start_time: r?.start_time ?? "",
      end_time: r?.end_time ?? "",
      enabled: r?.enabled ?? false,
    });
  }
  return { restrict_to_schedule: settings?.restrict_to_schedule ?? true, windows };
}

/** Current SAST { dayOfWeek, hhmm } as zero-padded "HH:MM". */
export function sastNow(now: Date = new Date()): { dayOfWeek: number; hhmm: string } {
  const z = toZonedTime(now, TZ);
  const hh = String(z.getHours()).padStart(2, "0");
  const mm = String(z.getMinutes()).padStart(2, "0");
  return { dayOfWeek: z.getDay(), hhmm: `${hh}:${mm}` };
}

/** True if a non-leader may check in right now. Fails safe to closed on error. */
export async function isCheckinOpenNow(): Promise<boolean> {
  try {
    const schedule = await getSchedule();
    const { dayOfWeek, hhmm } = sastNow();
    return evaluateCheckinOpen(
      schedule.restrict_to_schedule,
      schedule.windows.filter((w) => w.enabled && w.start_time && w.end_time),
      dayOfWeek,
      hhmm,
    );
  } catch (err) {
    console.error("[checkin] isCheckinOpenNow failed; treating as closed:", err);
    return false;
  }
}
