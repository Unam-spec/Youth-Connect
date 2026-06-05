# Backend → Supabase Edge Functions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`). This re-platforms the Node/Express backend (Railway) to Deno on Supabase Edge Functions, as many small functions.

**Goal:** Run the Youth-Connect API on Supabase Edge Functions (Deno), eliminating Railway, with no change to the frontend beyond one `vercel.json` rewrite destination.

**Architecture:** Many small Deno functions (one per URL-prefix) using Hono, sharing a `supabase/functions/_shared/` library (Drizzle-over-postgres-js DB client, Clerk+PIN auth, denomailer email, CORS). Deployed via the Supabase MCP `deploy_edge_function` (no local CLI). DB connection uses the built-in `SUPABASE_DB_URL`. Railway stays live until the final cutover.

**Tech Stack:** Deno, Hono, drizzle-orm/postgres-js, @clerk/backend, bcryptjs, denomailer, Supabase Edge Functions + Cron + Storage.

**Spec:** `docs/superpowers/specs/2026-06-02-backend-to-supabase-design.md`
**Branch:** `backend-to-supabase`
**Supabase project ref:** `oobjbxurtbtwcvfhpyak`

## Tooling & ownership (read first)
- **Deploy:** via Supabase MCP `deploy_edge_function` (CLI not installed). The controller (assistant) performs deploys and DB verification (`execute_sql`).
- **Secrets the USER must set once** (Supabase dashboard → Project Settings → Edge Functions → Manage secrets, or it can be done in the Functions UI): `CLERK_SECRET_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `EMAIL_FROM_NAME`, `FRONTEND_URL`. `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by Supabase — do NOT set these.
- **Auth testing:** verifying a real Clerk JWT requires a token from a logged-in browser session — the USER supplies one (DevTools → a request's `Authorization: Bearer …`) OR tests via the deployed app at cutover. DB/bcrypt/email validation needs no user token.
- Deno imports use `npm:` specifiers (e.g. `npm:hono`, `npm:drizzle-orm/postgres-js`, `npm:postgres`, `npm:@clerk/backend`, `npm:bcryptjs`) and `jsr:`/`https://deno.land/x/denomailer` for email. Pin versions in each function.

---

## PHASE 0 — Spike (de-risk before porting anything)

### Task 0.1: Scaffold the spike function

**Files:** Create `supabase/functions/spike/index.ts`, `supabase/functions/_shared/schema.ts`.

- [ ] **Step 1: Vendor the schema for Deno**

Create `supabase/functions/_shared/schema.ts` that re-exports the tables the spike needs. To
keep one source of truth, it re-exports from the repo schema via a relative path that Deno can
read:
```ts
// Mirrors lib/db/src/schema/index.ts (single source of truth).
// Deno reads the TS directly; drizzle-orm/zod resolve via npm: specifiers.
export * from "../../../lib/db/src/schema/index.ts";
```
(If Deno cannot resolve the workspace `drizzle-zod`/`zod/v4` imports in that file during deploy,
fall back: copy the `pgTable` definitions needed into this file verbatim and add a comment that
it mirrors `lib/db`. Decide at deploy time in Step 4.)

- [ ] **Step 2: Write the spike function**

Create `supabase/functions/spike/index.ts`:
```ts
import { Hono } from "npm:hono@4";
import postgres from "npm:postgres@3";
import { drizzle } from "npm:drizzle-orm@0.45.2/postgres-js";
import { eq } from "npm:drizzle-orm@0.45.2";
import bcrypt from "npm:bcryptjs@2";
import { verifyToken } from "npm:@clerk/backend@1";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { profilesTable } from "../_shared/schema.ts";

const app = new Hono();
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });
const db = drizzle(sql);

app.get("/spike/db", async (c) => {
  const rows = await db.select({ id: profilesTable.id, pin: profilesTable.pin_hash, role: profilesTable.role }).from(profilesTable).limit(3);
  return c.json({ ok: true, count: rows.length });
});

app.get("/spike/bcrypt", async (c) => {
  // Read a real bcrypt PIN hash and confirm bcryptjs can compare against it.
  const [p] = await db.select({ pin: profilesTable.pin_hash }).from(profilesTable).where(eq(profilesTable.role, "super_admin")).limit(1);
  if (!p?.pin) return c.json({ ok: false, reason: "no pin hash found" });
  const looksBcrypt = p.pin.startsWith("$2");
  const wrong = await bcrypt.compare("000000", p.pin); // should be false but must not throw
  return c.json({ ok: looksBcrypt, looksBcrypt, comparedWithoutThrow: wrong === false || wrong === true });
});

app.get("/spike/clerk", async (c) => {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.replace("Bearer ", "");
  if (!token) return c.json({ ok: false, reason: "no token" });
  try {
    const payload = await verifyToken(token, { secretKey: Deno.env.get("CLERK_SECRET_KEY")! });
    return c.json({ ok: true, sub: payload.sub });
  } catch (e) {
    return c.json({ ok: false, reason: String(e) });
  }
});

app.get("/spike/email", async (c) => {
  try {
    const client = new SMTPClient({
      connection: { hostname: "smtp.gmail.com", port: 465, tls: true,
        auth: { username: Deno.env.get("GMAIL_USER")!, password: Deno.env.get("GMAIL_APP_PASSWORD")! } },
    });
    await client.send({
      from: `${Deno.env.get("EMAIL_FROM_NAME") ?? "JG Youth"} <${Deno.env.get("GMAIL_USER")}>`,
      to: Deno.env.get("GMAIL_USER")!,
      subject: "Supabase Edge spike test",
      content: "If you received this, denomailer + Gmail works on Deno.",
    });
    await client.close();
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ ok: false, reason: String(e) });
  }
});

Deno.serve(app.fetch);
```

- [ ] **Step 3 (USER): set the secrets**

Ask the user to set, in the Supabase dashboard (Edge Functions → Secrets):
`CLERK_SECRET_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `EMAIL_FROM_NAME`. Confirm done.

- [ ] **Step 4 (CONTROLLER): deploy the spike**

Deploy via Supabase MCP `deploy_edge_function` (project `oobjbxurtbtwcvfhpyak`, name `spike`,
entrypoint `index.ts`, include `_shared/schema.ts`). If the deploy fails resolving the workspace
schema import, apply the Step-1 fallback (inline the needed `pgTable` defs) and redeploy.

- [ ] **Step 5 (CONTROLLER): validate each unknown**

Curl the deployed URL `https://oobjbxurtbtwcvfhpyak.supabase.co/functions/v1/spike/...`:
- `/spike/db` → `{ ok: true }` (DB via pooler works).
- `/spike/bcrypt` → `{ ok: true, looksBcrypt: true }` (bcryptjs reads `$2` hashes).
- `/spike/email` → `{ ok: true }` AND the user confirms the email arrived (Gmail-on-Deno works).
- `/spike/clerk` → ask the USER to hit it from a logged-in browser session (or paste a Bearer token) → expect `{ ok: true, sub }`.

- [ ] **Step 6: Decision gate**

If `/spike/email` fails: STOP and switch the email transport design to an HTTP provider before P2
(re-open the spec). If all four pass: proceed. Commit the spike code:
```bash
git add supabase/ && git commit -m "chore(supabase): phase-0 spike (db, bcrypt, clerk, email validation)"
```

---

## PHASE 1 — Foundation (`_shared` + first real functions)

### Task 1.1: `_shared` library

**Files:** Create `supabase/functions/_shared/{db.ts,auth.ts,email.ts,cors.ts}` and
`supabase/functions/deno.json`.

- [ ] **Step 1:** `_shared/db.ts` — export a singleton `db` (drizzle over `postgres(SUPABASE_DB_URL, { prepare: false })`) and the `sql` client, importing tables from `./schema.ts`.
- [ ] **Step 2:** `_shared/cors.ts` — `corsHeaders` (allow the Vercel origin + `*` fallback, methods, `authorization, x-leader-session, content-type`) and an `withCors(app)` helper that handles `OPTIONS` preflight.
- [ ] **Step 3:** `_shared/auth.ts` — port `validateLeaderSession(header)`, `resolveAuth(req)` (Clerk `verifyToken` + PIN), and a Hono middleware `requireRole(min: "leader"|"super_admin")` that mirrors `requireLeaderSession` (sets `c.set("leaderId"/"leaderRole")`). Reuse the exact DB logic from `artifacts/api-server/src/lib/permissions.ts` + `validateLeaderSession.ts` + `middlewares/requireLeaderSession.ts`.
- [ ] **Step 4:** `_shared/email.ts` — `sendEmail({to,subject,text,html})` via denomailer (from the validated spike code); throws on missing creds.
- [ ] **Step 5:** `deno.json` — import map pinning the npm:/jsr: versions used across functions.
- [ ] **Step 6:** Commit `chore(supabase): _shared library (db, auth, email, cors)`.

### Task 1.2: `healthz` + `profiles` functions

**Files:** Create `supabase/functions/healthz/index.ts`, `supabase/functions/profiles/index.ts`.

- [ ] **Step 1:** `healthz` — a Hono app with `GET /healthz` → `{ ok: true }`, wrapped with CORS. Deploy via MCP; curl → 200.
- [ ] **Step 2:** `profiles` — port EVERY route from `artifacts/api-server/src/routes/profiles.ts` (and the `/profiles/register/*` routes from `register.ts`) into a Hono app: `GET /profiles/me`, `PATCH /profiles/me`, `GET/PATCH /profiles/me/pin`, `POST /profiles/register/first-timer`, `POST /profiles/verify-link`, `POST /profiles/register`, `GET /profiles/members-directory`, `GET /profiles`, `GET /profiles/:id`, role/permission/promote/revoke routes, `PATCH /profiles/:id`, `DELETE /profiles/:id`, `POST /profiles/merge`, `POST /profiles/avatar/upload`. Use `_shared` helpers; preserve response shapes and status codes exactly. Avatar upload uses `c.req.formData()` + Supabase Storage (P3 may refine).
- [ ] **Step 3 (CONTROLLER):** deploy `healthz` and `profiles` via MCP; curl unauthenticated routes (expect 401 where auth required), and `GET /profiles/members-directory` with a USER-supplied leader `x-leader-session` to confirm parity with Railway.
- [ ] **Step 4:** Commit `feat(supabase): healthz + profiles functions`.

---

## PHASE 2 — Port remaining functions (one task each)

For EACH of these, create `supabase/functions/<name>/index.ts` as a Hono app porting every
route from the matching `artifacts/api-server/src/routes/*.ts`, using `_shared`, preserving
response shapes/status codes; deploy via MCP; verify key routes; commit `feat(supabase): <name> function`.

- [ ] **Task 2.1 `leaders`** ← `leaders.ts` (incl. `/leaders/verify-pin`, `/leaders/session`, `/leaders/pins`, set/reset-pin, demote, delete, logout, revoke-session). Uses `bcryptjs`.
- [ ] **Task 2.2 `events`** ← `events.ts`.
- [ ] **Task 2.3 `attendance`** ← `attendance.ts` (incl. `/attendance/my`, `/attendance/today`, role-gate).
- [ ] **Task 2.4 `rsvps`** ← `rsvps.ts`.
- [ ] **Task 2.5 `membership-requests`** ← `membership.ts` (function name `membership-requests`).
- [ ] **Task 2.6 `checkin`** ← `checkin.ts`.
- [ ] **Task 2.7 `qrcodes`** ← `qrcodes.ts`.
- [ ] **Task 2.8 `dashboard`** ← `dashboard.ts`.
- [ ] **Task 2.9 `messages`** ← `messages.ts` (drop the SSE `/messages/stream` route; keep GET/POST/PATCH/DELETE). Uses the separate `messagesDb` → now the same `_shared/db`.
- [ ] **Task 2.10 `reset-data`** ← `admin.ts` (`POST /reset-data`).

---

## PHASE 3 — Email cron + storage

- [ ] **Task 3.1 `cron-process-emails`** — create `supabase/functions/cron-process-emails/index.ts` that drains `pending_emails` (the exact logic from `jobs/emailProcessor.ts`: lock `sent_at IS NULL AND attempts < max_attempts`, increment attempts, `sendEmail`, set `sent_at` or `last_error`) and returns a summary. Deploy via MCP.
- [ ] **Task 3.2 Schedule it** — via Supabase Cron: `execute_sql` to `select cron.schedule('process-emails','* * * * *', $$ select net.http_post(url:='https://oobjbxurtbtwcvfhpyak.supabase.co/functions/v1/cron-process-emails', headers:='{"Authorization":"Bearer <service_role>"}'::jsonb) $$)`. (Requires `pg_cron` + `pg_net` extensions — enable via `execute_sql`/`apply_migration` if not enabled. The USER provides/confirms the service-role bearer, or use the anon flow with `verify_jwt=false`.) Verify a queued test email gets sent within ~1 min.
- [ ] **Task 3.3 Avatar storage** — ensure `/profiles/avatar/upload` writes to a Supabase Storage bucket (create bucket via MCP/SQL if needed) and returns the public URL, matching today's behavior.

---

## PHASE 4 — Cutover & decommission

- [ ] **Task 4.1 Parity sweep** — for every function, curl the deployed route and compare response shape/status to the current Railway endpoint (same inputs). Fix mismatches. Confirm `config.toml`/deploy set `verify_jwt = false` on all functions.
- [ ] **Task 4.2 Flip the frontend** — in `vercel.json`, change the API rewrite `destination` to `https://oobjbxurtbtwcvfhpyak.supabase.co/functions/v1/$1`. Commit. (USER pushes/merges to deploy.)
- [ ] **Task 4.3 Live verification** — after the Vercel deploy, the USER walks the app: login (Clerk + PIN), members directory, leader pins, check-in, RSVP, chat, make-super-admin, trigger an email. Fix any breakage.
- [ ] **Task 4.4 Decommission** — once verified for a day: delete the Railway service (USER, in Railway dashboard), and remove `artifacts/api-server/`, `railway.toml`, and api-server references from root `package.json`/scripts. Delete the `spike` function. Commit `chore: remove Railway backend after Supabase cutover`.

## Self-review notes
- Each function preserves exact response shapes/status codes — no API contract change.
- `_shared` is the single source of auth/db/email logic — no duplication across functions.
- Railway remains the live backend until Task 4.2; rollback = revert the `vercel.json` rewrite.
- The two risks (email-on-Deno, bcrypt) are gated by Phase 0 before any porting effort.
