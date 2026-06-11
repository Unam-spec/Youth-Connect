# No-Email PIN Accounts — Supabase Edge-Function Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror the username+PIN account feature (already built on the Express/Railway backend) into the Supabase Edge Functions, so the in-progress Supabase port keeps full parity.

**Architecture:** Port the Express endpoints to Deno/Hono edge functions following this repo's established porting conventions. The pure validation/consent helpers move to `supabase/functions/_shared/` (byte-identical logic to the Express `src/lib/` versions). Because routing maps the first URL path segment to a function folder, the Express `pinAccounts` router (which serves two prefixes) becomes **two function folders**: `auth` (`/auth/*`) and `pin-accounts` (`/pin-accounts/*`). Check-in switches to the existing `resolveAuth` (Clerk-or-PIN-session) resolver — additive, like the Express change.

**Tech Stack:** Deno, Hono 4, Drizzle (`npm:drizzle-orm@0.45.2`), `npm:bcryptjs@2`, Deno Web Crypto. Postgres (same DB as Express).

**Scope:** Supabase edge functions only. The Express backend is already merged. The frontend is a separate follow-up plan. The schema columns already exist in `supabase/functions/_shared/schema.ts` (added in the Express phase) and in the DB once the `0011` migration is applied — this plan does NOT touch schema or migrations.

**Key conventions (verified in-repo):**
- Each function: `import { createApp } from "../_shared/router.ts"`, define routes with the FULL path including the folder-name segment, end with `Deno.serve(app.fetch)`.
- Auth: `requireRole("leader")` middleware (sets `c.get("leaderId")`), or `resolveAuth(c.req.raw)` for no-role-gate resolution (returns `{ type, profileId, role, profile } | null`).
- Body: `await c.req.json().catch(() => ({}))`. Params: `c.req.param("id")`. Responses: `c.json(obj, status)`.
- bcrypt: `import bcrypt from "npm:bcryptjs@2"`, `bcrypt.hash(pin, 12)`, `bcrypt.compare(pin, hash)`.
- Session token: `crypto.randomUUID()` (Deno global). Random int: a local `randomInt` helper using `crypto.getRandomValues` (pattern copied from `leaders/index.ts`).
- Errors: top-level `try/catch` → `console.error(err); return c.json({ error: "Internal server error" }, 500);`.

**Verification note:** Deno is NOT installed locally. Where possible run `deno check supabase/functions/<fn>/index.ts`; if `deno` is unavailable, the implementer reports that and instead verifies by (a) careful line-by-line diff against the corresponding Express handler in `artifacts/api-server/src/routes/pinAccounts.ts` / `checkin.ts`, and (b) confirming imports resolve to existing `_shared` modules. Note the inability to run `deno check` as a concern in the report.

---

## File Structure

**Shared pure helpers (new):**
- Create: `supabase/functions/_shared/username.ts`
- Create: `supabase/functions/_shared/pin.ts`
- Create: `supabase/functions/_shared/membershipConsent.ts`

**New function folders:**
- Create: `supabase/functions/auth/index.ts` — `/auth/pin-signup`, `/auth/pin-login`, `/auth/pin`
- Create: `supabase/functions/pin-accounts/index.ts` — `/pin-accounts/:id/grant-membership`, `/pin-accounts/:id/reset-pin`

**Modified:**
- Modify: `supabase/functions/checkin/index.ts` — swap the Clerk-only auth in `POST /checkin/requests` to `resolveAuth`.

---

## Phase 1 — Shared pure helpers

### Task 1: Port the username helper

**Files:**
- Create: `supabase/functions/_shared/username.ts`

- [ ] **Step 1: Create the file**

This is byte-identical logic to `artifacts/api-server/src/lib/username.ts` (no imports, pure TS — ports cleanly to Deno). Create `supabase/functions/_shared/username.ts`:

```ts
// Mirrors artifacts/api-server/src/lib/username.ts (single source of truth).
/**
 * Normalizes a username for storage/comparison: trims + lowercases.
 * Returns null when absent or blank. Must mirror the DB index predicate
 * lower(btrim(username)).
 */
export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.toLowerCase();
}

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const RESERVED = new Set(["admin", "leader", "superadmin", "super_admin", "root", "system"]);

export type UsernameCheck = { ok: true; value: string } | { ok: false; error: string };

/**
 * Validates a candidate username. On success returns the normalized value to
 * persist. Rules: 3-20 chars, lowercase letters/digits/underscore only, not a
 * reserved handle.
 */
export function validateUsername(value: unknown): UsernameCheck {
  const normalized = normalizeUsername(value);
  if (!normalized) return { ok: false, error: "Username is required." };
  if (!USERNAME_RE.test(normalized)) {
    return {
      ok: false,
      error: "Username must be 3-20 characters: letters, numbers, or underscore.",
    };
  }
  if (RESERVED.has(normalized)) return { ok: false, error: "That username is not allowed." };
  return { ok: true, value: normalized };
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/username.ts
git commit -m "feat(edge): shared username helper (mirror of api-server)"
```

### Task 2: Port the PIN helper

**Files:**
- Create: `supabase/functions/_shared/pin.ts`

- [ ] **Step 1: Create the file**

Byte-identical to `artifacts/api-server/src/lib/pin.ts`. Create `supabase/functions/_shared/pin.ts`:

```ts
// Mirrors artifacts/api-server/src/lib/pin.ts (single source of truth).
const PIN_RE = /^\d{4,6}$/;

/** True if every digit is the same (e.g. "0000", "11111"). */
function isAllSameDigit(pin: string): boolean {
  return /^(\d)\1+$/.test(pin);
}

/** True if digits ascend or descend by 1 throughout (e.g. "1234", "54321"). */
function isSequential(pin: string): boolean {
  let asc = true;
  let desc = true;
  for (let i = 1; i < pin.length; i++) {
    const diff = pin.charCodeAt(i) - pin.charCodeAt(i - 1);
    if (diff !== 1) asc = false;
    if (diff !== -1) desc = false;
  }
  return asc || desc;
}

/** True for PINs too easy to guess, at any supported length. */
function isTrivialPin(pin: string): boolean {
  return isAllSameDigit(pin) || isSequential(pin);
}

export type PinCheck = { ok: true; value: string } | { ok: false; error: string };

/**
 * Validates a PIN: 4-6 digits, not an obvious/trivial sequence (all-same-digit
 * or ascending/descending run). Returns the PIN string to hash on success.
 */
export function validatePin(value: unknown): PinCheck {
  if (typeof value !== "string" || !PIN_RE.test(value)) {
    return { ok: false, error: "PIN must be 4-6 digits." };
  }
  if (isTrivialPin(value)) {
    return { ok: false, error: "That PIN is too easy to guess. Choose another." };
  }
  return { ok: true, value };
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/pin.ts
git commit -m "feat(edge): shared PIN helper (mirror of api-server)"
```

### Task 3: Port the membership-consent helper

**Files:**
- Create: `supabase/functions/_shared/membershipConsent.ts`

- [ ] **Step 1: Create the file**

Byte-identical to `artifacts/api-server/src/lib/membershipConsent.ts` (with `CONSENT_AGE` exported). Create `supabase/functions/_shared/membershipConsent.ts`:

```ts
// Mirrors artifacts/api-server/src/lib/membershipConsent.ts (single source of truth).
export interface ConsentSubject {
  role: string;
  age: number | null;
  parent_phone: string | null;
  parent_name: string | null;
}

export type ConsentResult = { ok: true } | { ok: false; error: string };

export const CONSENT_AGE = 13; // under 13 requires parental consent (COPPA line)

function nonBlank(v: string | null): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Decides whether a visitor may be promoted to member.
 * - Only `role === "visitor"` accounts can be promoted.
 * - age >= 13: allowed unconditionally.
 * - age < 13 or age unknown: requires parent_phone + parent_name present AND
 *   the leader explicitly confirming consent (`consentProvided`).
 */
export function canGrantMembership(
  subject: ConsentSubject,
  consentProvided: boolean,
): ConsentResult {
  if (subject.role !== "visitor") {
    return { ok: false, error: "Only visitor accounts can be promoted to member." };
  }
  const needsConsent = subject.age === null || subject.age < CONSENT_AGE;
  if (!needsConsent) return { ok: true };

  if (!nonBlank(subject.parent_phone) || !nonBlank(subject.parent_name)) {
    return {
      ok: false,
      error: "Parent name and phone are required to make an under-13 a member.",
    };
  }
  if (!consentProvided) {
    return { ok: false, error: "Parental consent must be confirmed for under-13s." };
  }
  return { ok: true };
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/membershipConsent.ts
git commit -m "feat(edge): shared membership-consent helper (mirror of api-server)"
```

---

## Phase 2 — `auth` function (signup, login, change-pin)

### Task 4: Create the auth function

**Files:**
- Create: `supabase/functions/auth/index.ts`

Context: mirrors the `/auth/*` routes of `artifacts/api-server/src/routes/pinAccounts.ts`. Hono translation: `req.body` → `await c.req.json().catch(() => ({}))`; `res.status(n).json(x)` → `c.json(x, n)`; `req.log.error` → `console.error`. `resolveAuth(c.req.raw)` replaces the Express `resolveAccount(req)` for the change-pin route and returns `{ profile } | null`.

- [ ] **Step 1: Create the file**

Create `supabase/functions/auth/index.ts`:

```ts
// Supabase Edge Function: auth
// Port of the /auth/* routes from artifacts/api-server/src/routes/pinAccounts.ts.
//   - POST /auth/pin-signup   → public (creates a visitor account, auto-logs-in)
//   - POST /auth/pin-login    → public (username + PIN → session)
//   - PATCH /auth/pin         → self (resolveAuth: Clerk or PIN session)
import { createApp } from "../_shared/router.ts";
import { db } from "../_shared/db.ts";
import { profilesTable } from "../_shared/schema.ts";
import { resolveAuth } from "../_shared/auth.ts";
import { validateUsername } from "../_shared/username.ts";
import { validatePin } from "../_shared/pin.ts";
import { eq, sql } from "npm:drizzle-orm@0.45.2";
import bcrypt from "npm:bcryptjs@2";

const app = createApp();

const SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours

function sessionPayload(profileId: string, sessionToken: string) {
  return {
    success: true,
    profile_id: profileId,
    session_token: sessionToken,
    expires_at: Date.now() + SESSION_MS,
  };
}

// Looks up a profile by normalized username via the same lower(btrim()) predicate
// as the unique index, so lookups match stored rows case-insensitively.
function findByUsername(normalized: string) {
  return db.query.profilesTable.findFirst({
    where: sql`lower(btrim(${profilesTable.username})) = ${normalized}`,
  });
}

// POST /auth/pin-signup — public. Creates a visitor account and auto-logs-in.
app.post("/auth/pin-signup", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
    if (!fullName) return c.json({ error: "full_name is required" }, 400);

    const uname = validateUsername(body.username);
    if (!uname.ok) return c.json({ error: uname.error }, 400);

    const pin = validatePin(body.pin);
    if (!pin.ok) return c.json({ error: pin.error }, 400);

    const ageRaw = body.age;
    const age =
      ageRaw === undefined || ageRaw === null || ageRaw === ""
        ? null
        : parseInt(String(ageRaw), 10);
    if (age !== null && (Number.isNaN(age) || age < 1 || age > 120)) {
      return c.json({ error: "age must be a valid number between 1 and 120" }, 400);
    }

    const existing = await findByUsername(uname.value);
    if (existing) return c.json({ error: "That username is already taken." }, 409);

    const pinHash = await bcrypt.hash(pin.value, 12);
    const sessionToken = crypto.randomUUID();

    let inserted;
    try {
      [inserted] = await db
        .insert(profilesTable)
        .values({
          full_name: fullName,
          username: uname.value,
          pin_hash: pinHash,
          pin_plain: pin.value,
          age,
          role: "visitor",
          parent_phone:
            typeof body.parent_phone === "string" && body.parent_phone.trim()
              ? body.parent_phone.trim()
              : null,
          parent_name:
            typeof body.parent_name === "string" && body.parent_name.trim()
              ? body.parent_name.trim()
              : null,
          session_token: sessionToken,
        })
        .returning();
    } catch (_e) {
      // Unique-index race: another signup took the username between check and insert.
      return c.json({ error: "That username is already taken." }, 409);
    }

    return c.json(sessionPayload(inserted.id, sessionToken), 201);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /auth/pin-login — public. Username + PIN -> session.
app.post("/auth/pin-login", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const normalized =
      typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!normalized || !pin) {
      return c.json({ error: "Username and PIN are required." }, 400);
    }
    // Fast-reject implausibly long input so bcrypt.compare never runs on it.
    if (pin.length > 8) {
      return c.json({ error: "Invalid username or PIN" }, 401);
    }

    const profile = await findByUsername(normalized);
    if (!profile || !profile.pin_hash) {
      return c.json({ error: "Invalid username or PIN" }, 401);
    }

    const valid = await bcrypt.compare(pin, profile.pin_hash);
    if (!valid) return c.json({ error: "Invalid username or PIN" }, 401);

    const sessionToken = crypto.randomUUID();
    await db
      .update(profilesTable)
      .set({ session_token: sessionToken })
      .where(eq(profilesTable.id, profile.id));

    return c.json({ ...sessionPayload(profile.id, sessionToken), role: profile.role });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// PATCH /auth/pin — authenticated account changes its own PIN.
app.patch("/auth/pin", async (c) => {
  try {
    const auth = await resolveAuth(c.req.raw);
    if (!auth) return c.json({ error: "Unauthorized" }, 401);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const pin = validatePin(body.pin);
    if (!pin.ok) return c.json({ error: pin.error }, 400);

    const pinHash = await bcrypt.hash(pin.value, 12);
    await db
      .update(profilesTable)
      .set({ pin_hash: pinHash, pin_plain: pin.value })
      .where(eq(profilesTable.id, auth.profile.id));

    return c.json({ success: true });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

Deno.serve(app.fetch);
```

- [ ] **Step 2: Verify**

Run `deno check supabase/functions/auth/index.ts` if Deno is available. If not, report that and instead diff each handler against the matching Express handler in `artifacts/api-server/src/routes/pinAccounts.ts` (signup, login, change-pin) to confirm identical status codes, fields, and branching.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/auth/index.ts
git commit -m "feat(edge): auth function — pin-signup, pin-login, change-pin"
```

---

## Phase 3 — `pin-accounts` function (grant-membership, reset-pin)

### Task 5: Create the pin-accounts function

**Files:**
- Create: `supabase/functions/pin-accounts/index.ts`

Context: mirrors the `/pin-accounts/*` leader routes of `artifacts/api-server/src/routes/pinAccounts.ts`. `requireLeaderSession("leader")` → `requireRole("leader")`; `req.leaderId` → `c.get("leaderId")`. `crypto.randomInt` does not exist in Deno — use the local `randomInt` helper (copied from `leaders/index.ts`).

- [ ] **Step 1: Create the file**

Create `supabase/functions/pin-accounts/index.ts`:

```ts
// Supabase Edge Function: pin-accounts
// Port of the /pin-accounts/* leader routes from
// artifacts/api-server/src/routes/pinAccounts.ts.
//   - POST /pin-accounts/:id/grant-membership → requireRole("leader"), consent-gated
//   - POST /pin-accounts/:id/reset-pin        → requireRole("leader")
import { createApp } from "../_shared/router.ts";
import { db } from "../_shared/db.ts";
import { profilesTable } from "../_shared/schema.ts";
import { requireRole } from "../_shared/auth.ts";
import { canGrantMembership, CONSENT_AGE } from "../_shared/membershipConsent.ts";
import { validatePin } from "../_shared/pin.ts";
import { eq } from "npm:drizzle-orm@0.45.2";
import bcrypt from "npm:bcryptjs@2";

const app = createApp();

/** Crypto-random integer in [min, max) (Deno has no node crypto.randomInt). */
function randomInt(min: number, max: number): number {
  const range = max - min;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return min + (buf[0] % range);
}

// POST /pin-accounts/:id/grant-membership — leader promotes a visitor to member.
// Server-enforces the parental-consent gate for under-13s.
app.post("/pin-accounts/:id/grant-membership", requireRole("leader"), async (c) => {
  try {
    const id = c.req.param("id");
    const target = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, id),
    });
    if (!target) return c.json({ error: "Account not found" }, 404);

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

    return c.json({ success: true, profile: updated });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /pin-accounts/:id/reset-pin — leader resets a kid's PIN to a provided
// or generated value, returned once so the leader can hand it over. Stores
// pin_plain so the dashboard shows the current PIN (product decision).
app.post("/pin-accounts/:id/reset-pin", requireRole("leader"), async (c) => {
  try {
    const id = c.req.param("id");
    const target = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, id),
    });
    if (!target) return c.json({ error: "Account not found" }, 404);
    // Scope to PIN accounts (have a username). A promoted member keeps their
    // username, so this still covers them; it just blocks setting a PIN on a
    // Clerk/email-only account that never had one.
    if (!target.username) {
      return c.json({ error: "This account has no PIN to reset." }, 400);
    }

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const provided = body.pin;
    let newPin: string;
    if (provided !== undefined) {
      const check = validatePin(provided);
      if (!check.ok) return c.json({ error: check.error }, 400);
      newPin = check.value;
    } else {
      // Generate a non-trivial 4-digit PIN.
      do {
        newPin = String(randomInt(1000, 10000));
      } while (!validatePin(newPin).ok);
    }

    const pinHash = await bcrypt.hash(newPin, 12);
    await db
      .update(profilesTable)
      .set({ pin_hash: pinHash, pin_plain: newPin, session_token: null })
      .where(eq(profilesTable.id, target.id));

    return c.json({ success: true, pin: newPin });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

Deno.serve(app.fetch);
```

- [ ] **Step 2: Verify**

Run `deno check supabase/functions/pin-accounts/index.ts` if Deno is available. Otherwise diff both handlers against the Express equivalents (grant-membership, reset-pin) — same status codes, the `needsConsent` audit logic, the username guard, and the generation loop.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/pin-accounts/index.ts
git commit -m "feat(edge): pin-accounts function — grant-membership, reset-pin"
```

---

## Phase 4 — Check-in auth integration

### Task 6: Switch check-in to resolveAuth (Clerk or PIN session)

**Files:**
- Modify: `supabase/functions/checkin/index.ts`

Context: the `POST /checkin/requests` handler currently authenticates with `getClerkUserId` + a local `resolveClerkProfile`. Switch it to `resolveAuth` so PIN-session accounts can check in too. Additive — Clerk users keep working. This mirrors the Express change exactly (404 "Profile not found" collapses into the 401).

- [ ] **Step 1: Update the auth import**

In `supabase/functions/checkin/index.ts`, the existing import is:
```ts
import { getClerkUserId, requireRole } from "../_shared/auth.ts";
```
Change it to:
```ts
import { requireRole, resolveAuth } from "../_shared/auth.ts";
```
(`getClerkUserId` is being removed — confirm in Step 3 it is not used elsewhere in the file.)

- [ ] **Step 2: Replace the auth block in `POST /checkin/requests`**

Find and REPLACE this exact block (near the top of the `app.post("/checkin/requests", ...)` handler):
```ts
    const userId = await getClerkUserId(c.req.raw);
    if (!userId) {
      return c.json(
        { error: "Unauthorized. Please sign in to check in." },
        401,
      );
    }

    const profile = await resolveClerkProfile(c.req.raw);
    if (!profile) {
      return c.json(
        {
          error:
            "Profile not found. Please complete your registration first.",
        },
        404,
      );
    }
```
with:
```ts
    const auth = await resolveAuth(c.req.raw);
    if (!auth) {
      return c.json(
        { error: "Unauthorized. Please sign in to check in." },
        401,
      );
    }
    const profile = auth.profile;
```

- [ ] **Step 3: Remove now-dead code**

After Step 2, grep `supabase/functions/checkin/index.ts` for `resolveClerkProfile` and `getClerkUserId`:
- The local `resolveClerkProfile` function (the `async function resolveClerkProfile(req: Request) { ... }` block near the top) is now unused — DELETE it.
- If `getClerkUserId` is no longer referenced anywhere in the file (it was only used inside `resolveClerkProfile` and the handler), it is already removed from the import in Step 1 — confirm no other usage remains.
- If `type Profile` was imported only for `resolveClerkProfile`'s return type and is now unused, remove it from the `../_shared/schema.ts` import.
- Do NOT change any other logic (the `isCheckinOpenNow` schedule gate + `isLeader` exemption, the 409 duplicate checks, the leader auto-approve branch, the pending-request insert must stay identical).

Update the header comment line that says `//   - POST /checkin/requests → Clerk auth (...)` to note it now accepts Clerk or PIN session.

- [ ] **Step 4: Verify**

Run `deno check supabase/functions/checkin/index.ts` if available; otherwise confirm by reading that (a) `resolveAuth` is imported and used, (b) `resolveClerkProfile`/`getClerkUserId` have no remaining references, (c) the rest of the handler is unchanged versus `git show HEAD:supabase/functions/checkin/index.ts`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/checkin/index.ts
git commit -m "feat(edge): accept Clerk OR PIN-session accounts for self check-in"
```

---

## Self-Review

**Spec coverage** (against the design doc's "Section 3 — Endpoints" for the Supabase backend):
- `/auth/pin-signup`, `/auth/pin-login`, `/auth/pin` → Task 4. ✅
- `/pin-accounts/:id/grant-membership` (consent-gated), `/pin-accounts/:id/reset-pin` → Task 5. ✅
- Check-in switches to Clerk-or-session → Task 6. ✅
- Pure helpers shared/mirrored → Tasks 1-3. ✅
- Schema columns already mirrored (Express phase) — no schema work here. ✅
- Parity with Express behavior (status codes, consent gate, username race, pin length guard, reset-pin username scope) — carried verbatim. ✅

**Deferred (tracked, not in this plan):**
- **Rate-limiting** on pin-login/pin-signup (same gap as Express; no mechanism in either backend yet).
- **Deno unit tests** for the shared helpers — the repo has no Deno test runner and the logic is identical to the already-tested Express helpers; not added to avoid introducing test infra out of scope.
- **Frontend** — separate plan.
- **Deploying** the functions (`supabase functions deploy auth pin-accounts checkin`) and **applying the `0011` migration** — human/ops steps, not done here.

**Routing assumption (verify before deploy):** This plan assumes the first URL path segment maps to the function folder of the same name (consistent with every existing function: `checkin`, `leaders`, `register`, …). The new `/auth/*` and `/pin-accounts/*` prefixes therefore require the two new folders to be deployed and routed the same way the existing functions are. If the project uses an explicit rewrite/allowlist for `/api/* → functions/v1/*`, add `auth` and `pin-accounts` entries there during deploy.

**Placeholder scan:** none — every code step has complete code. ✅
**Type/name consistency:** `sessionPayload`, `findByUsername`, `validateUsername`/`validatePin`/`canGrantMembership` signatures, `CONSENT_AGE`, and `resolveAuth(...).profile` usage are consistent across tasks and match the existing `_shared/auth.ts` exports. ✅
