/**
 * Sessions last 30 days since you last used the app (server-enforced and
 * rolled forward in api-server lib/sessions.ts).
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ROLL_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * Keeps a stored login's local expiry in step with the server's rolling one:
 * at most once a day, push it to now + 30 days. The server still decides if
 * the session is valid; this only stops the app discarding a live login.
 */
export function rollStoredExpiry<T extends { expires_at: number }>(key: string, session: T): T {
  const now = Date.now();
  if (session.expires_at - now >= SESSION_TTL_MS - ROLL_EVERY_MS) return session;
  const rolled = { ...session, expires_at: now + SESSION_TTL_MS };
  try {
    localStorage.setItem(key, JSON.stringify(rolled));
  } catch {
    /* storage blocked — keep using the in-memory copy */
  }
  return rolled;
}

export interface LeaderSession {
  role: "super_admin" | "leader";
  profile_id?: string;
  full_name?: string;
  // Required by the backend's strict PIN-session validation (matched against
  // profiles.session_token). Absent for Clerk-authenticated sessions, which
  // authorize via the Bearer token instead.
  session_token?: string;
  can_create_events?: boolean;
  can_view_kpis?: boolean;
  can_view_members?: boolean;
  can_view_attendance?: boolean;
  expires_at: number;
}

export function setLeaderSession(session: Omit<LeaderSession, "expires_at">) {
  // Matches the server's 30-day session lifetime (the server enforces the
  // real expiry; this just stops the app discarding a still-valid login).
  const expires_at = Date.now() + SESSION_TTL_MS;
  localStorage.setItem(
    "jg_leader_session",
    JSON.stringify({ ...session, expires_at }),
  );
}

export function getLeaderSession(): LeaderSession | null {
  const sessionStr = localStorage.getItem("jg_leader_session");
  if (!sessionStr) return null;

  try {
    const session: LeaderSession = JSON.parse(sessionStr);
    if (Date.now() > session.expires_at) {
      localStorage.removeItem("jg_leader_session");
      return null;
    }
    return rollStoredExpiry("jg_leader_session", session);
  } catch {
    return null;
  }
}

export function clearLeaderSession() {
  localStorage.removeItem("jg_leader_session");
}
