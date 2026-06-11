# No-Email PIN Accounts — Frontend Design

**Date:** 2026-06-11
**Status:** Approved (brainstorm) — pending implementation plan
**Branch:** `feature/pin-accounts-frontend`
**Depends on:** the PIN-accounts backend (Express + Supabase mirror), already merged to `origin/main`.

## Problem

The username+PIN account backend exists on both backends, but there is no UI.
Kids without email cannot yet sign up, log in, check in, change their PIN, and
leaders cannot promote them to member or see/reset their PINs. This builds those
surfaces in the React app (`artifacts/jg-youth`) without disturbing the existing
Clerk (email) flow, the leader phone+PIN login, or the anonymous first-timer
`/register` flow.

## Stack & conventions (existing)

- wouter routing; shadcn/ui; dark theme; `react-hook-form` + `zod`; `useToast`;
  Card-based forms. The `leader-login` page is the pattern to mirror.
- Auth identities today: **Clerk** (email, `/sign-in` `/sign-up`), **leader PIN**
  (`/leader-login`, stored as `jg_leader_session`, sent as `x-leader-session`).
- New endpoints are NOT in the generated API client → call via `fetch` (much of
  the app already does this).

## Decisions (from brainstorm)

1. **Entry points:** new dedicated pages `/pin-signup` and `/pin-login`.
2. **Kid home:** new lightweight `/account` page.
3. **Leader surface:** new dedicated `PinAccountsPanel` (members tab).
4. **Signup fields:** kid-only (name, username, PIN, age). Parent info is gathered
   by the leader at promotion time (not at signup).
5. **Kid session:** stored under its OWN key (`jg_pin_session`), separate from the
   leader session, so no leader-gated UI mistakes a kid for a leader.

---

## Section 1 — Routing & session architecture

**New routes** in `App.tsx` (outside the Clerk-gated area — these are PIN-based):
- `/pin-signup` → `PinSignup`
- `/pin-login` → `PinLogin`
- `/account` → `AccountHome`

**New `src/lib/pinSession.ts`** (mirrors `src/lib/auth.ts`):
```ts
export interface PinSession {
  role: "visitor" | "member";
  profile_id: string;
  session_token: string;
  username?: string;
  expires_at: number;
}
export function setPinSession(s: Omit<PinSession, "expires_at">): void // key "jg_pin_session", 8h
export function getPinSession(): PinSession | null // null + clears if expired
export function clearPinSession(): void
```

**`src/lib/api.ts`** (`apiFetch` + `useApiFetch`): attach `x-leader-session` from
the leader session **or** the pin session (a user is one or the other). Clerk and
leader paths are otherwise unchanged. The pin session's header value is
`JSON.stringify({ profile_id, session_token, expires_at })` — the shape the
backend's `validateLeaderSession`/`resolveAuth` expects.

Three independent identities stay cleanly separated: Clerk, leader PIN, kid PIN.

---

## Section 2 — Signup & login pages

Both Card-based, mirroring `leader-login` (`react-hook-form` + `zod` + `useToast`),
calling the backend via `fetch`.

**`PinSignup` (`/pin-signup`, public)** — `src/pages/pin-signup.tsx`
- Fields: `full_name`, `username`, `pin`, `confirm_pin`, `age`.
- Client zod mirrors server rules (username `^[a-z0-9_]{3,20}$`, PIN 4–6 digits,
  `pin === confirm_pin`) for instant feedback; server stays authoritative.
- Submit → `POST /api/auth/pin-signup` `{ full_name, username, pin, age }`.
  - 201 → `setPinSession({ role: "visitor", profile_id, session_token, username })`
    → redirect `/account`.
  - 409 → inline error on the username field ("That username is taken").
  - 400 → toast with the server message.
- Links: "Have an account? Log in" → `/pin-login`; "Have an email? Sign up" →
  Clerk `/sign-up`.

**`PinLogin` (`/pin-login`, public)** — `src/pages/pin-login.tsx`
- Fields: `username`, `pin`. Submit → `POST /api/auth/pin-login`.
  - Success → `setPinSession({ role: result.role, ... , username })` → `/account`.
  - 401 → "Invalid username or PIN".
- Links: "Create an account" → `/pin-signup`; pointers to leader login / Clerk for
  the other audiences.

**Discoverability:** add a "No email? Create a username account" link on the Home
page and on the Clerk sign-in/sign-up screens → `/pin-signup`.

---

## Section 3 — `/account` page (kid home)

`src/pages/account.tsx`, guarded by `getPinSession()` (redirect `/pin-login` if
none/expired). Loads the kid's own profile via `GET /api/profiles/:id` with the
`x-leader-session` header (same pattern `/my` already uses for PIN-leaders).

- **Header/status:** name + username + tier badge ("Visitor" / "Member"). For
  visitors: a line noting a leader can upgrade them.
- **Check-in:** primary "Check in" button → `POST /api/checkin/requests` (works now
  that check-in accepts PIN sessions). Show pending/approved/closed result.
- **Schedule/events:** read-only check-in schedule + upcoming events (existing read
  endpoints).
- **Change PIN:** small form → `PATCH /api/auth/pin` `{ pin }`, same zod rules +
  confirm. Success toast.
- **Log out:** `clearPinSession()` → `/`.

Member-only surfaces (member directory, RSVP) are NOT shown here; `/account` stays
lean. Gating is on `role === "member"` where any extra appears. RSVP stays on the
existing event flow (explicitly out of `/account`).

---

## Section 4 — Leader "PIN Accounts" panel

`src/components/panels/PinAccountsPanel.tsx`, added under the dashboard **members**
tab (alongside `RequestsPanel`/`MemberDirectoryPanel`), mirroring
`PinManagementPanel` style.

- **List:** PIN accounts (profiles with a `username`) → name, username, **visible
  PIN** (`pin_plain`), age, tier badge. Backed by the new `GET /api/pin-accounts`
  (Section 5).
- **Promote to member** (visitors only) → dialog:
  - If `age < 13`: dialog REQUIRES parent name + phone + an "I confirm parental
    consent" checkbox; confirm disabled until all present.
  - Submit → `POST /api/pin-accounts/:id/grant-membership`
    `{ parental_consent: true, parent_name?, parent_phone? }` (parent fields sent
    when collected; backend persists them before the gate — see Section 5).
  - Success → row flips to "Member".
- **Reset PIN** → confirm dialog → `POST /api/pin-accounts/:id/reset-pin` → show the
  returned new PIN once (dialog/toast) so the leader can read it out; row's visible
  PIN updates.

---

## Section 5 — Backend additions, auth plumbing & testing

**Backend additions (BOTH Express and the Supabase mirror) — the UI depends on
them:**

1. **`GET /pin-accounts`** (leader-only; `requireLeaderSession("leader")` /
   `requireRole("leader")`) → returns profiles that have a non-null `username`:
   `{ id, full_name, username, pin_plain, age, role, parent_phone, parent_name }`.
   No path collision with the existing `/pin-accounts/:id/...` routes.
2. **Extend `grant-membership`** to accept optional `parent_name` / `parent_phone`
   in the body and persist them to the target profile BEFORE running the consent
   gate, so an under-13 promotion (parent info + consent) is one atomic call.
   Applies to both backends; the consent gate logic itself (`canGrantMembership`)
   is unchanged — it now just evaluates against the freshly-saved parent values.

**Frontend auth plumbing:** `lib/pinSession.ts` + the `apiFetch`/`useApiFetch`
change (Section 1).

**Testing:**
- Backend: existing Express tests (42) stay green + `npm run typecheck`; manual curl
  for the list endpoint and the parent-info-in-promote path. Supabase: `deno check`
  (pre-deploy) + diff vs Express.
- Frontend: no React test runner in this repo (consistent with the codebase) → verify
  via typecheck/build + manual click-through: signup → auto-login → `/account` →
  check-in → change PIN; leader panel → promote under-13 (consent gate) → reset PIN
  → PIN visible.

---

## Out of scope / non-goals

- Rate-limiting on signup/login (tracked separately; backend gap).
- Applying the `0011` migration / deploying functions / the vercel.json cutover
  (ops steps).
- Migrating Clerk/email members to usernames.
- RSVP inside `/account`.
- Regenerating the typed API client for the new endpoints (frontend uses `fetch`).

## Behavior note (carried from backend)

`POST /checkin/requests` now returns **401** (was 404) for an authed-but-profileless
caller — the `/account` check-in handling must treat that as "not signed in", not as
a "complete registration" prompt.
