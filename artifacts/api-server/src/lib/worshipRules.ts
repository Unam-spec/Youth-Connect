/**
 * Pure rules for the Worship Team area (no DB), so they're unit-testable.
 * Worship is its own membership, with roles shaped like JG Youth's leader
 * system:
 *  - owner (head leader): the first account. The only one who can make or
 *    unmake leaders, remove people, reset PINs and edit any song. Can't be
 *    removed or demoted.
 *  - leader: same view as everyone; their one extra responsibility is
 *    accepting/declining join requests (and they're notified of them).
 *  - member.
 */

export type WorshipRole = "owner" | "leader" | "member";

/** Owner and leaders can accept/decline join requests. */
export function canApprove(actor: { role: string }): boolean {
  return actor.role === "owner" || actor.role === "leader";
}

export function isOwner(actor: { role: string }): boolean {
  return actor.role === "owner";
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

/**
 * Normalizes a phone number to +<digits> so "+27 82 123 4567", "082-123-4567"
 * and "+27821234567" are the same person. Local SA numbers (0 + 9 digits) get
 * +27. Returns null if it doesn't look like a phone number.
 */
export function normalizeWorshipPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/[\s\-().]/g, "");
  let digits: string;
  if (/^\+\d+$/.test(cleaned)) digits = cleaned.slice(1);
  else if (/^00\d+$/.test(cleaned)) digits = cleaned.slice(2);
  else if (/^0\d{9}$/.test(cleaned)) digits = "27" + cleaned.slice(1);
  else return null;
  if (digits.length < 8 || digits.length > 15) return null;
  return "+" + digits;
}

const KEY_RE = /^([A-Ga-g])([#b]?)(m?)$/;

/**
 * Normalizes a musical key ("g" → "G", "bb" → "Bb", "f#m" → "F#m").
 * Returns null for blank input and undefined for an invalid key, so callers
 * can tell "cleared" from "bad value".
 */
export function normalizeKey(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const m = KEY_RE.exec(trimmed);
  if (!m) return undefined;
  return m[1].toUpperCase() + m[2] + m[3];
}

/** Optional trimmed string with a max length; undefined means invalid. */
export function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? undefined : trimmed;
}

export function normalizeInstruments(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const out = new Set<string>();
  for (const v of value) {
    if (typeof v !== "string") return undefined;
    const lower = v.trim().toLowerCase();
    if (!(INSTRUMENTS as readonly string[]).includes(lower)) return undefined;
    out.add(lower);
  }
  return [...out];
}

export type SongInput = {
  title: string;
  artist: string | null;
  original_key: string | null;
  tempo_bpm: number | null;
  lyrics: string;
};

export type Check<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateSongInput(body: Record<string, unknown>): Check<SongInput> {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return { ok: false, error: "Song title is required." };
  if (title.length > 120) return { ok: false, error: "Song title is too long." };

  const artist = optionalText(body.artist, 120);
  if (artist === undefined) return { ok: false, error: "Artist name is too long." };

  const key = normalizeKey(body.original_key);
  if (key === undefined) return { ok: false, error: "Key must look like G, Bb or F#m." };

  let tempo: number | null = null;
  if (body.tempo_bpm !== undefined && body.tempo_bpm !== null && body.tempo_bpm !== "") {
    const n = Number(body.tempo_bpm);
    if (!Number.isInteger(n) || n < 30 || n > 300) {
      return { ok: false, error: "Tempo must be a whole number between 30 and 300." };
    }
    tempo = n;
  }

  const lyrics = typeof body.lyrics === "string" ? body.lyrics.replace(/\r\n/g, "\n") : "";
  if (lyrics.length > 20000) return { ok: false, error: "Lyrics are too long." };

  return {
    ok: true,
    value: { title, artist, original_key: key, tempo_bpm: tempo, lyrics },
  };
}

/** The head leader can edit any song; everyone else only the songs they added. */
export function canEditSong(
  actor: { id: string; role: string },
  song: { created_by: string | null },
): boolean {
  return isOwner(actor) || song.created_by === actor.id;
}

/**
 * Whether the head leader may make `target` a leader/member or remove them.
 * The head leader's own account is never changed or removed this way.
 */
export function checkMemberChange(
  target: { role: string; status: string },
  change: "remove" | "make_member" | "make_leader",
): Check<null> {
  if (isOwner(target)) {
    return { ok: false, error: "The head leader can't be changed or removed." };
  }
  if (change === "make_leader" && target.status !== "approved") {
    return { ok: false, error: "Approve this person before making them a leader." };
  }
  return { ok: true, value: null };
}

/** Simple in-memory limiter: N failed logins per phone per window. */
export class LoginLimiter {
  private failures = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60 * 1000,
  ) {}

  isBlocked(key: string, now = Date.now()): boolean {
    const entry = this.failures.get(key);
    if (!entry) return false;
    if (now >= entry.resetAt) {
      this.failures.delete(key);
      return false;
    }
    return entry.count >= this.maxFailures;
  }

  recordFailure(key: string, now = Date.now()): void {
    const entry = this.failures.get(key);
    if (!entry || now >= entry.resetAt) {
      this.failures.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      entry.count++;
    }
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}
