/**
 * Worship Team client helpers. Worship is its own membership, separate from
 * JG Youth: its session lives under its own localStorage key and is sent in
 * its own `x-worship-session` header — never Clerk or the leader/PIN session.
 */
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { rollStoredExpiry } from "./auth";

const STORAGE_KEY = "jg_worship_session";

export interface WorshipSession {
  session_token: string;
  expires_at: number;
}

export interface WorshipAccount {
  id: string;
  full_name: string;
  role: "owner" | "leader" | "member";
  status: "pending" | "approved";
  instruments: string[];
  vocal_range: string | null;
  bio: string | null;
  created_at: string;
  phone?: string;
  notifications_muted?: boolean;
  song_count?: number;
}

export interface WorshipSong {
  id: string;
  title: string;
  artist: string | null;
  original_key: string | null;
  tempo_bpm: number | null;
  lyrics: string;
  created_by: string | null;
}

export interface LibrarySong {
  id: string;
  title: string;
  artist: string | null;
  original_key: string | null;
  tempo_bpm: number | null;
  my_key: string | null;
  in_my_list: boolean;
  member_count: number;
}

export interface MemberSong {
  song_id: string;
  title: string;
  artist: string | null;
  original_key: string | null;
  tempo_bpm: number | null;
  preferred_key: string | null;
  notes: string | null;
}

export interface WorshipNotification {
  id: string;
  type: string;
  message: string;
  url: string;
  read_at: string | null;
  created_at: string;
}

export const INSTRUMENTS = [
  "vocals",
  "keys",
  "acoustic guitar",
  "electric guitar",
  "bass",
  "drums",
  "other",
] as const;

export function getWorshipSession(): WorshipSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as WorshipSession;
    if (!s.session_token || Date.now() > s.expires_at) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return rollStoredExpiry(STORAGE_KEY, s);
  } catch {
    return null;
  }
}

export function setWorshipSession(s: WorshipSession): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ session_token: s.session_token, expires_at: s.expires_at }),
    );
  } catch {
    /* storage blocked — the session just won't survive a reload */
  }
}

export function clearWorshipSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export class WorshipApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** JSON fetch against /api/worship/* with the worship session attached. */
export async function worshipFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const session = getWorshipSession();
  const res = await fetch(`/api/worship${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { "x-worship-session": session.session_token } : {}),
      ...(options.headers as Record<string, string>),
    },
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401) clearWorshipSession();
    throw new WorshipApiError(data.error ?? "Something went wrong. Try again.", res.status);
  }
  return data as T;
}

export function worshipPost<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  return worshipFetch<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
}

export const worshipKeys = {
  me: ["worship", "me"] as const,
  members: ["worship", "members"] as const,
  member: (id: string) => ["worship", "member", id] as const,
  requests: ["worship", "requests"] as const,
  songs: (q: string) => ["worship", "songs", q] as const,
  song: (id: string) => ["worship", "song", id] as const,
  notifications: ["worship", "notifications"] as const,
};

/** The signed-in worship account, or null when signed out. */
export function useWorshipMe(
  opts: Partial<UseQueryOptions<WorshipAccount | null>> = {},
) {
  return useQuery<WorshipAccount | null>({
    queryKey: worshipKeys.me,
    queryFn: async () => {
      if (!getWorshipSession()) return null;
      try {
        return (await worshipFetch<{ account: WorshipAccount }>("/me")).account;
      } catch (err) {
        if (err instanceof WorshipApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 30_000,
    ...opts,
  });
}

/** Head leader ("owner") and leaders can accept join requests. */
export function canApprove(a: { role: string }): boolean {
  return a.role === "owner" || a.role === "leader";
}

export function roleLabel(role: string): string | null {
  if (role === "owner") return "Head leader";
  if (role === "leader") return "Leader";
  return null;
}

export function instrumentLabel(i: string): string {
  return i.charAt(0).toUpperCase() + i.slice(1);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
