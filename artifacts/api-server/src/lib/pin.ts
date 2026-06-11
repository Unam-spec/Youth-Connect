const PIN_RE = /^\d{4,6}$/;

/** True if every digit is the same (e.g. "0000", "11111"). */
function isAllSameDigit(pin: string): boolean {
  return /^(\d)\1+$/.test(pin);
}

/** True if digits ascend or descend by 1 throughout (e.g. "1234", "54321"). */
function isSequential(pin: string): boolean {
  let asc = true;
  let desc = true;
  for (let i = 1; i < pin.length; i++) {
    const diff = pin.charCodeAt(i) - pin.charCodeAt(i - 1);
    if (diff !== 1) asc = false;
    if (diff !== -1) desc = false;
  }
  return asc || desc;
}

/** True for PINs too easy to guess, at any supported length. */
function isTrivialPin(pin: string): boolean {
  return isAllSameDigit(pin) || isSequential(pin);
}

export type PinCheck = { ok: true; value: string } | { ok: false; error: string };

/**
 * Validates a PIN: 4-6 digits, not an obvious/trivial sequence (all-same-digit
 * or ascending/descending run). Returns the PIN string to hash on success.
 */
export function validatePin(value: unknown): PinCheck {
  if (typeof value !== "string" || !PIN_RE.test(value)) {
    return { ok: false, error: "PIN must be 4-6 digits." };
  }
  if (isTrivialPin(value)) {
    return { ok: false, error: "That PIN is too easy to guess. Choose another." };
  }
  return { ok: true, value };
}
