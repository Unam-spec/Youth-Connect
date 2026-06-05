/**
 * Normalizes a phone string for uniqueness comparison: trims and lowercases.
 * Returns null when the value is absent or blank. Must mirror the DB index
 * predicate `lower(btrim(phone))`.
 */
export function normalizePhone(phone: unknown): string | null {
  if (typeof phone !== "string") return null;
  const trimmed = phone.trim();
  if (trimmed.length === 0) return null;
  return trimmed.toLowerCase();
}
