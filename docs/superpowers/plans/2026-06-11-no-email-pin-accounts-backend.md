# No-Email PIN Accounts — Backend (Express/Railway) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users without email self-register and log in with a **username + PIN** on the live Express API, as a `role="visitor"` account that a leader can later promote to `member` (consent-gated for under-13s), without disturbing the Clerk login or first-timer registration flows.

**Architecture:** Reuse the existing PIN/`session_token` auth path (the one leaders use), keyed on a new unique `username` column instead of phone. All new endpoints live in one focused router (`pinAccounts.ts`). Validation/consent logic lives in pure functions in `src/lib/` (unit-tested with vitest, mocking `@workspace/db`). Member-facing check-in switches from Clerk-only to Clerk-or-session resolution — additive, so existing members are unaffected.

**Tech Stack:** TypeScript, Express, Drizzle ORM (`@workspace/db`), zod (v4), bcryptjs, vitest. PostgreSQL (Supabase-hosted, shared with the edge functions).

**Scope:** This plan is the Express backend only. The Supabase edge-function mirror and the frontend UI are separate follow-up plans. This plan produces working, curl-testable API endpoints.

---

## File Structure

**Schema / migration (3 lockstep places):**
- Modify: `lib/db/src/schema/index.ts` — add columns to `profilesTable`.
- Modify: `supabase/functions/_shared/schema.ts` — mirror the same columns (so the edge-function plan inherits them; this plan keeps them in sync).
- Create: `lib/db/drizzle/0011_add_pin_accounts.sql` — hand-written migration (columns + partial unique index on `lower(username)`).

**Pure helpers (TDD, unit-tested):**
- Create: `artifacts/api-server/src/lib/username.ts` + `username.test.ts`
- Create: `artifacts/api-server/src/lib/pin.ts` + `pin.test.ts`
- Create: `artifacts/api-server/src/lib/membershipConsent.ts` + `membershipConsent.test.ts`
- Create: `artifacts/api-server/src/lib/resolveAccount.ts` (Clerk-or-session resolver; mirrors `requireLeaderSession` resolution order)

**Routes:**
- Create: `artifacts/api-server/src/routes/pinAccounts.ts` — all PIN-account endpoints.
- Modify: `artifacts/api-server/src/routes/index.ts` — mount the new router (before auth-gated routers, since signup/login are public).
- Modify: `artifacts/api-server/src/routes/checkin.ts` — swap `resolveClerkProfile` → `resolveAccount` in the member self check-in path.

**Commands (run from `artifacts/api-server/`):**
- Tests: `npm test` (vitest) or a single file: `npx vitest run src/lib/username.test.ts`
- Typecheck: `npm run typecheck`

---

## Phase 1 — Schema & migration

### Task 1: Add PIN-account columns to the Drizzle schema

**Files:**
- Modify: `lib/db/src/schema/index.ts:57-84` (the `profilesTable` definition)

- [ ] **Step 1: Add the four columns**

In `lib/db/src/schema/index.ts`, inside the `profilesTable` definition, add these lines immediately after the `session_token: uuid("session_token"),` line (line 80):

```ts
  username: text("username"),
  pin_plain: text("pin_plain"),
  parental_consent_at: timestamp("parental_consent_at", { withTimezone: true }),
  parental_consent_by: uuid("parental_consent_by"),
```

(Uniqueness for `username` is enforced by a partial unique index in the migration, mirroring the existing `phone` pattern documented at lines 52-56 — not by `.unique()` here.)

- [ ] **Step 2: Typecheck the db package**

Run: `cd lib/db && npx tsc -p tsconfig.json --noEmit` (or the package's typecheck script)
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add lib/db/src/schema/index.ts
git commit -m "feat(db): add username/pin_plain/parental_consent columns to profiles"
```

### Task 2: Mirror the columns in the vendored edge-function schema

**Files:**
- Modify: `supabase/functions/_shared/schema.ts:50-52` (the `profilesTable` definition, after `session_token`)

- [ ] **Step 1: Add the same four columns**

In `supabase/functions/_shared/schema.ts`, inside `profilesTable`, add immediately after the `session_token: uuid("session_token"),` line:

```ts
  username: text("username"),
  pin_plain: text("pin_plain"),
  parental_consent_at: timestamp("parental_consent_at", { withTimezone: true }),
  parental_consent_by: uuid("parental_consent_by"),
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/schema.ts
git commit -m "feat(db): mirror PIN-account columns in vendored edge-function schema"
```

### Task 3: Write the SQL migration

**Files:**
- Create: `lib/db/drizzle/0011_add_pin_accounts.sql`

- [ ] **Step 1: Create the migration file**

Create `lib/db/drizzle/0011_add_pin_accounts.sql` with exactly:

```sql
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "username" text;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "pin_plain" text;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "parental_consent_at" timestamp with time zone;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "parental_consent_by" uuid;

-- Case/whitespace-insensitive uniqueness for non-blank usernames (mirrors the
-- profiles_phone_unique pattern). Lets Clerk/email members keep username NULL.
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_username_unique"
  ON "profiles" (lower(btrim("username")))
  WHERE "username" IS NOT NULL AND btrim("username") <> '';
```

- [ ] **Step 2: Apply to the database**

Run (from repo root): `cd lib/db && npm run push`
Expected: drizzle reports the columns/index applied (or "No changes" if already pushed). If using direct SQL instead, run the file via `psql "$DATABASE_URL" -f drizzle/0011_add_pin_accounts.sql`.

- [ ] **Step 3: Commit**

```bash
git add lib/db/drizzle/0011_add_pin_accounts.sql
git commit -m "feat(db): migration for PIN-account columns + username unique index"
```

---

## Phase 2 — Pure helpers (TDD)

### Task 4: Username normalization & validation

**Files:**
- Create: `artifacts/api-server/src/lib/username.ts`
- Test: `artifacts/api-server/src/lib/username.test.ts`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/username.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeUsername, validateUsername } from "./username";

describe("normalizeUsername", () => {
  it("trims and lowercases", () => {
    expect(normalizeUsername("  TKemo7 ")).toBe("tkemo7");
  });
  it("returns null for blank or non-string", () => {
    expect(normalizeUsername("   ")).toBeNull();
    expect(normalizeUsername(undefined)).toBeNull();
    expect(normalizeUsername(42)).toBeNull();
  });
});

describe("validateUsername", () => {
  it("accepts valid usernames", () => {
    expect(validateUsername("tkemo_7")).toEqual({ ok: true, value: "tkemo_7" });
  });
  it("rejects too short", () => {
    expect(validateUsername("ab").ok).toBe(false);
  });
  it("rejects too long", () => {
    expect(validateUsername("a".repeat(21)).ok).toBe(false);
  });
  it("rejects illegal characters", () => {
    expect(validateUsername("tk emo").ok).toBe(false);
    expect(validateUsername("tk!emo").ok).toBe(false);
  });
  it("rejects reserved handles (normalized)", () => {
    expect(validateUsername("Admin").ok).toBe(false);
    expect(validateUsername("leader").ok).toBe(false);
    expect(validateUsername("superadmin").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd artifacts/api-server && npx vitest run src/lib/username.test.ts`
Expected: FAIL — cannot find module `./username`.

- [ ] **Step 3: Write the implementation**

Create `artifacts/api-server/src/lib/username.ts`:

```ts
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd artifacts/api-server && npx vitest run src/lib/username.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/username.ts artifacts/api-server/src/lib/username.test.ts
git commit -m "feat(api): username normalization + validation helper"
```

### Task 5: PIN validation

**Files:**
- Create: `artifacts/api-server/src/lib/pin.ts`
- Test: `artifacts/api-server/src/lib/pin.test.ts`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/pin.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validatePin } from "./pin";

describe("validatePin", () => {
  it("accepts a 4-digit PIN", () => {
    expect(validatePin("8392")).toEqual({ ok: true, value: "8392" });
  });
  it("accepts a 6-digit PIN", () => {
    expect(validatePin("839204").ok).toBe(true);
  });
  it("rejects non-digit / wrong length", () => {
    expect(validatePin("12a4").ok).toBe(false);
    expect(validatePin("123").ok).toBe(false);
    expect(validatePin("1234567").ok).toBe(false);
    expect(validatePin(1234 as unknown).ok).toBe(false);
  });
  it("rejects trivial PINs", () => {
    expect(validatePin("0000").ok).toBe(false);
    expect(validatePin("1111").ok).toBe(false);
    expect(validatePin("1234").ok).toBe(false);
    expect(validatePin("123456").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd artifacts/api-server && npx vitest run src/lib/pin.test.ts`
Expected: FAIL — cannot find module `./pin`.

- [ ] **Step 3: Write the implementation**

Create `artifacts/api-server/src/lib/pin.ts`:

```ts
const PIN_RE = /^\d{4,6}$/;
const TRIVIAL = new Set([
  "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999",
  "1234", "4321", "123456", "654321", "000000", "111111",
]);

export type PinCheck = { ok: true; value: string } | { ok: false; error: string };

/**
 * Validates a PIN: 4-6 digits, not an obvious/trivial sequence.
 * Returns the PIN string to hash on success.
 */
export function validatePin(value: unknown): PinCheck {
  if (typeof value !== "string" || !PIN_RE.test(value)) {
    return { ok: false, error: "PIN must be 4-6 digits." };
  }
  if (TRIVIAL.has(value)) {
    return { ok: false, error: "That PIN is too easy to guess. Choose another." };
  }
  return { ok: true, value };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd artifacts/api-server && npx vitest run src/lib/pin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/pin.ts artifacts/api-server/src/lib/pin.test.ts
git commit -m "feat(api): PIN validation helper"
```

### Task 6: Membership consent gate

**Files:**
- Create: `artifacts/api-server/src/lib/membershipConsent.ts`
- Test: `artifacts/api-server/src/lib/membershipConsent.test.ts`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/membershipConsent.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { canGrantMembership } from "./membershipConsent";

const base = {
  role: "visitor" as const,
  age: 15,
  parent_phone: null as string | null,
  parent_name: null as string | null,
};

describe("canGrantMembership", () => {
  it("allows a 13+ visitor without consent", () => {
    expect(canGrantMembership(base, false)).toEqual({ ok: true });
  });

  it("blocks an under-13 visitor without parent info", () => {
    const r = canGrantMembership({ ...base, age: 11 }, true);
    expect(r.ok).toBe(false);
  });

  it("blocks under-13 when consent flag is false even with parent info", () => {
    const r = canGrantMembership(
      { ...base, age: 11, parent_phone: "0712345678", parent_name: "Mom" },
      false,
    );
    expect(r.ok).toBe(false);
  });

  it("allows under-13 with parent info + consent", () => {
    const r = canGrantMembership(
      { ...base, age: 11, parent_phone: "0712345678", parent_name: "Mom" },
      true,
    );
    expect(r).toEqual({ ok: true });
  });

  it("treats null age as under-13 (requires consent)", () => {
    const r = canGrantMembership({ ...base, age: null }, false);
    expect(r.ok).toBe(false);
  });

  it("rejects promoting a non-visitor", () => {
    const r = canGrantMembership({ ...base, role: "member" as unknown as "visitor" }, false);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd artifacts/api-server && npx vitest run src/lib/membershipConsent.test.ts`
Expected: FAIL — cannot find module `./membershipConsent`.

- [ ] **Step 3: Write the implementation**

Create `artifacts/api-server/src/lib/membershipConsent.ts`:

```ts
export interface ConsentSubject {
  role: string;
  age: number | null;
  parent_phone: string | null;
  parent_name: string | null;
}

export type ConsentResult = { ok: true } | { ok: false; error: string };

const CONSENT_AGE = 13; // under 13 requires parental consent (COPPA line)

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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd artifacts/api-server && npx vitest run src/lib/membershipConsent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/membershipConsent.ts artifacts/api-server/src/lib/membershipConsent.test.ts
git commit -m "feat(api): parental-consent gate for visitor->member promotion"
```

### Task 7: Clerk-or-session account resolver

**Files:**
- Create: `artifacts/api-server/src/lib/resolveAccount.ts`

This has no separate unit test (it is thin glue over `getAuth` + `validateLeaderSession`, both already tested/used); it is exercised by the check-in change in Task 12 and manual verification.

- [ ] **Step 1: Write the implementation**

Create `artifacts/api-server/src/lib/resolveAccount.ts`:

```ts
import type { Request } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, profilesTable, type Profile } from "@workspace/db";
import { validateLeaderSession } from "./validateLeaderSession";

/**
 * Resolves the calling account from EITHER a Clerk JWT or a PIN session
 * (x-leader-session header) — same resolution order as requireLeaderSession,
 * but with no role gate. Returns the profile, or null if neither is valid.
 * Used by member-facing endpoints that must accept username+PIN accounts as
 * well as Clerk/email members.
 */
export async function resolveAccount(req: Request): Promise<Profile | null> {
  try {
    const clerkAuth = getAuth(req);
    if (clerkAuth?.userId) {
      const profile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.clerk_id, clerkAuth.userId),
      });
      if (profile) return profile;
    }
  } catch (err) {
    req.log.warn({ err }, "Clerk auth failed in resolveAccount");
  }
  return await validateLeaderSession(req.headers["x-leader-session"]);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd artifacts/api-server && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/lib/resolveAccount.ts
git commit -m "feat(api): resolveAccount — Clerk-or-PIN-session resolver (no role gate)"
```

---

## Phase 3 — PIN-account router

### Task 8: Signup + login endpoints

**Files:**
- Create: `artifacts/api-server/src/routes/pinAccounts.ts`

- [ ] **Step 1: Create the router with signup + login**

Create `artifacts/api-server/src/routes/pinAccounts.ts`:

```ts
import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { eq, sql } from "drizzle-orm";
import { db, profilesTable } from "@workspace/db";
import { validateUsername } from "../lib/username";
import { validatePin } from "../lib/pin";

const router = Router();

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
async function findByUsername(normalized: string) {
  return db.query.profilesTable.findFirst({
    where: sql`lower(btrim(${profilesTable.username})) = ${normalized}`,
  });
}

// POST /auth/pin-signup — public. Creates a visitor account and auto-logs-in.
router.post("/auth/pin-signup", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
    if (!fullName) return res.status(400).json({ error: "full_name is required" });

    const uname = validateUsername(body.username);
    if (!uname.ok) return res.status(400).json({ error: uname.error });

    const pin = validatePin(body.pin);
    if (!pin.ok) return res.status(400).json({ error: pin.error });

    const ageRaw = body.age;
    const age =
      ageRaw === undefined || ageRaw === null || ageRaw === ""
        ? null
        : parseInt(String(ageRaw), 10);
    if (age !== null && (Number.isNaN(age) || age < 1 || age > 120)) {
      return res.status(400).json({ error: "age must be a valid number between 1 and 120" });
    }

    const existing = await findByUsername(uname.value);
    if (existing) return res.status(409).json({ error: "That username is already taken." });

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
    } catch (e) {
      // Unique-index race: another signup took the username between check and insert.
      return res.status(409).json({ error: "That username is already taken." });
    }

    return res.status(201).json(sessionPayload(inserted.id, sessionToken));
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /auth/pin-login — public. Username + PIN -> session.
router.post("/auth/pin-login", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const normalized =
      typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!normalized || !pin) {
      return res.status(400).json({ error: "Username and PIN are required." });
    }

    const profile = await findByUsername(normalized);
    if (!profile || !profile.pin_hash) {
      return res.status(401).json({ error: "Invalid username or PIN" });
    }

    const valid = await bcrypt.compare(pin, profile.pin_hash);
    if (!valid) return res.status(401).json({ error: "Invalid username or PIN" });

    const sessionToken = crypto.randomUUID();
    await db
      .update(profilesTable)
      .set({ session_token: sessionToken })
      .where(eq(profilesTable.id, profile.id));

    return res.json({ ...sessionPayload(profile.id, sessionToken), role: profile.role });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
```

- [ ] **Step 2: Typecheck**

Run: `cd artifacts/api-server && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/routes/pinAccounts.ts
git commit -m "feat(api): /auth/pin-signup + /auth/pin-login (username+PIN accounts)"
```

### Task 9: Change-own-PIN endpoint

**Files:**
- Modify: `artifacts/api-server/src/routes/pinAccounts.ts`

- [ ] **Step 1: Add the import**

At the top of `pinAccounts.ts`, add after the existing imports:

```ts
import { resolveAccount } from "../lib/resolveAccount";
```

- [ ] **Step 2: Add the route**

In `pinAccounts.ts`, add this route immediately before `export default router;`:

```ts
// PATCH /auth/pin — authenticated account changes its own PIN.
router.patch("/auth/pin", async (req, res) => {
  try {
    const profile = await resolveAccount(req);
    if (!profile) return res.status(401).json({ error: "Unauthorized" });

    const pin = validatePin((req.body ?? {}).pin);
    if (!pin.ok) return res.status(400).json({ error: pin.error });

    const pinHash = await bcrypt.hash(pin.value, 12);
    await db
      .update(profilesTable)
      .set({ pin_hash: pinHash, pin_plain: pin.value })
      .where(eq(profilesTable.id, profile.id));

    return res.json({ success: true });
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
git commit -m "feat(api): PATCH /auth/pin — self-service PIN change"
```

### Task 10: Leader promote-to-member endpoint (consent-gated)

**Files:**
- Modify: `artifacts/api-server/src/routes/pinAccounts.ts`

- [ ] **Step 1: Add imports**

At the top of `pinAccounts.ts`, add:

```ts
import { requireLeaderSession } from "../middlewares/requireLeaderSession";
import { canGrantMembership } from "../lib/membershipConsent";
```

- [ ] **Step 2: Add the route**

In `pinAccounts.ts`, add immediately before `export default router;`:

```ts
// POST /pin-accounts/:id/grant-membership — leader promotes a visitor to member.
// Server-enforces the parental-consent gate for under-13s.
router.post(
  "/pin-accounts/:id/grant-membership",
  requireLeaderSession("leader"),
  async (req, res) => {
    try {
      const target = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.id, req.params.id as string),
      });
      if (!target) return res.status(404).json({ error: "Account not found" });

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

      const needsConsent = target.age === null || target.age < 13;
      const [updated] = await db
        .update(profilesTable)
        .set({
          role: "member",
          parental_consent_at: needsConsent ? new Date() : null,
          parental_consent_by: needsConsent ? req.leaderId : null,
        })
        .where(eq(profilesTable.id, target.id))
        .returning();

      return res.json({ success: true, profile: updated });
    } catch (err) {
      req.log.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);
```

- [ ] **Step 3: Typecheck**

Run: `cd artifacts/api-server && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/pinAccounts.ts
git commit -m "feat(api): leader grant-membership endpoint with consent gate"
```

### Task 11: Leader reset-PIN endpoint (kid accounts, keeps pin_plain)

**Files:**
- Modify: `artifacts/api-server/src/routes/pinAccounts.ts`

- [ ] **Step 1: Add the route**

In `pinAccounts.ts`, add immediately before `export default router;`:

```ts
// POST /pin-accounts/:id/reset-pin — leader resets a kid's PIN to a provided
// or generated value, returned once so the leader can hand it over. Stores
// pin_plain so the dashboard shows the current PIN (product decision).
router.post(
  "/pin-accounts/:id/reset-pin",
  requireLeaderSession("leader"),
  async (req, res) => {
    try {
      const target = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.id, req.params.id as string),
      });
      if (!target) return res.status(404).json({ error: "Account not found" });

      const provided = (req.body ?? {}).pin;
      let newPin: string;
      if (provided !== undefined) {
        const check = validatePin(provided);
        if (!check.ok) return res.status(400).json({ error: check.error });
        newPin = check.value;
      } else {
        // Generate a non-trivial 4-digit PIN.
        do {
          newPin = String(crypto.randomInt(1000, 10000));
        } while (!validatePin(newPin).ok);
      }

      const pinHash = await bcrypt.hash(newPin, 12);
      await db
        .update(profilesTable)
        .set({ pin_hash: pinHash, pin_plain: newPin, session_token: null })
        .where(eq(profilesTable.id, target.id));

      return res.json({ success: true, pin: newPin });
    } catch (err) {
      req.log.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);
```

- [ ] **Step 2: Typecheck**

Run: `cd artifacts/api-server && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/routes/pinAccounts.ts
git commit -m "feat(api): leader reset-pin for kid accounts (retains pin_plain)"
```

---

## Phase 4 — Wire-up & auth integration

### Task 12: Mount the router

**Files:**
- Modify: `artifacts/api-server/src/routes/index.ts:13-30`

- [ ] **Step 1: Import and mount before auth-gated routers**

In `artifacts/api-server/src/routes/index.ts`, add the import alongside the others (after the `registerRouter` import line):

```ts
import pinAccountsRouter from "./pinAccounts";
```

Then mount it immediately after the `router.use(registerRouter);` line (both are public-entry routers and must precede auth-gated ones):

```ts
router.use(pinAccountsRouter);
```

- [ ] **Step 2: Typecheck**

Run: `cd artifacts/api-server && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/routes/index.ts
git commit -m "feat(api): mount pinAccounts router"
```

### Task 13: Let PIN accounts check in (Clerk-or-session)

**Files:**
- Modify: `artifacts/api-server/src/routes/checkin.ts` (the `POST /checkin/requests` handler, around lines 147-171, and the `resolveClerkProfile` usage)

Context: today the handler calls `resolveClerkProfile(req)` (Clerk only) and rejects when there's no Clerk `userId`. We switch to `resolveAccount` so a username+PIN session also works. The leader auto-approve branch and the schedule gate are unchanged.

- [ ] **Step 1: Add the import**

At the top of `artifacts/api-server/src/routes/checkin.ts`, add after the existing imports:

```ts
import { resolveAccount } from "../lib/resolveAccount";
```

- [ ] **Step 2: Replace the auth+profile resolution block**

In the `POST /checkin/requests` handler, replace this existing block:

```ts
    const clerkAuth = getAuth(req);
    if (!clerkAuth?.userId) {
      return res
        .status(401)
        .json({ error: "Unauthorized. Please sign in to check in." });
    }

    const profile = await resolveClerkProfile(req);
    if (!profile) {
      return res.status(404).json({
        error: "Profile not found. Please complete your registration first.",
      });
    }
```

with:

```ts
    const profile = await resolveAccount(req);
    if (!profile) {
      return res
        .status(401)
        .json({ error: "Unauthorized. Please sign in to check in." });
    }
```

- [ ] **Step 3: Typecheck**

Run: `cd artifacts/api-server && npm run typecheck`
Expected: PASS. If `resolveClerkProfile` or `getAuth` is now unused and the build flags it, leave `resolveClerkProfile` in place only if still referenced elsewhere in the file; otherwise remove the now-dead `resolveClerkProfile` function and its `getAuth` import in the same commit.

- [ ] **Step 4: Run the full lib test suite (regression)**

Run: `cd artifacts/api-server && npm test`
Expected: PASS — all existing + new lib tests green.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/checkin.ts
git commit -m "feat(api): accept Clerk OR PIN-session accounts for self check-in"
```

### Task 14: Manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Build & start the server**

Run: `cd artifacts/api-server && npm run dev`
Expected: server starts without errors.

- [ ] **Step 2: Sign up a kid**

Run:
```bash
curl -sS -X POST localhost:3000/auth/pin-signup \
  -H 'content-type: application/json' \
  -d '{"full_name":"Test Kid","username":"testkid7","pin":"8392","age":11}'
```
Expected: HTTP 201, JSON with `success: true`, `profile_id`, `session_token`, `expires_at`. (Adjust port/base path to your local config.)

- [ ] **Step 3: Duplicate username rejected**

Re-run the same curl. Expected: HTTP 409 `{"error":"That username is already taken."}`.

- [ ] **Step 4: Login**

Run:
```bash
curl -sS -X POST localhost:3000/auth/pin-login \
  -H 'content-type: application/json' \
  -d '{"username":"TestKid7","pin":"8392"}'
```
Expected: HTTP 200 with a fresh `session_token` and `role: "visitor"` (note the case-insensitive username match).

- [ ] **Step 5: Self check-in with the session**

Using the `session_token` + `profile_id` + `expires_at` from Step 4, build the header value and call:
```bash
curl -sS -X POST localhost:3000/checkin/requests \
  -H 'content-type: application/json' \
  -H 'x-leader-session: {"profile_id":"<ID>","session_token":"<TOKEN>","expires_at":<EXP>}' \
  -d '{}'
```
Expected: HTTP 201 pending check-in (visitor-role → goes to the pending-approval path), assuming check-in is open or you test during a window. A closed-schedule 403 also proves the auth resolved (it got past the 401).

- [ ] **Step 6: Consent gate blocks under-13 promotion**

As a leader (use a leader `x-leader-session` or Clerk token), call:
```bash
curl -sS -X POST localhost:3000/pin-accounts/<KID_ID>/grant-membership \
  -H 'content-type: application/json' \
  -H 'x-leader-session: <LEADER_SESSION_JSON>' \
  -d '{"parental_consent":true}'
```
Expected: HTTP 400 — parent name/phone required (the kid has none yet). This confirms the server-side gate.

- [ ] **Step 7: Record results**

Confirm Steps 2-6 behaved as expected. If any differ, stop and debug before considering the plan complete.

---

## Self-Review

**Spec coverage:**
- Username+PIN identifier → Tasks 1,3,4,8. ✅
- Visitor self-signup, immediate login → Task 8. ✅
- Leader promotion + under-13 consent gate (age<13, parent_phone+parent_name+consent, audit columns) → Tasks 1,6,10. ✅
- Kid changes own PIN → Task 9. ✅
- Leaders see PIN (`pin_plain`) + reset → Tasks 1,8,9,11 (pin_plain written on signup/change/reset). ✅
- Auth additive (Clerk OR session) → Tasks 7,13. ✅
- First-timer `register` + Clerk login untouched → no edits to `register.ts`; check-in change is additive; regression run Task 13 Step 4. ✅
- Schema in 3 lockstep places → Tasks 1,2,3. ✅
- Safety: PIN/username rules (Tasks 4,5); plaintext-PIN risk documented in spec; consent audit (Task 1). **Rate-limiting is specified in the spec but intentionally deferred** — see "Deferred" below. ⚠️

**Deferred (tracked, not in this plan):**
- **Login/signup rate-limiting & lockout.** Belongs as its own task once a rate-limit mechanism is chosen (the codebase has none today). Flagged here so it is not lost; do not mark the feature "production-complete" for minors without it.
- **Supabase edge-function mirror** of all endpoints + the `resolveAuth` check-in change — separate plan.
- **Frontend** (signup screen, PIN-login tab, leader dashboard panel showing username/pin_plain + promote/reset) — separate plan.

**Placeholder scan:** no TBD/TODO; every code step has complete code. ✅
**Type consistency:** `validateUsername`/`validatePin` return `{ok,value|error}`; `canGrantMembership(subject, consentProvided)` consistent across Tasks 6 & 10; `resolveAccount(req)` signature consistent across Tasks 7, 9, 13; route path prefix `/pin-accounts/:id/...` consistent across Tasks 10, 11 and verification. ✅
