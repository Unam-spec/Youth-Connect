# Backend → Supabase Edge Functions — Design

**Date:** 2026-06-02
**Sub-project:** 6 of N (Youth-Connect overhaul) — re-platform the backend
**Status:** Approved (direction); spec under review
**Branch:** `backend-to-supabase`

## Goal

Stop deploying the backend on Railway by porting the Express/Node API to **Supabase
Edge Functions (Deno)**, as **many small functions** (one per URL-prefix group). Frontend
hosting (Vercel), DB (Supabase Postgres), Clerk auth, and Gmail email are retained.

## Why this is a rewrite, not a move

Supabase compute = Deno Edge Functions. The current backend is Express/Node with several
Node-only deps. Each is swapped for a Deno-compatible equivalent (table below). The route
*logic* (Drizzle queries, auth rules, business logic) is preserved; the HTTP framework and
a few infra deps change.

## Dependency swaps

| Today (Node/Railway) | Supabase Edge (Deno) |
|---|---|
| Express + middleware | **Hono** (one small instance per function) |
| `@clerk/express` `clerkMiddleware`/`getAuth` | **`@clerk/backend`** `verifyToken()` (from the `Authorization: Bearer` JWT) |
| `pg` Pool + `drizzle-orm/node-postgres` | **`postgres-js`** + `drizzle-orm/postgres-js`, via the **Supabase pooler (Supavisor, transaction mode)** |
| `bcrypt` (native) | **`bcryptjs`** (pure JS; verifies existing `$2a/$2b` PIN hashes) |
| `nodemailer` Gmail SMTP | **`denomailer`** (SMTP-over-TLS to smtp.gmail.com:465) — *risk, validated in Phase 0* |
| `setInterval` email processor (60s) | **Supabase Cron** → `cron-process-emails` function every minute |
| boot-time `SCHEMA_PATCHES` (`runMigrations`) | dropped; schema managed via Supabase migrations |
| `multer` avatar upload | Hono `c.req.formData()` + **Supabase Storage** |
| `@sentry/node`, `pino` | `console`-based logging (or `@sentry/deno` later); not on the critical path |

## Function decomposition (many small functions)

`supabase/functions/`:
- `_shared/` (NOT deployed; imported by functions):
  - `db.ts` — drizzle client over postgres-js using `SUPABASE_DB_URL` (pooler).
  - `schema.ts` — re-exports the Drizzle schema (single source of truth; see Monorepo note).
  - `auth.ts` — `verifyClerk(req)`, `validateLeaderSession(header)`, `resolveAuth(req)`,
    `requireRole(min)` (ports of the existing `lib/permissions` + `validateLeaderSession` +
    `requireLeaderSession`).
  - `email.ts` — `sendEmail()` via denomailer (Gmail).
  - `cors.ts` — CORS headers + OPTIONS preflight helper.
  - `router.ts` — tiny helper to build a Hono app with CORS + error wrapper.
- One deployable function per URL prefix (internal Hono router handles sub-paths):
  `profiles`, `leaders`, `events`, `attendance`, `rsvps`, `membership-requests`, `checkin`,
  `qrcodes`, `dashboard`, `messages`, `reset-data` (admin), `healthz`.
- `cron-process-emails` — drains `pending_emails` via `_shared/email`; invoked by Supabase Cron.

Each function's internal routes use the **full path including the function-name segment**
(e.g. the `profiles` function defines `/profiles/me`, `/profiles/:id`, `/profiles/merge`,
`/profiles/register/first-timer`, `/profiles/avatar/upload`, …) because Supabase passes the
pathname as `/<function>/<rest>`. `config.toml` sets `verify_jwt = false` for every function
(auth is Clerk/PIN, not Supabase JWT).

Note: the current `register.ts` endpoints live under `/profiles/register/*`, so they fold
into the `profiles` function. `admin.ts`'s `/reset-data` becomes the `reset-data` function.
The SSE `messages/stream` endpoint is dropped (the frontend already polls).

## Frontend cutover

`vercel.json`: change the API rewrite destination only —
`{ "source": "/api/(.*)", "destination": "https://oobjbxurtbtwcvfhpyak.supabase.co/functions/v1/$1" }`.
The frontend keeps calling relative `/api/...`. The query→header shim (`?token=`,
`?leader_session=`) is no longer needed (SSE dropped) but harmless if kept in CORS handling.

## Monorepo / schema sharing

The Drizzle schema in `lib/db/src/schema/index.ts` is the single source of truth. The Deno
functions reference it via a `deno.json` import map entry pointing at that TS file (Deno can
import the TS directly; `drizzle-orm` and `zod` resolve via `npm:` specifiers). If direct
import proves impractical under Deno, vendor a copy into `_shared/schema.ts` with a comment
that it mirrors `lib/db` and a verification step in the plan. The Node `artifacts/api-server`
package stays in the repo until P4, then is deleted.

## Secrets / env

Set as Supabase Function secrets (`supabase secrets set`): `SUPABASE_DB_URL` (pooler),
`CLERK_SECRET_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `EMAIL_FROM_NAME`, `FRONTEND_URL`,
`CLERK_PUBLISHABLE_KEY` (if needed for verifyToken). `SUPABASE_URL` + service-role key for
Storage. No secrets in code or committed files.

## Phase 0 — Spike (validate before porting)

Deploy a throwaway `spike` function and confirm against the live project, end-to-end:
1. DB connect + a Drizzle `select` via the pooler.
2. `@clerk/backend` verifies a real Clerk JWT (from a logged-in session token).
3. `bcryptjs` verifies an **existing** PIN hash read from the DB (PIN-login compatibility).
4. `denomailer` sends **one Gmail email**.
If (4) fails on Deno Deploy, switch the email transport to an HTTP provider before P2;
everything else is low-risk. Delete the spike function after.

## Phases (each ships independently; Railway stays live until P4)

- **P1 Foundation:** `_shared/*`, `config.toml`, and the `healthz` + `profiles` functions
  fully working (DB, Clerk + PIN auth, CORS) — proves the pattern end-to-end on a real route.
- **P2 Route port:** the remaining functions in batches, reusing `_shared`: `leaders`,
  `events`, `attendance`, `rsvps`, `membership-requests`, `checkin`, `qrcodes`, `dashboard`,
  `messages`, `reset-data`.
- **P3 Email + storage:** `cron-process-emails` + Supabase Cron schedule; avatar upload →
  Supabase Storage.
- **P4 Cutover & decommission:** point `vercel.json` at the function URL, verify the live app
  end-to-end (login, members directory, check-in, chat, RSVP, an email), then **remove the
  Railway service and `artifacts/api-server`** + `railway.toml`.

## Testing / verification

- Per function: `supabase functions serve` locally + curl the routes; deploy to the live
  project and curl with a real Clerk JWT and a PIN `x-leader-session`.
- Parity check: for each ported route, compare response shape against the current Railway
  endpoint before cutover.
- Keep the pure-logic unit tests (`validateLeaderSession`, `mergeProfiles`, `phone`,
  `membersDirectoryQuery`) runnable against the ported `_shared` helpers (Deno test or keep
  them in the Node package until P4).
- Final: the live app on the new backend passes the same manual QA as today.

## Risks

1. **Gmail SMTP on Deno** (denomailer) — primary risk; Phase 0 validates; HTTP-provider fallback.
2. **bcrypt hash compatibility** — mitigated by `bcryptjs` (standard `$2` verification); Phase 0 confirms.
3. **DB pooler limits** — use Supavisor transaction-mode pooler; keep connections short-lived per request.
4. **Cold starts** — acceptable for this app's traffic.

## Out of scope
- No behavioral/API changes — response shapes and auth rules are preserved.
- No frontend changes beyond the one `vercel.json` rewrite destination.

## Decommission
After P4 verification: delete the Railway service, `railway.toml`, and `artifacts/api-server`;
update root scripts/docs. The repo keeps `lib/db` (shared schema) and the new `supabase/`.
