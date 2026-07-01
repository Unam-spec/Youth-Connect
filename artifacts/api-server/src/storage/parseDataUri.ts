/**
 * Parse a base64 `data:` URI into its mime type and decoded bytes.
 * Returns null for anything that isn't a base64 data URI (e.g. an https URL
 * or a `gradient:` placeholder), so callers can skip non-migratable rows.
 */
export function parseDataUri(
  value: string,
): { mimeType: string; buffer: Buffer } | null {
  const match = value.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;
  return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
}
