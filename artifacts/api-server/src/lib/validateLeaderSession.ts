import { db, profilesTable, type Profile } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Validates a PIN leader session from the x-leader-session header.
 * Returns the backing profile if the session is well-formed, unexpired, and its
 * session_token matches the one stored on the profile row; otherwise null.
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
