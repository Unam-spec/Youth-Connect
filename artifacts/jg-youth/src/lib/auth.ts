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
  const expires_at = Date.now() + 8 * 60 * 60 * 1000; // 8 hours
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
    return session;
  } catch {
    return null;
  }
}

export function clearLeaderSession() {
  localStorage.removeItem("jg_leader_session");
}
