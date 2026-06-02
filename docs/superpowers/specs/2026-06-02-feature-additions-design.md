# Feature Additions — Design

**Date:** 2026-06-02
**Sub-project:** 4 of N (Youth-Connect end-to-end overhaul)
**Status:** Approved
**Branch:** `feature-additions`

## Context

Sub-project #4 of the sequenced overhaul. Grounded in a fresh audit of current code (the
original spec is partially stale; several listed features are already built). UI work uses
the `frontend-design` skill, per user request, and must match the existing iOS-flavoured
dark aesthetic (glass cards, rounded-2xl, teal/blue accents, Inter/Sora).

Backend = `artifacts/api-server` (Express, Drizzle). Frontend = `artifacts/jg-youth`
(React 19, wouter, TanStack Query, generated API client via orval in `lib/api-spec` →
`lib/api-client-react` + `lib/api-zod`). Leader dashboard panels live in
`artifacts/jg-youth/src/components/panels/`.

## Audit (what already exists)

- `GET /attendance?profile_id=` exists (Clerk-auth) but is NOT role-gated and there is no
  member self-view UI on `/my`.
- No profile-merge endpoint or UI anywhere.
- `RequestsPanel` shows membership requests but there is no count badge on its tab.
- No time-based banner anywhere.
- The member directory (`MemberDirectoryPanel`) has the data to flag incomplete profiles
  but shows no badge.
- Phone-duplicate prevention already shipped in sub-project #2.

## Features

### A. Member attendance history

**Backend**
- Add `GET /attendance/my` (Clerk-auth): returns the caller's own attendance rows
  (`session_date`, `check_in_method`, `checked_in_at`, joined `event.title`), newest first.
- Harden `GET /attendance?profile_id=`: allow only when the caller is a leader/super_admin
  (via `resolveAuth`) OR is querying their own profile. Other authenticated callers get 403
  when requesting a `profile_id` that isn't theirs.

**Frontend**
- `/my`: new **"My Check-ins"** section (glass card list) showing date, session label, and
  method badge (QR / Self / Manual). Empty state when none.
- Super-admin: a **"View attendance"** action per member in `MemberDirectoryPanel` opens a
  dialog listing that member's check-ins (fetched via `/attendance?profile_id=`).

### B. Notification banners + pending-approval badge

**Frontend only (no new backend)**
- **Pending badge:** the leader dashboard's Requests tab shows a count of `pending`
  membership requests (derive from the existing membership-requests query). Hidden when 0.
- **Friday "thanks" banner:** on `/my`, compute current time in SAST (Africa/Johannesburg,
  UTC+2, no DST). If it is Friday and the time is between 22:00 and 23:59:59, show a
  dismissible banner: "Thanks for coming tonight! 🙌". Dismissal persists for the night via
  `localStorage` keyed by the date.

### C. Duplicate-profile merge tool (super-admin)

**Backend**
- `POST /profiles/merge` (super-admin via `requireLeaderSession("super_admin")`), body
  `{ keepId: string, mergeId: string }`. Reject when `keepId === mergeId` (400) or either
  profile missing (404). In one transaction:
  1. `attendance`: `UPDATE ... SET profile_id = keepId WHERE profile_id = mergeId`.
  2. `rsvps`: reassign, but first delete `mergeId` rsvps whose `event_id` already has a
     `keepId` rsvp (avoid the event+profile unique collision); then reassign the rest.
  3. `check_in_requests`: reassign `profile_id`; null `reviewed_by` where it equals
     `mergeId` only if needed (reassign to keepId is fine since reviewer identity merges).
     Use reassign to `keepId`.
  4. `membership_requests`: reassign `profile_id` and `reviewed_by` to `keepId`.
  5. `leader_permissions`: if `keepId` already has a row, delete `mergeId`'s row; else
     reassign it to `keepId`.
  6. Backfill missing fields on `keepId` from `mergeId` where `keepId`'s are null/blank
     (phone, email, school, parent_phone, parent_name, avatar_url, gender, age).
  7. Delete the `mergeId` profile row.
  After commit: delete the `mergeId` Clerk user (best-effort, logged).
- Extract the reassignment plan into a small pure helper where practical so the SQL order
  is unit-test-documented; the merge itself is integration-verified.

**Frontend**
- Super-admin merge UI in `MemberDirectoryPanel` (or a dedicated section): pick a "keep"
  profile and a "merge-from" profile, confirm in a dialog that names both and warns the
  action is irreversible, then `POST /profiles/merge`. On success, invalidate the member
  list and toast.

### D. Incomplete Profile badge

**Frontend only**
- In `MemberDirectoryPanel`, render an amber **"Incomplete"** badge next to any profile
  where `full_name === "New Member"`, `full_name` is blank, or `phone` is missing/blank.

## API client regeneration

New endpoints (`/attendance/my`, `/profiles/merge`) are added to
`lib/api-spec/openapi.yaml` and the client regenerated via
`pnpm --filter=@workspace/api-spec run codegen` (do not hand-edit generated files).
`/attendance?profile_id=` already exists in the client.

## Verification

- `pnpm -w run typecheck:libs`, both package builds, and `pnpm --filter=@workspace/api-server test` pass.
- Unit tests: merge reassignment ordering/conflict helper; SAST Friday-banner time check
  (pure function, fixed clock inputs); `/attendance/my` shape.
- Controller-run rollback test of the merge SQL against the live DB (seed two profiles +
  children, merge, assert children moved + duplicate gone, then ROLLBACK).
- Frontend builds; manual check of the new UI after deploy.

## Out of scope

- Full visual redesign of existing pages → sub-project #5.
- Any change to the check-in/QR flows beyond what merge/attendance touch.

## Commit plan

Small commits on `feature-additions`, e.g. `feat(api): GET /attendance/my + role-gate`,
`feat(api): POST /profiles/merge`, `feat(web): my check-ins section`,
`feat(web): merge tool + incomplete badge`, `feat(web): pending badge + friday banner`.
