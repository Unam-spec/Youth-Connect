import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, profilesTable } from "@workspace/db";
import { validateLeaderSession } from "../lib/validateLeaderSession";

const ROLE_HIERARCHY: Record<string, number> = {
  leader: 1,
  super_admin: 2,
};

export function requireLeaderSession(minRole: "leader" | "super_admin" = "leader"): any {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      let profile: any = null;

      // 1. Try Clerk Authentication first
      try {
        const clerkAuth = getAuth(req);
        if (clerkAuth?.userId) {
          profile = await db.query.profilesTable.findFirst({
            where: eq(profilesTable.clerk_id, clerkAuth.userId),
          });
        }
      } catch (clerkErr) {
        // Log Clerk errors so token mismatches or missing env vars are visible in server logs
        req.log.warn({ err: clerkErr }, "Clerk Authentication failed in requireLeaderSession");
      }

      // 2. If no Clerk profile, try PIN-based session (x-leader-session)
      if (!profile) {
        profile = await validateLeaderSession(req.headers["x-leader-session"]);
      }

      // 3. If no profile found by either method, reject
      if (!profile) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // 4. Validate role hierarchy
      const userRole = profile.role;
      const minRoleLevel = ROLE_HIERARCHY[minRole] || 1;
      const userRoleLevel = ROLE_HIERARCHY[userRole] || 0;

      if (userRoleLevel < minRoleLevel) {
        return res.status(403).json({ error: "Forbidden: Insufficient permissions" });
      }

      // 5. Attach info to request object
      req.leaderId = profile.id;
      req.leaderRole = profile.role;

      next();
      return;
    } catch (err) {
      next(err);
      return;
    }
  };
}
