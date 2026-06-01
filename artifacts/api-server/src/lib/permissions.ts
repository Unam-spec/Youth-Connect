import { Request } from "express";
import { getAuth } from "@clerk/express";
import { db, profilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { validateLeaderSession } from "./validateLeaderSession";

export interface ResolvedAuth {
  type: "clerk" | "leader_session";
  userId: string | null;
  profileId: string | null;
  role: "super_admin" | "leader" | "member" | "visitor";
  canCreateEvents: boolean;
  canViewKpis: boolean;
  canViewMembers: boolean;
  canViewAttendance: boolean;
}

/**
 * Resolves who is making the request.
 * Checks Clerk JWT first, then falls back to the x-leader-session header
 * used by PIN-authenticated leaders.
 */
export async function resolveAuth(req: Request): Promise<ResolvedAuth | null> {
  // ── Clerk JWT ──────────────────────────────────────────────────────────────
  const clerkAuth = getAuth(req);
  if (clerkAuth?.userId) {
    const [profile] = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.clerk_id, clerkAuth.userId))
      .limit(1);

    if (!profile) return null;

    const isPrivileged = profile.role === "super_admin" || profile.role === "leader";
    return {
      type: "clerk",
      userId: clerkAuth.userId,
      profileId: profile.id,
      role: profile.role as ResolvedAuth["role"],
      canCreateEvents: isPrivileged,
      canViewKpis: isPrivileged,
      canViewMembers: isPrivileged,
      canViewAttendance: isPrivileged,
    };
  }

  // ── PIN / leader session header (validated against the DB) ───────────────────
  const sessionProfile = await validateLeaderSession(req.headers["x-leader-session"]);
  if (sessionProfile) {
    const isPrivileged =
      sessionProfile.role === "super_admin" || sessionProfile.role === "leader";
    return {
      type: "leader_session",
      userId: null,
      profileId: sessionProfile.id,
      role: sessionProfile.role as ResolvedAuth["role"],
      canCreateEvents: isPrivileged || sessionProfile.can_create_events,
      canViewKpis: isPrivileged || sessionProfile.can_view_kpis,
      canViewMembers: isPrivileged || sessionProfile.can_view_members,
      canViewAttendance: isPrivileged || sessionProfile.can_view_attendance,
    };
  }

  return null;
}

/** Convenience: returns true if the resolved auth has a privileged role */
export function isPrivilegedAuth(auth: ResolvedAuth | null): boolean {
  return auth?.role === "super_admin" || auth?.role === "leader";
}
