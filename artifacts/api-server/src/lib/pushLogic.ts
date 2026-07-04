/**
 * Pure helpers for web push. No DB, no network — fully unit-testable.
 */

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

export interface PushWindow {
  day_of_week: number; // 0=Sun … 6=Sat
  start_time: string; // "HH:MM" 24h SAST
  end_time: string;
  enabled: boolean;
}

/**
 * True when `hhmm` falls inside [start, end) of an enabled window for
 * `dayOfWeek`. Deliberately "open now", not "just opened": the process may
 * have been asleep (Render idle spin-down) or restarting at the opening
 * minute, so the first tick after it wakes must still send the push. The
 * caller's DB-unique (kind, sent_on) claim keeps it to one send per day.
 */
export function checkinWindowOpenNow(
  windows: PushWindow[],
  dayOfWeek: number,
  hhmm: string,
): boolean {
  const [nowH, nowM] = hhmm.split(":").map(Number);
  const nowTotal = nowH * 60 + nowM;
  return windows.some((w) => {
    if (!w.enabled || w.day_of_week !== dayOfWeek || !w.start_time || !w.end_time) {
      return false;
    }
    const [sh, sm] = w.start_time.split(":").map(Number);
    const [eh, em] = w.end_time.split(":").map(Number);
    if ([sh, sm, eh, em].some(Number.isNaN)) return false;
    return nowTotal >= sh * 60 + sm && nowTotal < eh * 60 + em;
  });
}

/** 24h cap between leader "Notify members" blasts per event. */
export function eventNotifyAllowed(
  lastNotifiedAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!lastNotifiedAt) return true;
  return now.getTime() - lastNotifiedAt.getTime() >= 24 * 60 * 60 * 1000;
}

/** Push services answer 404/410 for revoked/expired subscriptions. */
export function shouldDeleteSubscription(statusCode: number): boolean {
  return statusCode === 404 || statusCode === 410;
}

export function checkinOpenPayload(): PushPayload {
  return {
    title: "JG Youth",
    body: "Check-in is open! Tap to check in 🙌",
    url: "/checkin",
  };
}

/** Sent to the member's own devices when a leader approves their check-in. */
export function checkinApprovedPayload(fullName: string | null): PushPayload {
  const first = fullName?.trim().split(/\s+/)[0];
  return {
    title: "JG Youth",
    body: first
      ? `${first}, you're checked in! ✅ See you inside.`
      : "You're checked in! ✅ See you inside.",
    url: "/my",
  };
}

/** "📅 Youth Night" / "Friday, 10 July at 18:30 — tap for details" */
export function eventPushPayload(event: {
  id: string;
  title: string;
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:MM" or "HH:MM:SS"
}): PushPayload {
  let when = event.date;
  try {
    when = new Date(`${event.date}T00:00:00`).toLocaleDateString("en-ZA", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  } catch {
    /* keep ISO date */
  }
  const hhmm = event.time.slice(0, 5);
  return {
    title: `📅 ${event.title}`,
    body: `${when} at ${hhmm} — tap for details`,
    // No event-detail page exists; the member dashboard lists events.
    url: "/my",
  };
}
