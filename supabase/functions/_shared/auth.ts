import { eq } from "npm:drizzle-orm@0.45.2";
import { verifyToken } from "npm:@clerk/backend@1";
import type { Context, Next } from "npm:hono@4";
import { db } from "./db.ts";
import { profilesTable, type Profile } from "./schema.ts";

const CLERK_SECRET_KEY = Deno.env.get("CLERK_SECRET_KEY") ?? "";

/** Extracts and verifies the Clerk user id from the Authorization: Bearer JWT, or null. */
export async function getClerkUserId(req: Request): Promise<string | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || !CLERK_SECRET_KEY) return null;
  try {
    const payload = await verifyToken(token, { secretKey: CLERK_SECRET_KEY });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * Validates a PIN leader session from the x-leader-session header: well-formed,
 * unexpired, and session_token matching the profile row. Returns the profile or null.
 */
export async function validateLeaderSession(header: string | null): Promise<Profile | null> {
  if (!header) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(header);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { profile_id, session_token, expires_at } = parsed as Record<string, unknown>;
  if (typeof profile_id !== "string" || typeof session_token !== "string") return null;
  const exp = typeof expires_at === "number" ? expires_at : typeof expires_at === "string" ? Date.parse(expires_at) : NaN;
  if (!Number.isFinite(exp) || Date.now() >= exp) return null;
  const profile = await db.query.profilesTable.findFirst({ where: eq(profilesTable.id, profile_id) });
  if (!profile || !profile.session_token || profile.session_token !== session_token) return null;
  return profile;
}

export interface ResolvedAuth {
  type: "clerk" | "leader_session";
  profileId: string;
  role: Profile["role"];
  profile: Profile;
}

/** Resolves the caller via Clerk JWT first, then the PIN x-leader-session header. */
export async function resolveAuth(req: Request): Promise<ResolvedAuth | null> {
  const clerkId = await getClerkUserId(req);
  if (clerkId) {
    const profile = await db.query.profilesTable.findFirst({ where: eq(profilesTable.clerk_id, clerkId) });
    if (profile) return { type: "clerk", profileId: profile.id, role: profile.role, profile };
  }
  const sessionProfile = await validateLeaderSession(req.headers.get("x-leader-session"));
  if (sessionProfile) {
    return { type: "leader_session", profileId: sessionProfile.id, role: sessionProfile.role, profile: sessionProfile };
  }
  return null;
}

const ROLE_LEVEL: Record<string, number> = { leader: 1, super_admin: 2 };

/**
 * Hono middleware mirroring the Express requireLeaderSession: authenticates via
 * Clerk or PIN session and enforces a minimum role. Sets c.var.leaderId / leaderRole.
 */
export function requireRole(min: "leader" | "super_admin" = "leader") {
  return async (c: Context, next: Next) => {
    const auth = await resolveAuth(c.req.raw);
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    const userLevel = ROLE_LEVEL[auth.role] ?? 0;
    if (userLevel < (ROLE_LEVEL[min] ?? 1)) return c.json({ error: "Forbidden: Insufficient permissions" }, 403);
    c.set("leaderId", auth.profileId);
    c.set("leaderRole", auth.role);
    c.set("auth", auth);
    await next();
  };
}
