import { db, profilesTable, authSessionsTable, type Profile } from "@workspace/db";
import { eq } from "drizzle-orm";
import { extendedExpiry, isUuid, shouldExtendSession } from "./sessions";

/**
 * Validates a PIN session from the x-leader-session header against the
 * multi-device auth_sessions table (expiry enforced from the DB row, never the
 * header). Using a session rolls its 30-day expiry forward, so people who use
 * the app stay signed in. Returns the backing profile, or null.
 *
 * (The pre-2026-09 single profiles.session_token fallback trusted the
 * header's expires_at, capped at 8 hours; every such session has long
 * expired, and with clients now rolling their own expiry it would never end,
 * so it's gone.)
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

  const { profile_id, session_token } = parsed as Record<string, unknown>;
  if (typeof profile_id !== "string" || typeof session_token !== "string") return null;
  // Both columns are uuid; a malformed value would make Postgres throw.
  if (!isUuid(profile_id) || !isUuid(session_token)) return null;

  const session = await db.query.authSessionsTable.findFirst({
    where: eq(authSessionsTable.token, session_token),
  });
  if (!session || session.profile_id !== profile_id) return null;
  if (session.expires_at.getTime() <= Date.now()) return null;

  if (shouldExtendSession(session.expires_at)) {
    await db
      .update(authSessionsTable)
      .set({ expires_at: extendedExpiry() })
      .where(eq(authSessionsTable.token, session_token));
  }

  const profile = await db.query.profilesTable.findFirst({
    where: eq(profilesTable.id, profile_id),
  });
  return profile ?? null;
}
