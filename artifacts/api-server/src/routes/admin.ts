import { Router, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { eq, ne } from "drizzle-orm";
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

function hasLeaderSession(req: any): boolean {
  try {
    const h = req.headers["x-leader-session"];
    if (!h) return false;
    const s = JSON.parse(h as string);
    return typeof s?.expires_at === "number" && Date.now() < s.expires_at;
  } catch {
    return false;
  }
}

const router = Router();

router.post("/reset-data", async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    const isLeaderSess = hasLeaderSession(req);
    if (!auth?.userId && !isLeaderSess)
      return res.status(401).json({ error: "Unauthorized" });

    let requesterProfile: any = null;
    if (auth?.userId) {
      requesterProfile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.clerk_id, auth.userId),
      });
    } else {
      const session = JSON.parse(req.headers["x-leader-session"] as string);
      requesterProfile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.id, session.profile_id),
      });
    }

    if (!requesterProfile || requesterProfile.role !== "super_admin") {
      return res.status(403).json({ error: "Forbidden. Super admins only." });
    }

    await db.transaction(async (tx: any) => {
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
      const nonAdminIds = nonSuperAdmins.map((p: any) => p.id);
      
      if (nonAdminIds.length > 0) {
        const { inArray } = await import("drizzle-orm");
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
