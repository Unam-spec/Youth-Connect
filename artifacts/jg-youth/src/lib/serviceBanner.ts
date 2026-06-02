/**
 * Returns true if `now` falls in the post-service "thanks for coming" window:
 * Friday 22:00–23:59:59 in SAST (Africa/Johannesburg = UTC+2, no DST).
 * Pure and deterministic for a given Date.
 */
export function isPostServiceWindow(now: Date): boolean {
  // Shift to SAST by adding 2 hours, then read UTC parts.
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const day = sast.getUTCDay(); // 0=Sun … 5=Fri
  const hour = sast.getUTCHours();
  return day === 5 && hour >= 22 && hour <= 23;
}

/** localStorage key for dismissing the banner for one SAST night. */
export function serviceBannerKey(now: Date): string {
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  return `service_banner_dismissed_${sast.getUTCFullYear()}-${sast.getUTCMonth() + 1}-${sast.getUTCDate()}`;
}
