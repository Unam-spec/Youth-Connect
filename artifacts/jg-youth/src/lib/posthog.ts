import posthog from "posthog-js";

// PostHog is configured entirely through env vars so nothing is hardcoded.
//   VITE_POSTHOG_KEY            — project API key (phc_…). Required to enable.
//   VITE_POSTHOG_HOST           — ingestion host (defaults to PostHog US cloud).
//   VITE_POSTHOG_DASHBOARD_URL  — shared dashboard URL embedded on /dashboard/analytics.
const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ??
  "https://us.i.posthog.com";

let initialized = false;

/** True when a PostHog key is configured; lets callers no-op gracefully. */
export const isPostHogEnabled = Boolean(POSTHOG_KEY);

/**
 * Initialize PostHog once. Safe to call when no key is set — it simply no-ops,
 * so local/dev environments without analytics keep working unchanged.
 *
 * We disable PostHog's automatic SPA pageview capture and emit `$pageview`
 * ourselves on each wouter route change (see capturePageview), which is the
 * reliable pattern for client-side routers.
 */
export function initPostHog(): void {
  if (initialized || !POSTHOG_KEY) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: false, // we capture manually on route change
    capture_pageleave: true,
    autocapture: true,
    persistence: "localStorage+cookie",
  });
  initialized = true;
}

/** Record a pageview for the given path. No-ops when PostHog is disabled. */
export function capturePageview(path: string): void {
  if (!initialized) return;
  posthog.capture("$pageview", { $current_url: window.location.origin + path });
}

/** Associate the current session with a known user. No-ops when disabled. */
export function identifyUser(
  distinctId: string,
  properties?: Record<string, unknown>,
): void {
  if (!initialized) return;
  posthog.identify(distinctId, properties);
}

/** Reset identity on sign-out so sessions aren't merged across users. */
export function resetPostHog(): void {
  if (!initialized) return;
  posthog.reset();
}

export { posthog };
