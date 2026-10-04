const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "17:00" -> "5pm", "18:30" -> "6:30pm". */
function friendlyTime(hhmm: string): string {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

/**
 * The weekly message a leader posts to the youth WhatsApp group in one tap.
 * Uses the first enabled check-in window for the day and time.
 */
export function buildGroupAnnouncement(
  windows: { day_of_week: number; start_time: string; enabled: boolean }[],
  appUrl: string,
): string {
  const w = windows.find((x) => x.enabled);
  const when = w
    ? `this ${DAY_NAMES[w.day_of_week]}! Check-in opens at ${friendlyTime(w.start_time)}.`
    : "this week!";
  return [
    `🔥 JG Youth is on ${when}`,
    "",
    `Check in, see what's on and keep your streak going 👉 ${appUrl}`,
    "",
    "Bring a friend — new faces welcome 🙌",
  ].join("\n");
}

/**
 * The ONE check-in reminder a leader posts to the youth WhatsApp group (an
 * hour before check-in closes) — replaces messaging people one by one.
 */
export function buildCheckinReminder(
  windows: { day_of_week: number; start_time: string; end_time?: string; enabled: boolean }[],
  appUrl: string,
): string {
  const today = new Date().getDay();
  const w = windows.find((x) => x.enabled && x.day_of_week === today) ?? windows.find((x) => x.enabled);
  const closes = w?.end_time ? ` Check-in closes at ${friendlyTime(w.end_time)}.` : "";
  return [
    `⏰ *Don't forget to check in at JG Youth tonight!*${closes}`,
    "",
    `Tap to check in 👉 ${appUrl}/checkin`,
    "",
    "Keep your streak going 🔥",
  ].join("\n");
}
