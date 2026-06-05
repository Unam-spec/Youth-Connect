import {
  db,
  profilesTable,
  attendanceTable,
  rsvpsTable,
  membershipRequestsTable,
  checkInRequestsTable,
  leaderPermissionsTable,
  eventsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Deletes a profile and all rows that FK-reference it, inside one transaction.
 * Child rows that merely *reference* the profile via a nullable audit column
 * (reviewed_by, created_by) are nulled rather than deleted, to preserve the
 * referenced records (events, other members' requests).
 *
 * Note: chat `messages` are intentionally NOT touched — they have no FK to
 * profiles (sender_id is free text) and live on a separate connection.
 * The caller is responsible for deleting the Clerk user AFTER this resolves.
 */
export async function deleteProfileCascade(profileId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(attendanceTable).where(eq(attendanceTable.profile_id, profileId));
    await tx.delete(rsvpsTable).where(eq(rsvpsTable.profile_id, profileId));
    await tx.delete(checkInRequestsTable).where(eq(checkInRequestsTable.profile_id, profileId));
    await tx
      .update(checkInRequestsTable)
      .set({ reviewed_by: null })
      .where(eq(checkInRequestsTable.reviewed_by, profileId));
    await tx.delete(membershipRequestsTable).where(eq(membershipRequestsTable.profile_id, profileId));
    await tx
      .update(membershipRequestsTable)
      .set({ reviewed_by: null })
      .where(eq(membershipRequestsTable.reviewed_by, profileId));
    await tx.delete(leaderPermissionsTable).where(eq(leaderPermissionsTable.profile_id, profileId));
    await tx.update(eventsTable).set({ created_by: null }).where(eq(eventsTable.created_by, profileId));
    await tx.delete(profilesTable).where(eq(profilesTable.id, profileId));
  });
}
