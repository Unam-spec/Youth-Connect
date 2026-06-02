import {
  db,
  profilesTable,
  attendanceTable,
  rsvpsTable,
  membershipRequestsTable,
  checkInRequestsTable,
  leaderPermissionsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

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
  ] as const;
  for (const f of fields) {
    if (isBlank(keep[f]) && !isBlank(merge[f])) out[f] = merge[f];
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

    // attendance → reassign all
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

    // check_in_requests → reassign profile_id + reviewed_by
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

    // backfill missing fields on keep
    const backfill = pickBackfill(keep, merge);
    if (Object.keys(backfill).length) {
      await tx.update(profilesTable).set(backfill).where(eq(profilesTable.id, keepId));
    }

    // delete the merge profile
    await tx.delete(profilesTable).where(eq(profilesTable.id, mergeId));

    return { mergeClerkId: merge.clerk_id ?? null };
  });
}
