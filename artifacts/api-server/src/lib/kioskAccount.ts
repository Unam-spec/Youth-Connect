// Pure username/PIN generation for kiosk-created visitor accounts.
import crypto from "node:crypto";
import { validatePin } from "./pin";

/** Slugify a full name into a valid username base (3-20 chars, [a-z0-9_]). */
export function usernameFromName(fullName: string): string {
  const slug = fullName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics left by NFKD
    .replace(/[^a-z0-9\s_]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 20);
  if (slug.length >= 3) return slug;
  return (slug + "guest").slice(0, 20);
}

/** Base first, then numeric suffixes trimmed so every candidate fits 20 chars. */
export function* usernameCandidates(base: string): Generator<string> {
  yield base;
  for (let i = 2; i < 1000; i++) {
    const suffix = String(i);
    yield base.slice(0, 20 - suffix.length) + suffix;
  }
}

/** Non-trivial 4-digit PIN (validatePin rejects 0000/1234-style PINs). */
export function generatePin(): string {
  let pin: string;
  do {
    pin = String(crypto.randomInt(1000, 10000));
  } while (!validatePin(pin).ok);
  return pin;
}
