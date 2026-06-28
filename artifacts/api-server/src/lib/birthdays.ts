import { daysUntilBirthday, ageTurning } from "./age";

export interface BirthdayProfile {
  id: string;
  full_name: string;
  avatar_url: string | null;
  date_of_birth: string | null;
}

export interface BirthdayEntry {
  id: string;
  full_name: string;
  avatar_url: string | null;
  date_of_birth: string;
  age_turning: number | null;
}

export interface BirthdayBuckets {
  today: BirthdayEntry[];
  this_week: BirthdayEntry[];
}

/**
 * Buckets profiles into today's and this-week's (next 1–6 days) birthdays.
 * Rows without a date_of_birth are skipped. `today` is 'YYYY-MM-DD' (SAST).
 */
export function selectBirthdays(
  profiles: BirthdayProfile[],
  today: string,
): BirthdayBuckets {
  type Ranked = BirthdayEntry & { _d: number };
  const todayList: Ranked[] = [];
  const weekList: Ranked[] = [];

  for (const pr of profiles) {
    if (!pr.date_of_birth) continue;
    const d = daysUntilBirthday(pr.date_of_birth, today);
    if (d === null) continue;
    const entry: Ranked = {
      id: pr.id,
      full_name: pr.full_name,
      avatar_url: pr.avatar_url,
      date_of_birth: pr.date_of_birth,
      age_turning: ageTurning(pr.date_of_birth, today),
      _d: d,
    };
    if (d === 0) todayList.push(entry);
    else if (d <= 6) weekList.push(entry);
  }

  const byDayThenName = (a: Ranked, b: Ranked) =>
    a._d - b._d || a.full_name.localeCompare(b.full_name);
  todayList.sort(byDayThenName);
  weekList.sort(byDayThenName);

  const strip = ({ _d, ...rest }: Ranked): BirthdayEntry => rest;
  return { today: todayList.map(strip), this_week: weekList.map(strip) };
}
