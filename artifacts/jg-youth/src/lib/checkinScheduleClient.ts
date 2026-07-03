import type { CheckinSchedule, CheckinWindow } from "@workspace/api-client-react";

export function getSastCurrentTimeInfo(): { dayOfWeek: number; hhmm: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  
  const dayOfWeek = weekdayMap[parts["weekday"]] ?? now.getDay();
  const hhmm = `${parts["hour"]}:${parts["minute"]}`;
  
  return { dayOfWeek, hhmm };
}

export function isCheckinOpen(schedule?: CheckinSchedule): boolean {
  if (!schedule) return false;
  if (!schedule.restrict_to_schedule) return true;

  const { dayOfWeek, hhmm } = getSastCurrentTimeInfo();

  return (schedule.windows || []).some(
    (w) =>
      w.enabled &&
      w.day_of_week === dayOfWeek &&
      hhmm >= w.start_time &&
      hhmm < w.end_time
  );
}
