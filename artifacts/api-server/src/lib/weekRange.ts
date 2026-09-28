/**
 * Computes the Monday-based week that contains a given calendar date.
 *
 * The inputs come straight from `getSastParts()` so the result is always the
 * week as seen in South-Africa time, independent of the server's own timezone:
 *   - `dateString` — the SAST calendar date, "YYYY-MM-DD"
 *   - `dayOfWeek`  — 0 (Sun) … 6 (Sat) for that same date
 *
 * Weeks start on Monday to match the dashboard analytics, which use Postgres
 * `date_trunc('week', …)` (ISO week, Monday start). The Friday youth session
 * therefore falls mid-week, so a report for "this week" covers the run-up to
 * and including that Friday.
 */
export interface SastWeekRange {
  /** Monday of the week, inclusive — "YYYY-MM-DD". */
  weekStart: string;
  /** The following Monday, exclusive — "YYYY-MM-DD". Use `< weekEndExclusive`. */
  weekEndExclusive: string;
  /** Sunday of the week, inclusive — "YYYY-MM-DD". For display only. */
  weekEndInclusive: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toISO(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function sastWeekRange(dateString: string, dayOfWeek: number): SastWeekRange {
  const [y, m, d] = dateString.split("-").map((p) => parseInt(p, 10));
  // Treat the SAST calendar date as a plain date; do UTC math so month/year
  // rollovers are handled without any local-timezone drift.
  const base = Date.UTC(y, m - 1, d);
  const DAY = 24 * 60 * 60 * 1000;

  // Distance back to Monday: Sun(0)→6, Mon(1)→0, … Sat(6)→5.
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const weekStartMs = base - daysSinceMonday * DAY;
  const weekEndExclusiveMs = weekStartMs + 7 * DAY;
  const weekEndInclusiveMs = weekEndExclusiveMs - DAY;

  return {
    weekStart: toISO(weekStartMs),
    weekEndExclusive: toISO(weekEndExclusiveMs),
    weekEndInclusive: toISO(weekEndInclusiveMs),
  };
}

/**
 * Picks the week a report should cover.
 *
 * - No `requested` date → the current SAST week (the original behaviour).
 * - A "YYYY-MM-DD" date → the Monday-start week containing it, so past weeks
 *   stay downloadable forever (the report is rebuilt from stored data).
 *
 * Returns null for a malformed/impossible date or a week that hasn't started.
 */
export function resolveReportWeek(
  requested: string | undefined,
  todayString: string,
  todayDayOfWeek: number,
): SastWeekRange | null {
  const current = sastWeekRange(todayString, todayDayOfWeek);
  if (!requested) return current;

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(requested);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  // Reject roll-overs like 2026-02-30 → 2026-03-02.
  if (toISO(ms) !== requested) return null;

  const range = sastWeekRange(requested, new Date(ms).getUTCDay());
  if (range.weekStart > current.weekStart) return null;
  return range;
}
