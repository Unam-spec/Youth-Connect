import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, profilesTable } from "@workspace/db";

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
        // Log or ignore if Clerk middleware is not active for this route
      }

      // 2. If no Clerk profile, try Custom PIN-based session (x-leader-session)
      if (!profile) {
        const sessionHeader = req.headers["x-leader-session"];
        if (sessionHeader) {
          let parsedSession: any;
          try {
            parsedSession = JSON.parse(sessionHeader as string);
          } catch (err) {
            return res.status(401).json({ error: "Unauthorized: Invalid session format" });
          }

          const { profile_id, session_token, expires_at } = parsedSession;
          if (!profile_id || !session_token || !expires_at) {
            return res.status(401).json({ error: "Unauthorized: Incomplete session payload" });
          }

          if (new Date(expires_at) < new Date()) {
            return res.status(401).json({ error: "Unauthorized: Session expired" });
          }

          profile = await db.query.profilesTable.findFirst({
            where: eq(profilesTable.id, profile_id),
          });

          if (!profile) {
            return res.status(401).json({ error: "Unauthorized: Leader profile not found" });
          }

          if (!profile.session_token || profile.session_token !== session_token) {
            return res.status(401).json({ error: "Unauthorized: Session revoked or invalid" });
          }
        }
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
