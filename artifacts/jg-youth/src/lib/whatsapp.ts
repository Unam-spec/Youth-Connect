// ── WhatsApp link helpers ──────────────────────────────────────────────────────
// wa.me links must use a full international number with no "+" or spaces. South
// African numbers are commonly stored in local "0xxxxxxxxx" form, which wa.me
// rejects — so we convert a leading "0" to the "27" country code. This is the
// single source of truth for every WhatsApp link in the app (leader PINs, the
// messaging hub, member directory invites) so they behave the same on mobile.

/** Normalise a phone number into wa.me digits (no "+", no spaces, 27… for SA). */
export function normalizeWaPhone(phone: string): string {
  let clean = (phone || "").replace(/[^0-9+]/g, "");
  if (clean.startsWith("0")) {
    clean = "27" + clean.slice(1);
  } else if (clean.startsWith("+")) {
    clean = clean.slice(1);
  }
  return clean;
}

/** Build a wa.me URL with a pre-filled message. */
export function buildWaMeUrl(phone: string, text: string): string {
  return `https://wa.me/${normalizeWaPhone(phone)}?text=${encodeURIComponent(text)}`;
}

/**
 * Open WhatsApp reliably across desktop and mobile.
 *
 * On mobile, a popup pre-opened before an async call (window.open("")) is often
 * blocked or left blank, so links "don't send". This helper opens the wa.me URL
 * directly in a click handler, and if the browser blocks the new tab it falls
 * back to navigating the current tab — which on a phone hands off to the
 * WhatsApp app and leaves the page in place.
 *
 * @param preOpened a window opened synchronously before an await (optional)
 */
export function openWhatsApp(
  phone: string,
  text: string,
  preOpened?: Window | null,
): void {
  const url = buildWaMeUrl(phone, text);
  if (preOpened && !preOpened.closed) {
    preOpened.location.href = url;
    return;
  }
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) {
    // Popup blocked (common on mobile) — navigate the current tab instead.
    window.location.href = url;
  }
}
