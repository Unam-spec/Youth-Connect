import { sql, type SQL, type AnyColumn } from "drizzle-orm";

/**
 * Duplicate sign-up checks shared by JG Youth and the Worship Team.
 *
 * - The same phone number can't be used twice, however it's typed
 *   (`phoneKey` in lib/phone.ts, `phoneKeySql` here).
 * - The same name plus the same details (date of birth, or parent's number)
 *   means it's the same person signing up again.
 */

/** "  thabo   MOKOENA " → "thabo mokoena". Accents are kept. */
export function nameKey(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const k = name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  return k || null;
}

/** SQL twin of nameKey (without NFKC, which Postgres lacks by default). */
export function nameKeySql(col: AnyColumn | SQL): SQL {
  return sql`lower(regexp_replace(btrim(coalesce(${col}, '')), '\\s+', ' ', 'g'))`;
}

/** SQL twin of phoneKey: digits only, 00 dropped, SA local 0XXXXXXXXX → 27XXXXXXXXX. */
export function phoneKeySql(col: AnyColumn | SQL): SQL {
  const d = sql`regexp_replace(coalesce(${col}, ''), '[^0-9]', '', 'g')`;
  const step1 = sql`(case
    when ${d} ~ '^00' then substr(${d}, 3)
    when ${d} ~ '^0[0-9]{9}$' then '27' || substr(${d}, 2)
    else ${d} end)`;
  return sql`(case when ${step1} ~ '^270[0-9]{9}$' then '27' || substr(${step1}, 4) else ${step1} end)`;
}

export type DuplicateKind = "phone" | "details";

export const DUPLICATE_MESSAGES: Record<DuplicateKind, string> = {
  phone:
    "This number has already been used to sign up. Sign in instead, or ask a leader if you think this is a mistake.",
  details:
    "Someone with this name and these details has already signed up. If that's you, sign in instead. A leader can help if you've forgotten your login.",
};

/**
 * Drops a group when a stronger reason already covers all of its people, so
 * two people with the same number and name show once, as "same phone".
 * `groups` must be ordered strongest reason first.
 */
export function dedupeGroups<T extends { ids: string[] }>(groups: T[]): T[] {
  const kept: T[] = [];
  for (const g of groups) {
    const covered = kept.some((k) => g.ids.every((id) => k.ids.includes(id)));
    if (!covered) kept.push(g);
  }
  return kept;
}
