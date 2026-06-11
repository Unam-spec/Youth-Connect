// Mirrors artifacts/api-server/src/lib/username.ts (single source of truth).
/**
 * Normalizes a username for storage/comparison: trims + lowercases.
 * Returns null when absent or blank. Must mirror the DB index predicate
 * lower(btrim(username)).
 */
export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.toLowerCase();
}

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const RESERVED = new Set(["admin", "leader", "superadmin", "super_admin", "root", "system"]);

export type UsernameCheck = { ok: true; value: string } | { ok: false; error: string };

/**
 * Validates a candidate username. On success returns the normalized value to
 * persist. Rules: 3-20 chars, lowercase letters/digits/underscore only, not a
 * reserved handle.
 */
export function validateUsername(value: unknown): UsernameCheck {
  const normalized = normalizeUsername(value);
  if (!normalized) return { ok: false, error: "Username is required." };
  if (!USERNAME_RE.test(normalized)) {
    return {
      ok: false,
      error: "Username must be 3-20 characters: letters, numbers, or underscore.",
    };
  }
  if (RESERVED.has(normalized)) return { ok: false, error: "That username is not allowed." };
  return { ok: true, value: normalized };
}
