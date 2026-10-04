/**
 * Worship Team WhatsApp messages: the Sunday setlist for the group, and the
 * invite anyone on the team can send. WhatsApp renders *bold* and _italics_.
 */

export interface SetlistSongLine {
  title: string;
  artist: string | null;
  song_key: string | null;
  lead_name: string | null;
}

/** The next Sunday on or after `from`, as YYYY-MM-DD in local time. */
export function nextSunday(from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-10-11" → "Sunday 11 October" (same wording as the push notification). */
export function formatServiceDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${DAYS[date.getDay()]} ${d} ${MONTHS[m - 1]}`;
}

export function buildSetlistMessage(
  setlist: { service_date: string; title: string | null; notes: string | null },
  songs: SetlistSongLine[],
  link: string,
): string {
  const lines = [`🎶 *Setlist · ${formatServiceDate(setlist.service_date)}*`];
  if (setlist.title) lines.push(`_${setlist.title}_`);
  lines.push("");
  songs.forEach((s, i) => {
    const by = s.artist ? ` (${s.artist})` : "";
    const details = [s.song_key ? `Key: *${s.song_key}*` : null, s.lead_name ? `Lead: ${s.lead_name}` : null]
      .filter(Boolean)
      .join(" · ");
    lines.push(`${i + 1}. *${s.title}*${by}`);
    if (details) lines.push(`    ${details}`);
  });
  if (setlist.notes) lines.push("", `📝 ${setlist.notes}`);
  lines.push("", `Chords & lyrics in your key 👉 ${link}`);
  return lines.join("\n");
}

export function buildInviteMessage(link: string): string {
  return [
    "🎶 *Worship Team*",
    "",
    "We've got our own worship team app:",
    "• Your own song list, with the key you sing or play each song in",
    "• Lyrics & chords that change to any key",
    "• Sunday setlists, so everyone knows what we're playing",
    "• Notifications when the team adds songs",
    "",
    `If you're on the worship team, request to join here 👉 ${link}`,
    "",
    "A worship leader will accept you 🙌",
  ].join("\n");
}

/** Opens WhatsApp with the message, letting the person pick the chat or group. */
export function shareOnWhatsApp(text: string): void {
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  // Mobile browsers often block new tabs; navigating the current tab hands
  // off to the WhatsApp app instead (same approach as the JG Youth share).
  const opened = window.open(url, "_blank");
  if (!opened) window.location.href = url;
}
