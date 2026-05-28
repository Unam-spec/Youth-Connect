import { Request } from "express";
import { getAuth } from "@clerk/express";
import { db, profilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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

  // ── PIN / leader session header ────────────────────────────────────────────
  const header = req.headers["x-leader-session"];
  if (header) {
    try {
      const session = JSON.parse(header as string);
      if (session?.expires_at && Date.now() < session.expires_at && session.profile_id) {
        return {
          type: "leader_session",
          userId: null,
          profileId: session.profile_id,
          role: session.role ?? "leader",
          canCreateEvents: session.can_create_events ?? (session.role === "super_admin"),
          canViewKpis: session.can_view_kpis ?? true,
          canViewMembers: session.can_view_members ?? true,
          canViewAttendance: session.can_view_attendance ?? true,
        };
      }
    } catch {
      // malformed header — fall through
    }
  }

  return null;
}

/** Convenience: returns true if the resolved auth has a privileged role */
export function isPrivilegedAuth(auth: ResolvedAuth | null): boolean {
  return auth?.role === "super_admin" || auth?.role === "leader";
}
