// Pure resolution of the age fields a signup/self-serve client may send:
// prefers date_of_birth (age derived), falls back to a bare legacy age from
// older deployed clients, and treats empty strings as absent. Shared by the
// PIN-account routes.
import { validateDob, todaySAST } from "./age";

export type SignupAgeResult =
  | { ok: true; date_of_birth: string | null; age: number | null }
  | { ok: false; error: string };

export function resolveSignupAge(
  body: { date_of_birth?: unknown; age?: unknown },
  today: string = todaySAST(),
): SignupAgeResult {
  const dobRaw = body.date_of_birth;
  if (dobRaw !== undefined && dobRaw !== null && dobRaw !== "") {
    const v = validateDob(dobRaw, today);
    if (!v.ok) return { ok: false, error: v.error! };
    return { ok: true, date_of_birth: String(dobRaw).trim(), age: v.age! };
  }

  const ageRaw = body.age;
  if (ageRaw === undefined || ageRaw === null || ageRaw === "") {
    return { ok: true, date_of_birth: null, age: null };
  }
  const age = parseInt(String(ageRaw), 10);
  if (Number.isNaN(age) || age < 1 || age > 120) {
    return { ok: false, error: "age must be a valid number between 1 and 120" };
  }
  return { ok: true, date_of_birth: null, age };
}
