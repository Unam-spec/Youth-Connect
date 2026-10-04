import { eq } from "drizzle-orm";
import { db, authSessionsTable, profilesTable } from "@workspace/db";

/**
 * Login sessions for PIN leaders and username+PIN accounts.
 *
 * Each login gets its own row in auth_sessions, so signing in on a phone no
 * longer logs you out on the laptop. Sessions roll: they expire after 30 days
 * of *not* using the app, because every use pushes the expiry forward (at
 * most once a day). The expiry is enforced here on the server, not trusted
 * from the client.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** How often a used session's expiry is pushed forward. */
const SESSION_EXTEND_EVERY_MS = 24 * 60 * 60 * 1000; // 1 day

/**
 * Whether a still-valid session should be extended to now + 30 days. True
 * once it's been extended more than a day ago, so active people never hit
 * the 30-day cutoff while the DB sees at most one write per device per day.
 */
export function shouldExtendSession(expiresAt: Date, now = Date.now()): boolean {
  return expiresAt.getTime() - now < SESSION_TTL_MS - SESSION_EXTEND_EVERY_MS;
}

/** The new expiry for a session that's just been used. */
export function extendedExpiry(now = Date.now()): Date {
  return new Date(now + SESSION_TTL_MS);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Creates a new session for this profile and returns what the client stores. */
export async function createSession(
  profileId: string,
  userAgent?: string | null,
): Promise<{ session_token: string; expires_at: number }> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const [row] = await db
    .insert(authSessionsTable)
    .values({
      profile_id: profileId,
      expires_at: expiresAt,
      user_agent: userAgent ? userAgent.slice(0, 300) : null,
    })
    .returning({ token: authSessionsTable.token });
  return { session_token: row.token, expires_at: expiresAt.getTime() };
}

/** Ends one session (this device's logout). */
export async function revokeSession(token: string): Promise<void> {
  if (!isUuid(token)) return;
  await db.delete(authSessionsTable).where(eq(authSessionsTable.token, token));
}

/**
 * Logs a profile out everywhere: every session row, plus the legacy
 * single-token column. Used on revoke, demotion and PIN reset.
 */
export async function revokeAllSessions(profileId: string): Promise<void> {
  await db.delete(authSessionsTable).where(eq(authSessionsTable.profile_id, profileId));
  await db
    .update(profilesTable)
    .set({ session_token: null })
    .where(eq(profilesTable.id, profileId));
}

/** Reads the session token out of an x-leader-session header, if present. */
export function tokenFromHeader(header: unknown): string | null {
  if (typeof header !== "string") return null;
  try {
    const parsed = JSON.parse(header) as Record<string, unknown>;
    return typeof parsed.session_token === "string" ? parsed.session_token : null;
  } catch {
    return null;
  }
}
