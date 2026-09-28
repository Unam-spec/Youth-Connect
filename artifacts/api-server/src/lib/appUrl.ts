/**
 * Canonical public app URL for links in outgoing messages (emails, WhatsApp
 * templates, push). Every message the app sends out must carry a link back to
 * the app — build it from here so the domain lives in one place.
 * FRONTEND_URL overrides on Render; the fallback is the custom domain (jgyouth.site).
 */
export const APP_BASE_URL =
  process.env.FRONTEND_URL ?? "https://jgyouth.site";
