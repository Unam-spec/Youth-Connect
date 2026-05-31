import { Router, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import * as Sentry from "@sentry/node";
import { requireLeaderSession } from "../middlewares/requireLeaderSession";
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

const requireSuperAdmin = requireLeaderSession("super_admin");

router.delete("/wipe-all", requireSuperAdmin, async (req: Request, res: Response) => {
  const { confirmToken } = req.body;

  if (confirmToken !== "CONFIRM_WIPE") {
    return res.status(400).json({ error: "Invalid confirmation token" });
  }

  Sentry.addBreadcrumb({
    category: "admin.wipe",
    message: "Full data wipe initiated",
    level: "warning",
    data: { adminId: (req as any).leaderId, timestamp: new Date().toISOString() }
  });
  Sentry.captureMessage("Admin wipe executed", "warning");

  try {
    // 1. Delete all check-in requests
    await db.delete(checkInRequestsTable);
    // 2. Delete all attendance
    await db.delete(attendanceTable);
    // 3. Delete all RSVPs
    await db.delete(rsvpsTable);
    // 4. Delete all events
    await db.delete(eventsTable);
    // 5. Delete all membership requests
    await db.delete(membershipRequestsTable);
    
    // 6. Delete all leader permissions for non-super_admins
    const nonSuperAdmins = await db
      .select({ id: profilesTable.id })
      .from(profilesTable)
      .where(ne(profilesTable.role, "super_admin"));
    const nonAdminIds = nonSuperAdmins.map((p: any) => p.id);
    
    if (nonAdminIds.length > 0) {
      const { inArray } = await import("drizzle-orm");
      await db.delete(leaderPermissionsTable).where(inArray(leaderPermissionsTable.profile_id, nonAdminIds));
    }
    
    // 7. Delete all visitors
    await db.delete(visitorsTable);
    // 8. Delete all profiles EXCEPT super admins
    await db.delete(profilesTable).where(ne(profilesTable.role, "super_admin"));

    return res.status(200).json({ success: true });
  } catch (err: any) {
    Sentry.captureException(err);
    return res.status(500).json({ error: "Wipe failed" });
  }
});

export default router;
