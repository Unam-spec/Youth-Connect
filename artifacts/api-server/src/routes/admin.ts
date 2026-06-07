import { Router, Request, Response } from "express";
import { ne, inArray } from "drizzle-orm";
import {
  db,
  profilesTable,
  leaderPermissionsTable,
  rsvpsTable,
  attendanceTable,
  membershipRequestsTable,
  checkInRequestsTable,
  eventsTable,
  visitorsTable,
} from "@workspace/db";
import { requireLeaderSession } from "../middlewares/requireLeaderSession";

const router = Router();

router.post("/reset-data", requireLeaderSession("super_admin"), async (req: Request, res: Response) => {
  try {
    await db.transaction(async (tx) => {
      // 1. Delete all check-in requests
      await tx.delete(checkInRequestsTable);
      // 2. Delete all attendance
      await tx.delete(attendanceTable);
      // 3. Delete all RSVPs
      await tx.delete(rsvpsTable);
      // 4. Delete all events
      await tx.delete(eventsTable);
      // 5. Delete all membership requests
      await tx.delete(membershipRequestsTable);
      
      // 6. Delete all leader permissions for non-super_admins
      const nonSuperAdmins = await tx
        .select({ id: profilesTable.id })
        .from(profilesTable)
        .where(ne(profilesTable.role, "super_admin"));
      const nonAdminIds = nonSuperAdmins.map((p) => p.id);
      
      if (nonAdminIds.length > 0) {
        await tx.delete(leaderPermissionsTable).where(inArray(leaderPermissionsTable.profile_id, nonAdminIds));
      }
      
      // 7. Delete all visitors
      await tx.delete(visitorsTable);
      // 8. Delete all profiles EXCEPT super admins
      await tx.delete(profilesTable).where(ne(profilesTable.role, "super_admin"));
    });

    return res.json({ success: true, message: "All test data has been successfully wiped." });
  } catch (err: any) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
