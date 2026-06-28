// Pure age helpers for the web app. Logic mirrors
// artifacts/api-server/src/lib/age.ts (kept in sync by hand).

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MIN_AGE = 5;
export const MAX_AGE = 100;

/** Today's date in South Africa (SAST, UTC+2) as 'YYYY-MM-DD'. */
export function todaySAST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Whole-years age from a 'YYYY-MM-DD' date of birth, or null if unknown/invalid. */
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

/**
 * Best display age: live age from date_of_birth, else the legacy stored age,
 * else "—". Used everywhere age is shown.
 */
export function displayAge(
  dob: string | null | undefined,
  storedAge: number | null | undefined,
): string {
  const live = computeAge(dob);
  if (live !== null) return String(live);
  if (typeof storedAge === "number" && storedAge > 0) return String(storedAge);
  return "—";
}
