// Pure, dependency-free age helpers shared by the api-server.
// (A byte-identical copy lives at artifacts/jg-youth/src/lib/age.ts for the web app.)

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MIN_AGE = 5;
export const MAX_AGE = 100;

/** Today's date in South Africa (SAST, UTC+2) as 'YYYY-MM-DD'. */
export function todaySAST(now: Date = new Date()): string {
  // 'en-CA' renders as YYYY-MM-DD; timeZone pins it to SAST regardless of host TZ.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Whole-years age from a 'YYYY-MM-DD' date of birth, relative to `today`
 * (defaults to SAST today). Returns null for missing/invalid input or an
 * out-of-range result. String math avoids Date timezone pitfalls.
 */
export function computeAge(
  dob: string | null | undefined,
  today: string = todaySAST(),
): number | null {
  if (!dob) return null;
  const b = DATE_RE.exec(dob.trim());
  const t = DATE_RE.exec(today);
  if (!b || !t) return null;
  const by = +b[1], bm = +b[2], bd = +b[3];
  const ty = +t[1], tm = +t[2], td = +t[3];
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  if (age < 0 || age > 150) return null;
  return age;
}

export interface DobValidation {
  ok: boolean;
  age?: number;
  error?: string;
}

/**
 * Validates a 'YYYY-MM-DD' date of birth for registration/profile edits:
 * a real, past calendar date yielding an age within [MIN_AGE, MAX_AGE].
 */
export function validateDob(
  dob: unknown,
  today: string = todaySAST(),
): DobValidation {
  if (typeof dob !== "string" || !DATE_RE.test(dob.trim())) {
    return { ok: false, error: "Date of birth must be a valid date (YYYY-MM-DD)." };
  }
  const trimmed = dob.trim();
  const [y, m, d] = trimmed.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { ok: false, error: "Date of birth is not a real calendar date." };
  }
  if (trimmed > today) {
    return { ok: false, error: "Date of birth cannot be in the future." };
  }
  const age = computeAge(trimmed, today);
  if (age === null || age < MIN_AGE || age > MAX_AGE) {
    return { ok: false, error: `Age must be between ${MIN_AGE} and ${MAX_AGE}.` };
  }
  return { ok: true, age };
}

const DAY_MS = 86_400_000;

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * Whole days until the next birthday occurrence (0 = today), relative to
 * `today` (SAST). Feb 29 is treated as Feb 28 in non-leap years. null for
 * missing/invalid input.
 */
export function daysUntilBirthday(
  dob: string | null | undefined,
  today: string = todaySAST(),
): number | null {
  if (!dob) return null;
  const b = DATE_RE.exec(dob.trim());
  const t = DATE_RE.exec(today);
  if (!b || !t) return null;
  const bm = +b[2], bd = +b[3];
  const ty = +t[1], tm = +t[2], td = +t[3];
  const birthdayInYear = (year: number): number => {
    const day = bm === 2 && bd === 29 && !isLeap(year) ? 28 : bd;
    return Date.UTC(year, bm - 1, day);
  };
  const todayUTC = Date.UTC(ty, tm - 1, td);
  let next = birthdayInYear(ty);
  if (next < todayUTC) next = birthdayInYear(ty + 1);
  return Math.round((next - todayUTC) / DAY_MS);
}

/** True when today is the person's birthday. */
export function isBirthdayToday(
  dob: string | null | undefined,
  today: string = todaySAST(),
): boolean {
  return daysUntilBirthday(dob, today) === 0;
}

/** True when the birthday falls within the next 7 days (today..+6). */
export function isBirthdayThisWeek(
  dob: string | null | undefined,
  today: string = todaySAST(),
): boolean {
  const d = daysUntilBirthday(dob, today);
  return d !== null && d <= 6;
}

/** Age the person reaches on their next birthday occurrence. null if invalid. */
export function ageTurning(
  dob: string | null | undefined,
  today: string = todaySAST(),
): number | null {
  const d = daysUntilBirthday(dob, today);
  if (d === null || !dob) return null;
  const b = DATE_RE.exec(dob.trim());
  const t = DATE_RE.exec(today);
  if (!b || !t) return null;
  const by = +b[1];
  const ty = +t[1], tm = +t[2], td = +t[3];
  const nextBirthday = new Date(Date.UTC(ty, tm - 1, td + d));
  return nextBirthday.getUTCFullYear() - by;
}
