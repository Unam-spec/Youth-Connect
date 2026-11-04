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

/**
 * The comparison key for a phone number, so the same number typed different
 * ways matches: "082 111 2222", "+27 82 111 2222", "0027821112222" and
 * "+27 082 111 2222" all become "27821112222". South African local numbers
 * (0 + 9 digits) get the 27 country code. Returns null when there are too
 * few digits to be a phone number.
 */
export function phoneKey(phone: unknown): string | null {
  if (typeof phone !== "string") return null;
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  else if (/^0\d{9}$/.test(d)) d = "27" + d.slice(1);
  if (/^270\d{9}$/.test(d)) d = "27" + d.slice(3);
  return d.length >= 7 ? d : null;
}
