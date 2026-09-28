import { SESSION_TTL_MS } from "./auth";

export interface PinSession {
  role: "visitor" | "member";
  profile_id: string;
  session_token: string;
  username?: string;
  expires_at: number;
}

export function setPinSession(session: Omit<PinSession, "expires_at">): void {
  // Matches the server's 30-day session lifetime (the server enforces the
  // real expiry; this just stops the app discarding a still-valid login).
  const expires_at = Date.now() + SESSION_TTL_MS;
  localStorage.setItem("jg_pin_session", JSON.stringify({ ...session, expires_at }));
}

export function getPinSession(): PinSession | null {
  const raw = localStorage.getItem("jg_pin_session");
  if (!raw) return null;
  try {
    const session: PinSession = JSON.parse(raw);
    if (Date.now() > session.expires_at) {
      localStorage.removeItem("jg_pin_session");
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function clearPinSession(): void {
  localStorage.removeItem("jg_pin_session");
}
