import type { Request } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, profilesTable, type Profile } from "@workspace/db";
import { validateLeaderSession } from "./validateLeaderSession";

/**
 * Resolves the calling account from EITHER a Clerk JWT or a PIN session
 * (x-leader-session header) — same resolution order as requireLeaderSession,
 * but with no role gate. Returns the profile, or null if neither is valid.
 * Used by member-facing endpoints that must accept username+PIN accounts as
 * well as Clerk/email members.
 */
export async function resolveAccount(req: Request): Promise<Profile | null> {
  try {
    const clerkAuth = getAuth(req);
    if (clerkAuth?.userId) {
      const profile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.clerk_id, clerkAuth.userId),
      });
      if (profile) return profile;
    }
  } catch (err) {
    req.log.warn({ err }, "Clerk auth failed in resolveAccount");
  }
  return await validateLeaderSession(req.headers["x-leader-session"]);
}
