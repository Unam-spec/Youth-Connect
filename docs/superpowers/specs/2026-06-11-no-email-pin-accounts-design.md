# No-Email PIN Accounts (Username + PIN) — Design

**Date:** 2026-06-11
**Status:** Approved (brainstorm) — pending implementation plan
**Branch:** `feature/no-email-pin-accounts`

## Problem

Younger users (e.g. 13-year-olds) often have no email address, so they cannot
create an account through the existing Clerk (email-based) sign-up. We want to
let them self-register and log in with a **username + PIN**, without disturbing:

- the **first-timer registration** flow (anonymous `visitors` table), and
- the existing **Clerk email login** flow for members.

## Key Insight: the machinery already exists

The system already has a no-email auth path — the **leader PIN login**:

- `profiles` rows can authenticate via `pin_hash` + a `session_token`
  (sent in the `x-leader-session` header), validated by
  `validateLeaderSession` / `resolveAuth`.
- The `role` enum already includes `"visitor"` and `"member"`.
- The frontend already has a phone+PIN login screen and stores the session header.

This feature **extends that path to members/visitors**, keyed on a **username**
instead of a phone number. It does not introduce a new auth system.

## Backends (both must stay in lockstep)

There are two backends serving this app:

1. **Express API server on Railway** — currently serving production
   (`artifacts/api-server/src/routes/`, schema `lib/db/src/schema/index.ts` via
   `@workspace/db`). **Primary target — implement here first.**
2. **Supabase Edge Functions** — in-progress port
   (`supabase/functions/`, vendored schema `supabase/functions/_shared/schema.ts`).
   **Mirror the Express changes here second.**

Every new endpoint and the auth change below must land in both, and the two
schema definitions must be kept in sync (plus a hand-written SQL migration).

---

## Section 1 — Account lifecycle & auth

Two tiers, both on the existing `profiles` table (no new table):

### Tier 1 — Visitor account (`role = "visitor"`)
- Created when a kid **self-signs-up** with a **username + their own PIN**.
- Can log in **immediately** (no approval gate to *use* the account).
- Limited privileges: **self check-in + view schedule/events only.**
- This is the "stays a visitor until promoted" stage.

### Tier 2 — Member (`role = "member"`)
- A **leader promotes** the visitor → member (this *is* the "leader approves" step).
- **Parental consent gate:** if `age < 13`, promotion is **blocked** unless
  `parent_phone` + `parent_name` are present **and** a leader records consent.
  `age >= 13` skips the consent gate.
- After promotion the kid manages their **own PIN** in settings.
- Full member privileges (member directory, RSVP, etc.).

State is carried **entirely by `role`** — there is no separate `account_status`
column and no "pending" state (immediate login was an explicit decision).

### Auth mechanism
- **Login:** `POST /auth/pin-login` with `{ username, pin }` → validates
  `pin_hash`, mints an 8-hour `session_token`, returns the `x-leader-session`
  payload. Username-keyed twin of `/leaders/verify-pin` (which stays phone-keyed
  for leaders, untouched).
- **Protected requests:** member self-service endpoints switch from
  **Clerk-only** to **`resolveAuth` (Clerk OR PIN session)**, then branch on
  `role`. This is **additive** — existing email/Clerk members are unaffected.

---

## Section 2 — Data model & schema changes

All on `profiles`. No new tables.

| Change | Column | Notes |
|--------|--------|-------|
| **Add** | `username text UNIQUE` | Nullable. Only PIN accounts set it; Clerk/email members leave it null. Login identifier. Unique **case-insensitively**. |
| **Re-add** | `pin_plain text` | Nullable. Viewable-PIN column for the leader dashboard (reverses migration `0010`). Written whenever a PIN is set/reset/changed. |
| **Add** | `parental_consent_at timestamptz` | Nullable. Non-null = a leader recorded parental consent. |
| **Add** | `parental_consent_by uuid` | Leader who confirmed consent (safeguarding audit). |
| *(reuse)* | `pin_hash`, `session_token`, `phone`, `parent_phone`, `parent_name`, `age`, `role` | Already exist. |

**Consent rule (server-enforced at promotion):** allow `visitor → member` iff
`age >= 13` **OR** (`age < 13` AND `parent_phone` present AND `parent_name`
present AND `parental_consent_at` set).

**Untouched:** first-timer `register` (the anonymous `visitors` table) is a
separate path and is not modified. Clerk fields (`clerk_id`, `email`) are
unaffected and may coexist with a username on the same profile later.

**Three places to keep in sync:**
1. `lib/db/src/schema/index.ts` (Drizzle — Express/`@workspace/db`)
2. `supabase/functions/_shared/schema.ts` (vendored edge-function schema)
3. New hand-written SQL migration `lib/db/drizzle/0011_add_pin_accounts.sql`

---

## Section 3 — Endpoints & auth changes (both backends)

New endpoints (add to Express `artifacts/api-server/src/routes/`, mirror to
`supabase/functions/`):

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /auth/pin-signup` | Public | Kid creates account: `{ full_name, username, pin, age, … }` → `profiles` row, `role="visitor"`, sets `username` + `pin_hash` + `pin_plain`. Validates username + PIN rules (Section 4). Auto-logs-in (mints session). |
| `POST /auth/pin-login` | Public | `{ username, pin }` → validate, mint `session_token`, return `x-leader-session` payload. |
| `PATCH /auth/pin` | Self (session) | Kid changes own PIN → updates `pin_hash` + `pin_plain`. |
| `POST /profiles/:id/grant-membership` | Leader | Promote `visitor→member`. Server-enforces the consent gate; records `parental_consent_at` / `parental_consent_by`. |
| `POST /profiles/:id/reset-pin` (kid variant) | Leader | Leader resets a kid's PIN; writes `pin_plain` so it stays viewable. Distinct from the existing email-based leader reset. |

**Auth change (the one real integration point):** member self-service endpoints —
starting with **check-in** — switch from Clerk-only (`getAuth`/`getClerkUserId`)
to `resolveAuth` (Clerk OR PIN session), then branch on `role`. Reuses the
existing resolvers (Express `requireLeaderSession`/`validateLeaderSession`;
Supabase `resolveAuth`). Existing Clerk members keep working unchanged.

**Authorization tiers:**
- **Visitor** (`role="visitor"`, authenticated): self check-in, view schedule/events.
- **Member** (`role="member"`): the above + member-only features (member directory, RSVP).
- Leader/super-admin features remain gated as today.

**Leader dashboard:** the kid-accounts list shows `username` + `pin_plain`, a
**"Promote to member"** action (consent-gated), and **"Reset PIN"**. Implemented
as an extension of an existing members panel, not a new screen.

---

## Section 4 — Safety, abuse, and testing

Because `pin-signup` / `pin-login` are **public** endpoints handling **minors'**
credentials:

- **Rate-limiting / lockout** on `pin-login` and `pin-signup`. The existing
  `/leaders/verify-pin` has **none** today — a latent gap; username + 4-digit PIN
  is brute-forceable without throttling. Add attempt throttling / temporary lockout.
- **Username rules:** unique (case-insensitive), allowed charset + length,
  no impersonation of leader handles, basic profanity screen.
- **PIN rules:** 4–6 digits; reject/​warn on trivial PINs (`0000`, `1234`).
- **Plaintext-PIN risk:** `pin_plain` reverses the `0010` hardening for minors'
  accounts. Documented as an accepted decision. **Optional (not required)
  mitigation:** scope PIN visibility to super-admins + record access. Default per
  product decision: leaders can always see.
- **Consent audit:** `parental_consent_at` + `parental_consent_by` provide a
  who/when trail for under-13 promotions.

**Testing focus:**
- Consent gate: under-13 blocked without parent info + consent; 13+ passes.
- Username uniqueness / case-insensitive collision; PIN validation.
- Login → session → protected-endpoint round trip on **both** backends.
- **Regression guard:** Clerk login and first-timer `register` flow unchanged.

---

## Out of scope / non-goals

- Chat / messaging (the chat system no longer exists).
- Email-based recovery for PIN accounts (recovery is leader-assisted reset).
- Migrating existing Clerk members to usernames.
- Self-serve promotion to member (promotion is leader-only by design).
