import { db, profilesTable } from "@workspace/db";
import { and, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { phoneKey } from "./phone";
import { dedupeGroups, nameKey, nameKeySql, phoneKeySql, type DuplicateKind } from "./duplicates";

export interface DuplicateMatch {
  kind: DuplicateKind;
  profile: { id: string; full_name: string; username: string | null };
}

/**
 * Is this person already signed up? Checks the phone number first (however
 * it's typed), then the same name with the same date of birth or parent's
 * number. `excludeId` skips the person's own row when they edit themselves.
 */
export async function findProfileDuplicate(input: {
  phone?: unknown;
  fullName?: unknown;
  dateOfBirth?: unknown;
  parentPhone?: unknown;
  excludeId?: string;
}): Promise<DuplicateMatch | null> {
  const notSelf = input.excludeId ? ne(profilesTable.id, input.excludeId) : undefined;
  const pick = { id: profilesTable.id, full_name: profilesTable.full_name, username: profilesTable.username };

  const pk = phoneKey(input.phone);
  if (pk) {
    const [row] = await db
      .select(pick)
      .from(profilesTable)
      .where(and(sql`${phoneKeySql(profilesTable.phone)} = ${pk}`, notSelf))
      .limit(1);
    if (row) return { kind: "phone", profile: row };
  }

  const nk = nameKey(input.fullName);
  if (!nk) return null;
  const dob = typeof input.dateOfBirth === "string" && input.dateOfBirth.trim() ? input.dateOfBirth.trim() : null;
  const parentKey = phoneKey(input.parentPhone);
  const details: SQL[] = [];
  if (dob) details.push(sql`${profilesTable.date_of_birth} = ${dob}`);
  if (parentKey) details.push(sql`${phoneKeySql(profilesTable.parent_phone)} = ${parentKey}`);
  if (!details.length) return null;
  const [row] = await db
    .select(pick)
    .from(profilesTable)
    .where(and(sql`${nameKeySql(profilesTable.full_name)} = ${nk}`, or(...details), notSelf))
    .limit(1);
  return row ? { kind: "details", profile: row } : null;
}

export type DuplicateReason = "phone" | "name_and_birthday" | "name";

export interface DuplicateGroup {
  reason: DuplicateReason;
  profiles: {
    id: string;
    full_name: string;
    username: string | null;
    phone: string | null;
    date_of_birth: string | null;
    role: string;
    created_at: Date;
  }[];
}

/**
 * Every set of profiles that look like the same person, for leaders to
 * review and merge: same phone number, same name and birthday, or just the
 * same name (weaker, shown last). A pair only shows under its strongest reason.
 */
export async function findDuplicateGroups(): Promise<DuplicateGroup[]> {
  const byPhone = await db.execute<{ ids: string[] }>(sql`
    select array_agg(id::text order by created_at) as ids from (
      select id, created_at, ${phoneKeySql(profilesTable.phone)} as k from ${profilesTable}
    ) t where length(k) >= 7 group by k having count(*) > 1`);
  const byNameDob = await db.execute<{ ids: string[] }>(sql`
    select array_agg(id::text order by created_at) as ids from ${profilesTable}
    where date_of_birth is not null and btrim(full_name) <> ''
    group by ${nameKeySql(profilesTable.full_name)}, date_of_birth having count(*) > 1`);
  const byName = await db.execute<{ ids: string[] }>(sql`
    select array_agg(id::text order by created_at) as ids from ${profilesTable}
    where btrim(full_name) <> '' and lower(btrim(full_name)) <> 'new member'
    group by ${nameKeySql(profilesTable.full_name)} having count(*) > 1`);

  const raw: { reason: DuplicateReason; ids: string[] }[] = [
    ...byPhone.rows.map((r) => ({ reason: "phone" as const, ids: r.ids })),
    ...byNameDob.rows.map((r) => ({ reason: "name_and_birthday" as const, ids: r.ids })),
    ...byName.rows.map((r) => ({ reason: "name" as const, ids: r.ids })),
  ];
  const groups = dedupeGroups(raw);
  const allIds = [...new Set(groups.flatMap((g) => g.ids))];
  if (!allIds.length) return [];
  const rows = await db
    .select({
      id: profilesTable.id,
      full_name: profilesTable.full_name,
      username: profilesTable.username,
      phone: profilesTable.phone,
      date_of_birth: profilesTable.date_of_birth,
      role: profilesTable.role,
      created_at: profilesTable.created_at,
    })
    .from(profilesTable)
    .where(inArray(profilesTable.id, allIds));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return groups
    .map((g) => ({ reason: g.reason, profiles: g.ids.map((id) => byId.get(id)).filter((p) => !!p) }))
    .filter((g) => g.profiles.length > 1);
}
