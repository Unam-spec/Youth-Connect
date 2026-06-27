import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, profilesTable } from "@workspace/db";
import { validateLeaderSession } from "../lib/validateLeaderSession";

const ROLE_HIERARCHY: Record<string, number> = {
  leader: 1,
  super_admin: 2,
};

// ── In-memory session cache ─────────────────────────────────────────────────
// Avoids re-querying the DB on every protected request from the same session.
// Entries auto-expire after SESSION_CACHE_TTL_MS. The cache is keyed by either
// the Clerk userId or the PIN session_token so different auth methods don't
// collide.
const SESSION_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const sessionCache = new Map<string, { profile: any; expiresAt: number }>();

function getCachedProfile(cacheKey: string): any | null {
  const entry = sessionCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    sessionCache.delete(cacheKey);
    return null;
  }
  return entry.profile;
}

function setCachedProfile(cacheKey: string, profile: any): void {
  sessionCache.set(cacheKey, {
    profile,
    expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
  });
}

export function requireLeaderSession(minRole: "leader" | "super_admin" = "leader"): any {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      let profile: any = null;
      let cacheKey: string | null = null;

      // 1. Try Clerk Authentication first
      try {
        const clerkAuth = getAuth(req);
        if (clerkAuth?.userId) {
          cacheKey = `clerk:${clerkAuth.userId}`;
          profile = getCachedProfile(cacheKey);
          if (!profile) {
            profile = await db.query.profilesTable.findFirst({
              where: eq(profilesTable.clerk_id, clerkAuth.userId),
            });
            if (profile) setCachedProfile(cacheKey, profile);
          }
        }
      } catch (clerkErr) {
        // Log Clerk errors so token mismatches or missing env vars are visible in server logs
        req.log.warn({ err: clerkErr }, "Clerk Authentication failed in requireLeaderSession");
      }

      // 2. If no Clerk profile, try PIN-based session (x-leader-session)
      if (!profile) {
        const header = req.headers["x-leader-session"];
        if (typeof header === "string") {
          try {
            const parsed = JSON.parse(header) as Record<string, unknown>;
            const token = parsed.session_token;
            if (typeof token === "string") {
              cacheKey = `pin:${token}`;
              profile = getCachedProfile(cacheKey);
            }
          } catch { /* parse failed — fall through to full validation */ }
        }
        if (!profile) {
          profile = await validateLeaderSession(header);
          if (profile && cacheKey) setCachedProfile(cacheKey, profile);
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

