import { db, profilesTable, authSessionsTable, type Profile } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isUuid } from "./sessions";

/**
 * Validates a PIN session from the x-leader-session header.
 *
 * Checks the multi-device auth_sessions table first (expiry enforced from the
 * DB row). Falls back to the legacy single profiles.session_token so people
 * logged in before the 30-day sessions rollout aren't kicked out; those legacy
 * sessions still rely on the header's expires_at (at most 8 hours).
 * Returns the backing profile, or null.
 */
export async function validateLeaderSession(header: unknown): Promise<Profile | null> {
  if (typeof header !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(header);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const { profile_id, session_token, expires_at } = parsed as Record<string, unknown>;
  if (typeof profile_id !== "string" || typeof session_token !== "string") return null;
  // Both columns are uuid; a malformed value would make Postgres throw.
  if (!isUuid(profile_id) || !isUuid(session_token)) return null;

  // 1. Multi-device session row.
  const session = await db.query.authSessionsTable.findFirst({
    where: eq(authSessionsTable.token, session_token),
  });
  if (session) {
    if (session.profile_id !== profile_id) return null;
    if (session.expires_at.getTime() <= Date.now()) return null;
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, profile_id),
    });
    return profile ?? null;
  }

  // 2. Legacy single-token session.
  const exp =
    typeof expires_at === "number"
      ? expires_at
      : typeof expires_at === "string"
        ? Date.parse(expires_at)
        : NaN;
  if (!Number.isFinite(exp) || Date.now() >= exp) return null;

  const profile = await db.query.profilesTable.findFirst({
    where: eq(profilesTable.id, profile_id),
  });
  if (!profile || !profile.session_token || profile.session_token !== session_token) {
    return null;
  }
  return profile;
}
