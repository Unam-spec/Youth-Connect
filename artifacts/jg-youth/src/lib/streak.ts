// Check-in streak math. Sessions run weekly (Friday), so a "streak" is a run of
// consecutive calendar weeks in which the member checked in at least once. Kept as
// a pure function so it's trivial to reason about and unit-test.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Week bucket for a date — whole weeks since the Unix epoch (Thursday=0). */
function weekIndex(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_DAY / 7);
}

export interface StreakResult {
  /** Consecutive weeks ending at the most recent attended week. */
  current: number;
  /** Best run of consecutive weeks ever. */
  longest: number;
  /** Total distinct sessions attended. */
  total: number;
}

/**
 * Compute streak stats from a list of attendance session dates (any parseable
 * date strings). Multiple check-ins in the same week count once.
 */
export function computeStreak(sessionDates: (string | null | undefined)[]): StreakResult {
  const weeks = Array.from(
    new Set(
      sessionDates
        .filter((d): d is string => Boolean(d))
        .map((d) => new Date(d))
        .filter((d) => !Number.isNaN(d.getTime()))
        .map(weekIndex),
    ),
  ).sort((a, b) => a - b);

  if (weeks.length === 0) return { current: 0, longest: 0, total: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < weeks.length; i++) {
    run = weeks[i] === weeks[i - 1] + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  // Current streak: walk back from the latest attended week while contiguous.
  let current = 1;
  for (let i = weeks.length - 1; i > 0; i--) {
    if (weeks[i] === weeks[i - 1] + 1) current++;
    else break;
  }

  return { current, longest, total: weeks.length };
}
