# Part 2 — Happy Birthday feature

**Date:** 2026-06-29
**Status:** Approved design (scope: Part 2)
**Builds on:** Part 1 (`date_of_birth` column + `computeAge` utility, already live).
**Related (future):** Part 3 — Member directory split.

## Goal

Celebrate members' birthdays:
- **Member side:** on your birthday, your home screen greets you with a festive "🎉 Happy Birthday, [First name]!" card (light confetti), dismissible for the day.
- **Leader side:** a "Birthdays" widget on the leader dashboard listing **🎂 Today** and **This week**, each with the member's photo, name, and the age they're turning. Display-only (no WhatsApp action). Members do **not** see other people's birthdays.

Non-goals: WhatsApp "wish" buttons (declined), notifications/automation, birthday history.

## Foundation (from Part 1)

`profiles.date_of_birth` (nullable `date`) and the pure `computeAge`/`todaySAST` helpers in `artifacts/api-server/src/lib/age.ts` and `artifacts/jg-youth/src/lib/age.ts`. People without a DOB simply never trigger birthday UI.

## New birthday helpers (added to the age utility, both copies)

Pure functions, SAST-based, string-math (no Date timezone pitfalls):

- `daysUntilBirthday(dob, today)` → `0` when today is the birthday, else days to the next occurrence (1–365), or `null` if no/invalid DOB. **Feb 29** is treated as **Feb 28** in non-leap years.
- `isBirthdayToday(dob, today)` → `daysUntilBirthday === 0`.
- `isBirthdayThisWeek(dob, today)` → `daysUntilBirthday !== null && daysUntilBirthday <= 6` (today through the next 6 days).
- `ageTurning(dob, today)` → the age reached on the next birthday occurrence (today's age if the birthday is today; otherwise current age + 1, accounting for a year wrap).

All get unit tests alongside the existing `computeAge` tests.

## Member celebration (`artifacts/jg-youth/src/pages/my.tsx`)

When `isBirthdayToday(profile.date_of_birth)`, render a celebratory banner at the top of the member home: "🎉 Happy Birthday, [first name]!" with a lightweight CSS confetti/emoji flourish (no new dependency). Dismissible for the day via a per-date `localStorage` key (`bday_dismissed_<YYYY-MM-DD>`). Renders nothing when there's no DOB or it's not the birthday. Independent of the existing profile-completion / "add your birthday" prompts.

## Leader widget + endpoint

**Endpoint `GET /api/birthdays`** (leader session required). The directory list is paginated, so the widget can't compute from it; this endpoint scans all profiles with a DOB and returns:

```json
{
  "today":     [{ "id", "full_name", "avatar_url", "date_of_birth", "age_turning" }],
  "this_week": [{ "id", "full_name", "avatar_url", "date_of_birth", "age_turning" }]
}
```

- `today` = birthday today; `this_week` = birthday in the next 1–6 days (today excluded from this_week). Both sorted by `daysUntilBirthday` then name.
- Scope: all `profiles` (members, leaders, super-admins) with `date_of_birth IS NOT NULL`. (Transient visitors are excluded.)
- The selection/sorting logic lives in a pure, unit-tested `selectBirthdays(profiles, today)` helper; the route is a thin wrapper that fetches rows and returns its output.

**Widget** on the leader dashboard overview: a "Birthdays" card with a **Today** section (highlighted) and a **This week** section, each row = avatar + name + "turning N". Empty state: "No birthdays this week." Fetched with the leader session like the dashboard's other data.

## Visibility

Member sees only their own celebration; the list is leader-dashboard-only (already leader-gated). This matches the user's explicit choice and overrides the general "show to all roles" preference for this feature.

## Testing

- **Unit (helpers):** `isBirthdayToday` true on the day / false otherwise; Feb 29 in a non-leap year resolves to Feb 28; `daysUntilBirthday` across a year-end wrap; `isBirthdayThisWeek` boundary (day 6 in, day 7 out); `ageTurning` for today vs. upcoming vs. a Dec→Jan wrap; null/invalid DOB → null/false.
- **Unit (`selectBirthdays`):** buckets today vs this-week correctly, excludes no-DOB rows, sorts as specified, computes `age_turning`.
- **Frontend:** typecheck + build; manual check of the member banner (set a member's DOB to today) and the leader widget.

## Surfaces

- `artifacts/api-server/src/lib/age.ts` (+ helpers) and mirror in `artifacts/jg-youth/src/lib/age.ts`.
- New `artifacts/api-server/src/lib/birthdays.ts` (`selectBirthdays`) + tests.
- New route `GET /api/birthdays` (wire into the api-server router).
- `artifacts/jg-youth/src/pages/my.tsx` (member banner).
- Leader dashboard: a new `BirthdaysPanel`/widget component + mount point.

No database or schema changes (Part 1 already added `date_of_birth`).
