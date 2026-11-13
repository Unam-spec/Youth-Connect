import {
  db,
  profilesTable,
  attendanceTable,
  rsvpsTable,
  membershipRequestsTable,
  checkInRequestsTable,
  leaderPermissionsTable,
  eventsTable,
  feedbacksTable,
  followUpQueueTable,
  pushSubscriptionsTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

interface RsvpRef {
  id: string;
  event_id: string;
}

/**
 * Decides which of the merge profile's rsvps can be reassigned to the keep
 * profile and which must be deleted (because the keep profile already has an
 * rsvp for that event — the (event_id, profile_id) pair must stay unique).
 */
export function planRsvpMerge(
  keepRsvps: RsvpRef[],
  mergeRsvps: RsvpRef[],
): { reassignIds: string[]; deleteIds: string[] } {
  const keepEventIds = new Set(keepRsvps.map((r) => r.event_id));
  const reassignIds: string[] = [];
  const deleteIds: string[] = [];
  for (const r of mergeRsvps) {
    if (keepEventIds.has(r.event_id)) deleteIds.push(r.id);
    else reassignIds.push(r.id);
  }
  return { reassignIds, deleteIds };
}

/** Backfill keep's null/blank fields from merge. */
function pickBackfill(
  keep: typeof profilesTable.$inferSelect,
  merge: typeof profilesTable.$inferSelect,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const isBlank = (v: unknown) =>
    v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  const fields = [
    "phone",
    "email",
    "school",
    "parent_phone",
    "parent_name",
    "avatar_url",
    "gender",
    "age",
    "date_of_birth",
    "clerk_id",
  ] as const;
  for (const f of fields) {
    if (isBlank(keep[f]) && !isBlank(merge[f])) out[f] = merge[f];
  }
  // Username and PIN travel together, so the login the person knows still
  // works when the kept profile has none of its own.
  if (isBlank(keep.username) && !isBlank(merge.username)) {
    out.username = merge.username;
    out.pin_hash = merge.pin_hash;
    out.pin_plain = merge.pin_plain;
  }
  return out;
}

/**
 * Merges `mergeId` into `keepId` inside one transaction: moves attendance,
 * rsvps (conflict-safe), membership_requests, check_in_requests, leader_permissions,
 * backfills missing fields on keep, then deletes the merge profile row.
 * Returns the merge profile's clerk_id (if any) so the caller can delete the Clerk user.
 */
export async function mergeProfiles(
  keepId: string,
  mergeId: string,
): Promise<{ mergeClerkId: string | null }> {
  return db.transaction(async (tx) => {
    const keep = await tx.query.profilesTable.findFirst({ where: eq(profilesTable.id, keepId) });
    const merge = await tx.query.profilesTable.findFirst({ where: eq(profilesTable.id, mergeId) });
    if (!keep || !merge) throw new Error("PROFILE_NOT_FOUND");

    // attendance → one per person per night: drop merge's nights that keep
    // already has, move the rest
    await tx.execute(sql`
      DELETE FROM ${attendanceTable} m
      WHERE m.profile_id = ${mergeId}
        AND EXISTS (SELECT 1 FROM ${attendanceTable} k WHERE k.profile_id = ${keepId} AND k.session_date = m.session_date)`);
    await tx.update(attendanceTable).set({ profile_id: keepId }).where(eq(attendanceTable.profile_id, mergeId));

    // rsvps → conflict-safe
    const keepRsvps = await tx
      .select({ id: rsvpsTable.id, event_id: rsvpsTable.event_id })
      .from(rsvpsTable)
      .where(eq(rsvpsTable.profile_id, keepId));
    const mergeRsvps = await tx
      .select({ id: rsvpsTable.id, event_id: rsvpsTable.event_id })
      .from(rsvpsTable)
      .where(eq(rsvpsTable.profile_id, mergeId));
    const { reassignIds, deleteIds } = planRsvpMerge(keepRsvps, mergeRsvps);
    if (deleteIds.length) await tx.delete(rsvpsTable).where(inArray(rsvpsTable.id, deleteIds));
    if (reassignIds.length) await tx.update(rsvpsTable).set({ profile_id: keepId }).where(inArray(rsvpsTable.id, reassignIds));

    // membership_requests → reassign profile_id + reviewed_by
    await tx.update(membershipRequestsTable).set({ profile_id: keepId }).where(eq(membershipRequestsTable.profile_id, mergeId));
    await tx.update(membershipRequestsTable).set({ reviewed_by: keepId }).where(eq(membershipRequestsTable.reviewed_by, mergeId));

    // check_in_requests → same one-per-night rule, then reassign profile_id + reviewed_by
    await tx.execute(sql`
      DELETE FROM ${checkInRequestsTable} m
      WHERE m.profile_id = ${mergeId}
        AND EXISTS (SELECT 1 FROM ${checkInRequestsTable} k WHERE k.profile_id = ${keepId} AND k.session_date = m.session_date)`);
    await tx.update(checkInRequestsTable).set({ profile_id: keepId }).where(eq(checkInRequestsTable.profile_id, mergeId));
    await tx.update(checkInRequestsTable).set({ reviewed_by: keepId }).where(eq(checkInRequestsTable.reviewed_by, mergeId));

    // leader_permissions (unique per profile) → keep wins; drop merge's
    const keepPerm = await tx
      .select({ id: leaderPermissionsTable.id })
      .from(leaderPermissionsTable)
      .where(eq(leaderPermissionsTable.profile_id, keepId));
    if (keepPerm.length) {
      await tx.delete(leaderPermissionsTable).where(eq(leaderPermissionsTable.profile_id, mergeId));
    } else {
      await tx.update(leaderPermissionsTable).set({ profile_id: keepId }).where(eq(leaderPermissionsTable.profile_id, mergeId));
    }

    // events.created_by → reassign authorship to keep (FK would otherwise block the delete)
    await tx.update(eventsTable).set({ created_by: keepId }).where(eq(eventsTable.created_by, mergeId));

    // Messaging follow-ups (as the person followed up, or the leader who
    // handled them) and feedback.
    await tx.update(followUpQueueTable).set({ profile_id: keepId }).where(eq(followUpQueueTable.profile_id, mergeId));
    await tx.update(followUpQueueTable).set({ reviewed_by: keepId }).where(eq(followUpQueueTable.reviewed_by, mergeId));
    await tx.update(feedbacksTable).set({ user_id: keepId }).where(eq(feedbacksTable.user_id, mergeId));

    // Their phones keep getting notifications.
    await tx.update(pushSubscriptionsTable).set({ profile_id: keepId }).where(eq(pushSubscriptionsTable.profile_id, mergeId));

    // Anything else that points at the profile and would block the delete
    // (a table added later and not listed above) moves to keep too.
    await reassignRemainingReferences(tx, keepId, mergeId);

    // Delete the merge profile first, then copy its details onto keep: the
    // phone, username and Clerk login are unique, so they can't be on both
    // rows at once.
    const backfill = pickBackfill(keep, merge);
    await tx.delete(profilesTable).where(eq(profilesTable.id, mergeId));
    if (Object.keys(backfill).length) {
      await tx.update(profilesTable).set(backfill).where(eq(profilesTable.id, keepId));
    }

    // A Clerk login that moved to keep must not be deleted afterwards.
    const clerkMoved = backfill.clerk_id !== undefined;
    return { mergeClerkId: clerkMoved ? null : (merge.clerk_id ?? null) };
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Points every remaining single-column foreign key to profiles that would
 * block deleting `mergeId` (ON DELETE NO ACTION / RESTRICT) at `keepId`.
 * Columns that cascade or set null are left to the delete.
 */
async function reassignRemainingReferences(tx: Tx, keepId: string, mergeId: string) {
  const res = await tx.execute<{ tbl: string; col: string }>(sql`
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND c.confrelid = 'profiles'::regclass
      AND c.confdeltype IN ('a', 'r')
      AND array_length(c.conkey, 1) = 1`);
  const rows = Array.isArray(res) ? res : res.rows;
  for (const { tbl, col } of rows) {
    await tx.execute(
      sql`UPDATE ${sql.raw(quoteTable(tbl))} SET ${sql.identifier(col)} = ${keepId} WHERE ${sql.identifier(col)} = ${mergeId}`,
    );
  }
}

/** regclass text is already quoted where needed (e.g. "Foo" or public.bar); allow only safe characters. */
function quoteTable(regclass: string): string {
  if (!/^[A-Za-z0-9_."]+$/.test(regclass)) throw new Error(`Unexpected table name: ${regclass}`);
  return regclass;
}
