export interface CheckinWindow {
  day_of_week: number; // 0=Sun … 6=Sat (matches JS Date.getDay())
  start_time: string;  // "HH:MM" 24h SAST
  end_time: string;    // "HH:MM" 24h SAST
  enabled: boolean;
}

export interface CheckinSchedule {
  restrict_to_schedule: boolean;
  windows: CheckinWindow[];
}

/**
 * Pure open/closed decision. `nowHHMM` must be zero-padded "HH:MM".
 * Time comparison is a lexical string compare, valid for equal-length "HH:MM".
 */
export function evaluateCheckinOpen(
  restrict: boolean,
  windows: CheckinWindow[],
  dayOfWeek: number,
  nowHHMM: string,
): boolean {
  if (!restrict) return true;
  return windows.some(
    (w) =>
      w.enabled &&
      w.day_of_week === dayOfWeek &&
      nowHHMM >= w.start_time &&
      nowHHMM < w.end_time,
  );
}
