# Backend Correctness & Schema — Design

**Date:** 2026-06-01
**Sub-project:** 2 of N (Youth-Connect end-to-end overhaul)
**Status:** Approved
**Branch:** `backend-correctness`

## Context

Sub-project #2 of the sequenced overhaul (see
`docs/superpowers/specs/2026-06-01-build-deploy-stability-design.md` for #1). Grounded in
a fresh audit of current code and the live `jg-youth` Supabase DB
(`oobjbxurtbtwcvfhpyak`), NOT the original overhaul spec (which is partially stale).

Backend = `artifacts/api-server` (Express 5, Drizzle ORM, Clerk, Postgres on Supabase).
Shared DB schema = `lib/db/src/schema/index.ts`. The chat `messages` table lives
separately at `artifacts/api-server/src/db/schema/messages.ts` on its own Drizzle client.

## Audit findings

1. **Two auth mechanisms.** `requireLeaderSession(minRole)` middleware
   (`src/middlewares/requireLeaderSession.ts`) handles Clerk JWT + PIN session and
   **strictly validates the PIN session's `session_token` against
   `profiles.session_token`**. It guards ~25 routes. Separately, `resolveAuth()`
   (`src/lib/permissions.ts`) only checks `expires_at` on the PIN session (no
   `session_token` validation) — a security gap. A few routes parse `x-leader-session`
   inline with the same weak check: `qrcodes.ts`, `admin.ts`, `messages.ts`,
   `profiles.ts` (avatar upload).
2. **`POST /qrcodes/session` is declared twice** (`qrcodes.ts` lines 63 and 159). Express
   runs the first; the second is dead code. The first inserts `type: "session"`.
3. **Schema drift.** The live `qr_code_type` enum is `['public','leader','session']`, but
   the Drizzle schema declares only `['public','leader']`. Code/DB out of sync.
4. **`DELETE /profiles/:id` and `DELETE /leaders/:profileId/account`** delete the profile
   row without removing child rows that FK-reference it → **FK violation**. Referencing
   tables: `attendance.profile_id`, `rsvps.profile_id` (NOT NULL),
   `membership_requests.profile_id` (NOT NULL) + `membership_requests.reviewed_by`,
   `check_in_requests.profile_id` + `check_in_requests.reviewed_by`,
   `leader_permissions.profile_id`, `events.created_by`.
5. **`messages` has no FK to `profiles`** (`sender_id` is free `text` on a separate
   Drizzle client). Deleting a profile does not FK-violate from messages.
6. **Phone uniqueness.** `profiles.phone` is nullable with no unique constraint. Register
   endpoints do not check uniqueness. Live DB has **zero duplicate phones** (5 profiles,
   all with a phone) — so a partial unique index is safe to apply now.
7. **`leaders/verify-pin`** correctly issues a `session_token` and returns
   `{ profile_id, session_token, expires_at, ... }`. Confirms the strict middleware is the
   intended contract; the weak inline checks are the inconsistency.

## Changes

### A. Unify session validation (auth consolidation)

- Add `validateLeaderSession(header: unknown): Promise<Profile | null>` to
  `src/lib/permissions.ts`. It parses the header, requires `profile_id` +
  `session_token` + `expires_at`, checks expiry, loads the profile, and confirms
  `profile.session_token === session_token`. Returns the profile or `null`.
- Refactor `requireLeaderSession` to call `validateLeaderSession` for its PIN branch
  (behavior unchanged — it already does this; now shared).
- Refactor `resolveAuth()` to call `validateLeaderSession` for its PIN branch — this
  **closes the security gap** (was `expires_at`-only).
- Convert inline-auth routes:
  - `qrcodes.ts` (`/qrcodes/session`, `/qrcodes/regenerate`, `/qrcodes/leader`) and
    `admin.ts` (`/reset-data`) → guard with `requireLeaderSession` (leader or super_admin
    as appropriate; `/reset-data` keeps super_admin-only).
  - `messages.ts` and `profiles.ts` avatar upload → use hardened `resolveAuth()` (these
    need member-or-leader branching, so middleware that forces leader role is wrong).
- No route retains its own `x-leader-session` JSON parsing afterward.

### B. `GET /profiles/members-directory` (new)

- Guard: `requireLeaderSession("leader")`.
- Filters to roles in `('member','leader','super_admin')`.
- Query params: `search` (matches `full_name` or `phone`, ILIKE), `role` (optional, must
  be one of the three), `page` (default 1), `limit` (default 50, max 100).
- Returns `{ data: <projected rows>, total, page, limit }`. Projected columns mirror the
  existing `/profiles` projection (id, full_name, role, phone, email, school,
  parent_phone, parent_name, whatsapp_opt_in, avatar_url, created_at, can_* flags).
- `/profiles` is left unchanged.

### C. Fix Generate Session QR (#10)

- Update `lib/db/src/schema/index.ts`: `qrCodeTypeEnum` → `['public','leader','session']`
  to match the live DB (no DB migration needed for the enum; it already has `session`).
- Delete the duplicate `POST /qrcodes/session` (lines 159–203). Keep the first handler.
- Guard the surviving handler with `requireLeaderSession("leader")` (per change A).
- Remove the now-unnecessary `as any` casts on `type: "session"` since the enum includes
  it. Response shape stays `{ slug, type }`.

### D. Cascading profile delete

- Add `deleteProfileCascade(profileId: string): Promise<void>` (new module
  `src/lib/deleteProfileCascade.ts`). In a single `db.transaction`:
  1. `delete attendance where profile_id = id`
  2. `delete rsvps where profile_id = id`
  3. `delete check_in_requests where profile_id = id`
  4. `update check_in_requests set reviewed_by = null where reviewed_by = id`
  5. `delete membership_requests where profile_id = id`
  6. `update membership_requests set reviewed_by = null where reviewed_by = id`
  7. `delete leader_permissions where profile_id = id`
  8. `update events set created_by = null where created_by = id`
  9. `delete profiles where id = id`
- Clerk user deletion happens **after** the transaction commits (external call, must not
  hold a DB transaction open); failure is logged, not fatal (the DB row is already gone).
- `messages` are intentionally untouched (no FK; loosely coupled via `sender_id` text).
  Documented as a deliberate decision.
- `DELETE /profiles/:id` (super_admin) and `DELETE /leaders/:profileId/account`
  (super_admin) both call `deleteProfileCascade` then the Clerk delete. The two routes
  keep their existing paths/auth but share the helper.

### E. Phone uniqueness

- App-level: in `POST /profiles/register/first-timer`, `POST /profiles/register`, and the
  leader `PATCH /profiles/:id` (when `phone` is provided), normalize as
  `lower(btrim(phone))` and reject a collision with another profile:
  `409 { error: "This number is already registered", duplicate: true }`.
  (Self-update `PATCH /profiles/me` excludes the caller's own row from the check.)
- DB: partial unique index via Supabase migration:
  `create unique index profiles_phone_unique on profiles (lower(btrim(phone)))
   where phone is not null and btrim(phone) <> '';`
- Mirror the index in `lib/db/src/schema/index.ts` (Drizzle `uniqueIndex` with the same
  predicate) so the schema reflects reality.

### F. Schema-drift reconciliation

- All DDL (the phone index; enum is already correct in DB) applied via Supabase
  `apply_migration`, and the Drizzle schema file updated to match.
- Post-migration verification queries: re-read `pg_enum` for `qr_code_type` and
  `pg_indexes`/`pg_constraint` for the phone index.
- One-time drift scan: compare `lib/db` table/enum definitions against live
  `information_schema` for any other mismatches; report findings (fix only if trivial and
  in-scope, otherwise note for a later sub-project).

## Verification

- `pnpm --filter=@workspace/api-server run build` and `pnpm -w run typecheck:libs` pass.
- Unit tests (added under `artifacts/api-server`):
  - `validateLeaderSession`: valid session, wrong `session_token`, expired, malformed.
  - members-directory: role filter excludes visitors; search matches name/phone;
    pagination caps `limit` at 100.
  - phone-dup: register with an existing phone → 409 `{ duplicate: true }`.
  - `deleteProfileCascade`: seed a profile with attendance + rsvp + membership_request +
    leader_permissions rows, run helper, assert all child rows gone and profile gone, in a
    rolled-back transaction so the test DB is untouched.
- Migration verified by the post-migration `pg_enum` / `pg_indexes` queries.

## Out of scope (later sub-projects)

- RSVP "Unknown Event" + Going/Can't-Make-It button fixes (frontend `my.tsx`) → #3.
- Live reproduction/verification that the members directory loads in the browser → #3
  (depends on the frontend sending a complete leader session).
- Duplicate-merge tool UI → #4.
- Visual redesign → #5.

## Commit plan

Multiple small commits on `backend-correctness`, e.g.:
- `feat(api): add shared validateLeaderSession; harden resolveAuth`
- `refactor(api): route qrcodes/admin auth through requireLeaderSession`
- `fix(api): remove duplicate session-QR route; sync qr_code_type enum`
- `feat(api): add GET /profiles/members-directory`
- `feat(api): cascading profile delete via shared helper`
- `feat(db): phone uniqueness check + partial unique index`
