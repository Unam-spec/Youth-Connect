const PIN_RE = /^\d{4,6}$/;
const TRIVIAL = new Set([
  "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999",
  "1234", "4321", "123456", "654321", "000000", "111111",
]);

export type PinCheck = { ok: true; value: string } | { ok: false; error: string };

/**
 * Validates a PIN: 4-6 digits, not an obvious/trivial sequence.
 * Returns the PIN string to hash on success.
 */
export function validatePin(value: unknown): PinCheck {
  if (typeof value !== "string" || !PIN_RE.test(value)) {
    return { ok: false, error: "PIN must be 4-6 digits." };
  }
  if (TRIVIAL.has(value)) {
    return { ok: false, error: "That PIN is too easy to guess. Choose another." };
  }
  return { ok: true, value };
}
