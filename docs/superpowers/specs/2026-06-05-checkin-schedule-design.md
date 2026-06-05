# Configurable Check-In Schedule — Design

**Date:** 2026-06-05
**Status:** Approved (design)

## Problem

Check-in availability is hardcoded to **Friday 18:30–22:00 SAST** in two places:
- Backend: `isCheckinWindowOpen()` in `artifacts/api-server/src/routes/checkin.ts`
- Frontend: `getCheckinWindowState()` / `getSastTime()` in `artifacts/jg-youth/src/pages/checkin.tsx`

Leaders cannot change the days/times without a code change and redeploy. They want a
schedule that is **optional and changeable from the leader dashboard**.

There is also an existing mismatch: the frontend lets leaders/super-admins open the
check-in form any time (`canBypassWindow`), but the backend enforces the window for
everyone, so a leader's check-in is rejected outside the window.

## Goals

- Leaders & super-admins can edit a weekly check-in schedule from the dashboard.
- Per-day times: each weekday can be open with its own start/end time.
- A master "Restrict check-in to scheduled times" toggle (ON by default). When OFF,
  check-in is always open.
- Each day can be individually enabled/disabled.
- Leaders/super-admins bypass the schedule (can check in any time); regular members
  are limited to enabled windows when restriction is ON.
- The window is enforced **server-side** (the client cannot bypass it).
- Day-one behavior is unchanged: default schedule = Friday 18:30–22:00, restriction ON.

## Non-goals (YAGNI)

- Configurable timezone — stays `Africa/Johannesburg` (SAST).
- Multiple windows per day — one window per weekday.
- One-off calendar dates / non-recurring sessions.

## Data model

Two new tables, created idempotently in the boot-time `SCHEMA_PATCHES`
(`artifacts/api-server/src/db/index.ts`). Times stored as `text` `"HH:MM"` and the
master flag as `boolean`, matching this DB's existing text/boolean convention (it does
not use the pgEnums the ORM schema declares).

### `checkin_settings` (single row)
| column | type | notes |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | always a single row |
| `restrict_to_schedule` | boolean NOT NULL default true | OFF = always open |
| `updated_at` | timestamptz default now() | |
| `updated_by` | uuid NULL | profile id of last editor |

### `checkin_windows` (one row per weekday)
| column | type | notes |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `day_of_week` | integer NOT NULL UNIQUE | 0=Sun … 6=Sat (matches JS `getDay()`) |
| `start_time` | text NOT NULL | `"HH:MM"` 24h SAST |
| `end_time` | text NOT NULL | `"HH:MM"` 24h SAST |
| `enabled` | boolean NOT NULL default true | per-day on/off |

### Seed (idempotent)
On boot, if `checkin_settings` is empty, insert one row (`restrict_to_schedule = true`).
If `checkin_windows` is empty, insert Friday (`day_of_week = 5`, `18:30`–`22:00`,
`enabled = true`). Seeding only runs when the respective table is empty, so leader
edits are never overwritten.

The `lib/db` (`@workspace/db`) Drizzle schema — which `checkin.ts` imports its `db`
from — gains `checkinSettingsTable` and `checkinWindowsTable` so the route can query
them via `db.query`. (The `supabase/functions/_shared/schema.ts` mirror is unused on
Railway and is left untouched.) Note `SCHEMA_PATCHES` runs raw SQL against
`DATABASE_URL`, so it creates/seeds the tables regardless of which Drizzle instance
reads them.

## Backend (`artifacts/api-server/src/routes/checkin.ts`)

### `GET /api/checkin/schedule` — public read
Returns the current schedule for both the check-in page and the dashboard:
```json
{
  "restrict_to_schedule": true,
  "windows": [
    { "day_of_week": 5, "start_time": "18:30", "end_time": "22:00", "enabled": true }
  ]
}
```
Public (no auth) — same posture as `GET /api/checkin/search`; the data is just hours.
Always returns all 7 weekdays (filling missing days as `enabled:false` with empty
times) so the dashboard can render a complete editor.

### `PUT /api/checkin/schedule` — `requireLeaderSession("leader")` (leaders & super-admins)
Body:
```json
{
  "restrict_to_schedule": true,
  "windows": [ { "day_of_week": 5, "start_time": "18:30", "end_time": "22:00", "enabled": true }, ... ]
}
```
Validates: `day_of_week` 0–6, `start_time`/`end_time` match `^\d{2}:\d{2}$` and
`start < end` for enabled days. Upserts the settings row and each window row (by
`day_of_week`). Sets `updated_by` to the caller's profile id. Returns the saved schedule.

### Window evaluation
Replace synchronous `isCheckinWindowOpen()` with async `isCheckinOpen(): Promise<boolean>`:
1. Read `checkin_settings`. If `restrict_to_schedule` is false → **open**.
2. Compute current SAST weekday + `HH:MM` (`toZonedTime(..., "Africa/Johannesburg")`).
3. Open if there is an **enabled** window for today's weekday with
   `start_time <= now < end_time` (string compare on zero-padded `"HH:MM"` is valid).

### `POST /api/checkin/requests` changes
- Resolve the caller's profile (already done via Clerk).
- **Leader bypass:** if `profile.role` is `leader` or `super_admin`, skip the window
  check entirely.
- Otherwise enforce `isCheckinOpen()`; when closed, return 403 with a message derived
  from the schedule (e.g. "Check-in is closed right now." plus next open day/time if
  determinable — keep the message simple if next-window calc is non-trivial).

## Frontend

### New dashboard panel: `CheckInSchedulePanel`
- Location: `artifacts/jg-youth/src/components/panels/` plus a tab/section in
  `pages/dashboard.tsx`. Visible to leaders & super-admins.
- UI: a master switch "Restrict check-in to scheduled times", then 7 rows (Sun→Sat),
  each with an enable checkbox + `start`/`end` time inputs (`<input type="time">`),
  and a Save button. Fetches `GET /api/checkin/schedule` on mount; Save calls
  `PUT /api/checkin/schedule` with the auth header.
- Basic client validation (start < end on enabled days) with inline errors; the
  backend re-validates.

### Check-in page (`pages/checkin.tsx`)
- Fetch `GET /api/checkin/schedule` on mount.
- Replace the hardcoded Friday logic in `getCheckinWindowState()` with logic driven by
  the fetched schedule + current SAST time:
  - If `restrict_to_schedule` is false → treat as open.
  - Else compute open/closed from today's enabled window; banner messages reflect
    before/after/closed/wrong-day using the configured times.
- Leaders/super-admins keep `canBypassWindow` (form always shown for them).
- The QR flow, search flow, and `CheckInWaitingState` are otherwise unchanged.

## Error handling

- `PUT` validation failures → 400 with a clear message; no partial writes (wrap window
  upserts in a transaction).
- Schedule read failures on the check-in page → fail safe by showing the form gated to
  signed-in users and letting the backend be the source of truth (backend still
  enforces). Dashboard read failure → toast + retry.
- `isCheckinOpen()` DB error → log and treat as **closed** for non-leaders (safe
  default), while leaders bypass regardless.

## Testing

- Backend unit tests for `isCheckinOpen()`: restriction off → open; inside/outside an
  enabled window; disabled day; wrong weekday; boundary (`== start` open, `== end`
  closed).
- `PUT` validation tests: bad `day_of_week`, malformed time, `start >= end`.
- Manual: edit schedule in dashboard → reflected on check-in page banner and on
  member self check-in (open/closed) and leader bypass.

## Rollout

- Tables + seed land via `SCHEMA_PATCHES` on the next Railway boot (idempotent).
- No data migration needed; default seed reproduces today's Friday 18:30–22:00 behavior.
