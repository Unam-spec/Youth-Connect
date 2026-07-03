# Kiosk Mode — shared-phone check-in (design)

**Date:** 2026-07-03 · **Status:** approved by Unam (conversation, 2026-07-03) · **Builds on:** no-email PIN accounts, first-timer flow, web push

## Problem

At service one leader phone gets passed around. Members must be able to check in
against their own accounts without ever logging in on the shared phone, and people
with no account must be registerable on the spot — ending up with a real
username+PIN login they can use later on their own phone (check-in, notifications,
membership), matching the existing visitor → member ladder.

## Decisions

- **Kiosk runs on the leader's session.** A locked, full-screen `/kiosk` page opened
  from the dashboard. All API calls carry the leader `x-leader-session`; nobody logs
  in or out on the shared phone.
- **Members confirm by tap** (their photo + name shown). No PIN at the kiosk — the
  leader is physically present. A strict PIN mode can be added later if abuse shows up.
- **Kiosk check-ins are authoritative**: they record attendance directly (like the
  follow-up hub's "Mark in"), no pending-approval queue, `check_in_method: "manual"`
  (reusing the existing enum value — no enum migration; prod has schema drift risk
  around pg enums).
- **Kiosk first-timers become PIN-account visitors on `profiles`** — NOT rows in the
  legacy `visitors` table. Rationale: the `/register` visitors-table flow produces no
  login, which defeats the purpose here; PIN-profiles get login, push, promote-to-member
  (consent gate), and show in the leaders' PIN accounts panel. Trade-off (accepted):
  kiosk first-timers won't appear in visitors-table-based first-timer KPIs.
- **Fields at kiosk registration:** photo (required — consistent with the existing
  first-timer decision), full name, gender, date of birth (required), phone
  (optional, enables WhatsApp credential handoff), parent name+phone (only shown when
  DOB says under 13, so the later membership consent gate has what it needs).
  Email is never asked.
- **Credentials handoff:** after registration the kiosk shows the auto-generated
  username + 4-digit PIN full-screen, with a "Send via WhatsApp" `wa.me` button when
  a phone was given. Leaders can always recover the PIN later (PIN accounts panel).
- **Membership prompt** ("want to become a member?") after the credentials screen →
  creates a pending `membership_requests` row (the existing leader approval queue).
  No leader notification email — the leader is holding the phone.
- **Kiosk exit** requires the leader's dashboard PIN when one is set
  (`GET /profiles/me/pin` → prompt → verify); plain confirm dialog otherwise.
- **Idle reset:** check-in screens auto-return to the kiosk home after ~45 s idle;
  the registration form never auto-resets (losing a half-typed form is worse).
- **/account upgrade (prerequisite):** PIN users currently can't reach `/my`, so the
  kiosk's "autonomous feel" loop breaks at notifications. `/account` gains the
  `NotificationSetupCard` (drop-in: `pushClient` already authenticates via `apiFetch`
  PIN session) and a compact "Upcoming events" card (public `GET /api/events`).

## Security fixes bundled (both sit directly in the kiosk's data path)

1. **`GET /api/checkin/search` (public) returns full profile rows today — including
   `pin_plain`, `pin_hash`, `session_token`.** Account takeover for any searchable
   profile. Fix: project to `{id, full_name, phone, avatar_url, role}`.
2. **`POST /api/attendance` has no auth** (anyone can insert attendance) and no
   same-day dedupe. Fix: `requireLeaderSession("leader")` (its real callers — follow-up
   hub, now kiosk — are leader UIs using `useApiFetch`, which sends the header) plus
   select-before-insert dedupe returning 409.

## Components

### Backend (api-server)

- `lib/kioskAccount.ts` (pure, TDD): `usernameFromName(fullName)` → base slug
  (lowercase, `[a-z0-9_]`, 3–20 chars) + `usernameCandidates(base)` numeric-suffix
  stream for collision retry; `generatePin()` → 4-digit PIN passing `validatePin`.
- `POST /api/kiosk/register` (leader): validates via `validateDob` + `resolveSignupAge`
  conventions, creates the visitor profile (username/pin auto, `pin_plain` kept — existing
  product decision), records today's attendance, returns `{profile_id, username, pin}`.
  Username uniqueness via candidate retry on the existing partial unique index.
- `POST /api/kiosk/request-membership` (leader): `{profile_id}` → idempotent pending
  `membership_requests` insert.
- `POST /api/kiosk/verify-pin` (leader): `{pin}` → compare vs own `pin_hash` (bcrypt,
  with the legacy short-hash fallback used by `/leaders/verify-pin`) → `{valid}`;
  `{valid:false, no_pin:true}` when none set.
- Hardened `POST /api/attendance` and projected `GET /api/checkin/search` (above).

### Frontend (jg-youth)

- `/kiosk` route (no `Layout` chrome, leader-session-gated):
  home (two big buttons + lock icon) → member search/tap/confirm/success (auto-reset)
  and new-person form → credentials screen → membership prompt → home.
- `/account`: + `NotificationSetupCard`, + upcoming events card.
- Dashboard session section: "Start Kiosk Mode" button → `/kiosk`.

## Error handling

- Attendance 409 → friendly "already checked in tonight" screen, auto-reset.
- Registration failures keep the form state; photo upload errors reuse the register
  page's inline error pattern.
- Kiosk API 401 (expired leader session) → redirect to `/leader-login`.

## Testing

- TDD (vitest) for `kioskAccount` helpers; existing 117 tests stay green.
- Routes stay thin over tested helpers (repo has no route-test harness).
- `tsc --noEmit` for the frontend + api-server typecheck; manual click-through on
  deploy (kiosk + upgraded /account on a real phone).

## Out of scope

Printed QR cards, strict PIN-confirm mode, opening `/my` to PIN sessions,
rate-limiting PIN endpoints, visitors-table unification.
