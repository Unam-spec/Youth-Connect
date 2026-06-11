# PIN Accounts UI — Backend Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the three backend endpoints the PIN-accounts UI needs — a leader list of PIN accounts, a PIN-session-friendly self-profile endpoint, and parent-info support on promotion — on BOTH the Express (Railway) backend and the Supabase edge mirror.

**Architecture:** Extend the existing `pinAccounts` router (Express) and the `auth` / `pin-accounts` edge functions (Supabase). Reuse the existing `resolveAccount` (Express) / `resolveAuth` (Supabase) resolver for the self endpoint, and `requireLeaderSession` / `requireRole` for the leader list. The promote change makes an under-13 promotion atomic by persisting parent fields before the consent gate runs.

**Tech Stack:** Express + Drizzle (`@workspace/db`), Deno/Hono edge functions, Postgres. No schema changes (the `username`/`pin_plain`/`parental_consent_*` columns already exist).

**Scope:** Backend only. The React UI is a separate follow-up plan (`pin-accounts-ui-frontend`). This plan produces curl-testable endpoints on both backends.

**Why no new unit tests:** these are route-wiring changes over Drizzle queries; the only pure logic (the consent gate) is already unit-tested. Verification is `npm run typecheck` + the existing 42 tests staying green + manual curl. (Matches how the original backend routes were verified.)

---

## File Structure

**Express:**
- Modify: `artifacts/api-server/src/routes/pinAccounts.ts` — add `GET /pin-accounts`, `GET /auth/me`; modify `POST /pin-accounts/:id/grant-membership`.

**Supabase:**
- Modify: `supabase/functions/pin-accounts/index.ts` — add `GET /pin-accounts`; modify the grant-membership handler.
- Modify: `supabase/functions/auth/index.ts` — add `GET /auth/me`.

**Commands:**
- Express typecheck: `cd artifacts/api-server && npm run typecheck`
- Express tests: `cd artifacts/api-server && npm test`
- Supabase: `deno check ...` if available, else manual diff (Deno is not installed locally).

---

## Phase 1 — Express backend

### Task 1: Add `GET /auth/me` (self profile, Clerk or PIN session)

**Files:**
- Modify: `artifacts/api-server/src/routes/pinAccounts.ts`

Context: `resolveAccount(req)` (already imported in this file) returns the caller's `Profile` from a Clerk JWT or a PIN `x-leader-session`, or null. This endpoint lets a visitor/member load their own minimal profile (the leader-gated `GET /profiles/:id` can't serve them).

- [ ] **Step 1: Add the route**

In `artifacts/api-server/src/routes/pinAccounts.ts`, add this route immediately before `export default router;`:

```ts
// GET /auth/me — the caller's own minimal profile (Clerk OR PIN session).
router.get("/auth/me", async (req, res) => {
  try {
    const profile = await resolveAccount(req);
    if (!profile) return res.status(401).json({ error: "Unauthorized" });
    return res.json({
      id: profile.id,
      full_name: profile.full_name,
      username: profile.username,
      role: profile.role,
      age: profile.age,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
```

- [ ] **Step 2: Typecheck**

Run: `cd artifacts/api-server && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/routes/pinAccounts.ts
git commit -m "feat(api): GET /auth/me — self profile for Clerk or PIN session"
```

### Task 2: Add `GET /pin-accounts` (leader list)

**Files:**
- Modify: `artifacts/api-server/src/routes/pinAccounts.ts`

- [ ] **Step 1: Add `isNotNull` to the drizzle import**

The existing drizzle import line in this file is:
```ts
import { eq, sql } from "drizzle-orm";
```
Change it to:
```ts
import { eq, sql, isNotNull, desc } from "drizzle-orm";
```

- [ ] **Step 2: Add the route**

Add immediately before `export default router;`:

```ts
// GET /pin-accounts — leader list of username+PIN accounts (visitors & members).
router.get("/pin-accounts", requireLeaderSession("leader"), async (req, res) => {
  try {
    const rows = await db
      .select({
        id: profilesTable.id,
        full_name: profilesTable.full_name,
        username: profilesTable.username,
        pin_plain: profilesTable.pin_plain,
        age: profilesTable.age,
        role: profilesTable.role,
        parent_phone: profilesTable.parent_phone,
        parent_name: profilesTable.parent_name,
      })
      .from(profilesTable)
      .where(isNotNull(profilesTable.username))
      .orderBy(desc(profilesTable.created_at));
    return res.json(rows);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
```

- [ ] **Step 3: Typecheck**

Run: `cd artifacts/api-server && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/pinAccounts.ts
git commit -m "feat(api): GET /pin-accounts — leader list of PIN accounts"
```

### Task 3: Persist optional parent fields on grant-membership

**Files:**
- Modify: `artifacts/api-server/src/routes/pinAccounts.ts` (the `POST /pin-accounts/:id/grant-membership` handler)

Context: today the handler gates on the target's stored `parent_phone`/`parent_name`. To let the under-13 promote dialog send parent info + consent in one call, accept optional `parent_name`/`parent_phone`, compute the effective values (body value if non-blank, else existing), gate on those, and persist them in the same update.

- [ ] **Step 1: Replace the handler body**

Find this exact block inside the `grant-membership` handler:
```ts
      const consentProvided = (req.body ?? {}).parental_consent === true;
      const gate = canGrantMembership(
        {
          role: target.role,
          age: target.age,
          parent_phone: target.parent_phone,
          parent_name: target.parent_name,
        },
        consentProvided,
      );
      if (!gate.ok) return res.status(400).json({ error: gate.error });

      // For 13+ no consent is required, so the audit columns are explicitly
      // nulled. Safe: the gate above only lets visitors through, so this never
      // clears an existing member's recorded consent.
      const needsConsent = target.age === null || target.age < CONSENT_AGE;
      const [updated] = await db
        .update(profilesTable)
        .set({
          role: "member",
          parental_consent_at: needsConsent ? new Date() : null,
          parental_consent_by: needsConsent ? req.leaderId : null,
        })
        .where(eq(profilesTable.id, target.id))
        .returning();
```
and REPLACE it with:
```ts
      const body = (req.body ?? {}) as Record<string, unknown>;
      const consentProvided = body.parental_consent === true;
      // Effective parent info: a non-blank value in the request overrides the
      // stored one (lets the under-13 promote dialog supply it in one call).
      const parentName =
        typeof body.parent_name === "string" && body.parent_name.trim()
          ? body.parent_name.trim()
          : target.parent_name;
      const parentPhone =
        typeof body.parent_phone === "string" && body.parent_phone.trim()
          ? body.parent_phone.trim()
          : target.parent_phone;

      const gate = canGrantMembership(
        {
          role: target.role,
          age: target.age,
          parent_phone: parentPhone,
          parent_name: parentName,
        },
        consentProvided,
      );
      if (!gate.ok) return res.status(400).json({ error: gate.error });

      // For 13+ no consent is required, so the audit columns are explicitly
      // nulled. Safe: the gate above only lets visitors through, so this never
      // clears an existing member's recorded consent.
      const needsConsent = target.age === null || target.age < CONSENT_AGE;
      const [updated] = await db
        .update(profilesTable)
        .set({
          role: "member",
          parent_name: parentName,
          parent_phone: parentPhone,
          parental_consent_at: needsConsent ? new Date() : null,
          parental_consent_by: needsConsent ? req.leaderId : null,
        })
        .where(eq(profilesTable.id, target.id))
        .returning();
```

- [ ] **Step 2: Typecheck + full tests**

Run: `cd artifacts/api-server && npm run typecheck && npm test`
Expected: typecheck PASS; tests 42 passed (unchanged — consent gate logic is untouched).

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/routes/pinAccounts.ts
git commit -m "feat(api): grant-membership persists optional parent fields (atomic under-13 promote)"
```

### Task 4: Manual verification (Express)

**Files:** none.

- [ ] **Step 1: Start the server**

Run: `cd artifacts/api-server && npm run dev`
Expected: starts cleanly.

- [ ] **Step 2: Self profile via PIN session**

Sign up a kid (from the earlier feature): `curl -sS -X POST localhost:3000/auth/pin-signup -H 'content-type: application/json' -d '{"full_name":"Dep Kid","username":"depkid1","pin":"8392","age":11}'` → capture `profile_id`, `session_token`, `expires_at`.
Then:
```bash
curl -sS localhost:3000/auth/me \
  -H 'x-leader-session: {"profile_id":"<ID>","session_token":"<TOKEN>","expires_at":<EXP>}'
```
Expected: 200 with `{ id, full_name:"Dep Kid", username:"depkid1", role:"visitor", age:11 }`.

- [ ] **Step 2b: Self profile rejects anonymous**

`curl -sS -o /dev/null -w "%{http_code}" localhost:3000/auth/me` → Expected: `401`.

- [ ] **Step 3: Leader list**

With a leader `x-leader-session` (or Clerk token):
```bash
curl -sS localhost:3000/pin-accounts -H 'x-leader-session: <LEADER_SESSION_JSON>'
```
Expected: 200, a JSON array including the `depkid1` row with `pin_plain:"8392"`, `role:"visitor"`. A non-leader/anon call → 401/403.

- [ ] **Step 4: Atomic under-13 promote**

```bash
curl -sS -X POST localhost:3000/pin-accounts/<KID_ID>/grant-membership \
  -H 'content-type: application/json' -H 'x-leader-session: <LEADER_SESSION_JSON>' \
  -d '{"parental_consent":true,"parent_name":"Mom","parent_phone":"0712345678"}'
```
Expected: 200 `{ success:true, profile:{ role:"member", parent_name:"Mom", parent_phone:"0712345678", parental_consent_at:<ts>, parental_consent_by:<leaderId> } }`. Re-running with no parent fields and a now-13+/non-visitor returns the appropriate gate/validation behavior.

- [ ] **Step 5: Confirm**

If any step deviates, stop and debug before marking the phase complete.

---

## Phase 2 — Supabase edge mirror

### Task 5: Add `GET /auth/me` to the auth function

**Files:**
- Modify: `supabase/functions/auth/index.ts`

Context: mirrors Express Task 1. The auth function already imports `resolveAuth`. `resolveAuth(c.req.raw)` returns `{ profile, ... } | null`.

- [ ] **Step 1: Add the route**

In `supabase/functions/auth/index.ts`, add immediately before `Deno.serve(app.fetch);`:

```ts
// GET /auth/me — the caller's own minimal profile (Clerk OR PIN session).
app.get("/auth/me", async (c) => {
  try {
    const auth = await resolveAuth(c.req.raw);
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    const p = auth.profile;
    return c.json({
      id: p.id,
      full_name: p.full_name,
      username: p.username,
      role: p.role,
      age: p.age,
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});
```

- [ ] **Step 2: Verify**

Run `deno check supabase/functions/auth/index.ts` if Deno is available; otherwise confirm by diffing the handler against Express Task 1 (same fields, 401 on no auth) and that `resolveAuth`/`auth.profile` match `_shared/auth.ts`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/auth/index.ts
git commit -m "feat(edge): GET /auth/me — self profile for Clerk or PIN session"
```

### Task 6: Add `GET /pin-accounts` to the pin-accounts function

**Files:**
- Modify: `supabase/functions/pin-accounts/index.ts`

- [ ] **Step 1: Update the drizzle import**

The existing import line is:
```ts
import { eq } from "npm:drizzle-orm@0.45.2";
```
Change it to:
```ts
import { eq, isNotNull, desc } from "npm:drizzle-orm@0.45.2";
```

- [ ] **Step 2: Add the route**

Add immediately before `Deno.serve(app.fetch);`:

```ts
// GET /pin-accounts — leader list of username+PIN accounts (visitors & members).
app.get("/pin-accounts", requireRole("leader"), async (c) => {
  try {
    const rows = await db
      .select({
        id: profilesTable.id,
        full_name: profilesTable.full_name,
        username: profilesTable.username,
        pin_plain: profilesTable.pin_plain,
        age: profilesTable.age,
        role: profilesTable.role,
        parent_phone: profilesTable.parent_phone,
        parent_name: profilesTable.parent_name,
      })
      .from(profilesTable)
      .where(isNotNull(profilesTable.username))
      .orderBy(desc(profilesTable.created_at));
    return c.json(rows);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});
```

- [ ] **Step 3: Verify**

`deno check supabase/functions/pin-accounts/index.ts` if available; else diff against Express Task 2 (same selected columns, `isNotNull(username)`, `desc(created_at)`).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/pin-accounts/index.ts
git commit -m "feat(edge): GET /pin-accounts — leader list of PIN accounts"
```

### Task 7: Persist optional parent fields on edge grant-membership

**Files:**
- Modify: `supabase/functions/pin-accounts/index.ts` (the `grant-membership` handler)

- [ ] **Step 1: Replace the handler body**

Find this exact block in the `app.post("/pin-accounts/:id/grant-membership", ...)` handler:
```ts
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const consentProvided = body.parental_consent === true;
    const gate = canGrantMembership(
      {
        role: target.role,
        age: target.age,
        parent_phone: target.parent_phone,
        parent_name: target.parent_name,
      },
      consentProvided,
    );
    if (!gate.ok) return c.json({ error: gate.error }, 400);

    // For 13+ no consent is required, so the audit columns are explicitly
    // nulled. Safe: the gate above only lets visitors through, so this never
    // clears an existing member's recorded consent.
    const needsConsent = target.age === null || target.age < CONSENT_AGE;
    const leaderId = c.get("leaderId") as string;
    const [updated] = await db
      .update(profilesTable)
      .set({
        role: "member",
        parental_consent_at: needsConsent ? new Date() : null,
        parental_consent_by: needsConsent ? leaderId : null,
      })
      .where(eq(profilesTable.id, target.id))
      .returning();
```
and REPLACE it with:
```ts
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const consentProvided = body.parental_consent === true;
    // Effective parent info: a non-blank value in the request overrides the
    // stored one (lets the under-13 promote dialog supply it in one call).
    const parentName =
      typeof body.parent_name === "string" && body.parent_name.trim()
        ? body.parent_name.trim()
        : target.parent_name;
    const parentPhone =
      typeof body.parent_phone === "string" && body.parent_phone.trim()
        ? body.parent_phone.trim()
        : target.parent_phone;

    const gate = canGrantMembership(
      {
        role: target.role,
        age: target.age,
        parent_phone: parentPhone,
        parent_name: parentName,
      },
      consentProvided,
    );
    if (!gate.ok) return c.json({ error: gate.error }, 400);

    // For 13+ no consent is required, so the audit columns are explicitly
    // nulled. Safe: the gate above only lets visitors through, so this never
    // clears an existing member's recorded consent.
    const needsConsent = target.age === null || target.age < CONSENT_AGE;
    const leaderId = c.get("leaderId") as string;
    const [updated] = await db
      .update(profilesTable)
      .set({
        role: "member",
        parent_name: parentName,
        parent_phone: parentPhone,
        parental_consent_at: needsConsent ? new Date() : null,
        parental_consent_by: needsConsent ? leaderId : null,
      })
      .where(eq(profilesTable.id, target.id))
      .returning();
```

- [ ] **Step 2: Verify**

`deno check supabase/functions/pin-accounts/index.ts` if available; else diff against Express Task 3 (identical effective-parent logic and the added `parent_name`/`parent_phone` in the update set).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/pin-accounts/index.ts
git commit -m "feat(edge): grant-membership persists optional parent fields (atomic under-13 promote)"
```

---

## Self-Review

**Spec coverage** (design Section 5 + the planning-discovered self endpoint):
- `GET /pin-accounts` leader list → Tasks 2, 6. ✅
- `grant-membership` optional parent fields, persisted before gate, atomic → Tasks 3, 7. ✅
- `GET /auth/me` self profile for PIN sessions (spec Section 3's `/profiles/:id` was leader-gated; this corrects it) → Tasks 1, 5. ✅
- Both backends covered (Express Phase 1, Supabase Phase 2). ✅
- No schema work (columns already exist). ✅

**Spec correction note:** design Section 3 said `/account` loads the profile via `GET /api/profiles/:id`; that route is leader-gated and won't serve a visitor/member. The frontend plan will use `GET /api/auth/me` instead (added here). This will be reflected when the frontend spec/plan is written.

**Deferred:** rate-limiting; deploying functions + applying migration + vercel.json cutover; the React UI (separate `pin-accounts-ui-frontend` plan).

**Placeholder scan:** none — every code step is complete. ✅
**Type/name consistency:** `resolveAccount`/`resolveAuth(...).profile`, `isNotNull`/`desc` imports, the `parentName`/`parentPhone` effective-value pattern, and the selected column set are identical across the Express and Supabase tasks. ✅
