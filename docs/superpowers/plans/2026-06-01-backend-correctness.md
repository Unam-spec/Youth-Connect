# Backend Correctness & Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Youth-Connect backend correct and consistent — one hardened session-validation path, a dedicated members-directory endpoint, a fixed session-QR route, cascading profile deletes, and phone uniqueness — without regressions.

**Architecture:** Introduce a single `validateLeaderSession()` helper that strictly validates PIN sessions (`profile_id` + `session_token` matched against the DB + expiry). Both `requireLeaderSession` middleware and `resolveAuth()` call it, and every route that previously parsed `x-leader-session` inline is routed through it. Add focused endpoints/helpers (`members-directory`, `deleteProfileCascade`, phone normalization) and reconcile Drizzle schema with the live DB.

**Tech Stack:** Express 5, Drizzle ORM, Postgres (Supabase), Clerk, TypeScript (ESM), Vitest (added here).

**Spec:** `docs/superpowers/specs/2026-06-01-backend-correctness-design.md`
**Branch:** `backend-correctness` (already checked out; spec committed there).

## Conventions for the implementer

- Run builds with: `pnpm --filter=@workspace/api-server run build` and types with `pnpm -w run typecheck:libs`.
- Run unit tests with: `pnpm --filter=@workspace/api-server test`.
- **Never** use `any`. **Never** silently swallow errors.
- Do NOT run database migrations yourself — Task 11 is performed by the human controller via the Supabase tool because it touches the live DB. Implement the code for it, then stop and hand back.
- The live DB enum `qr_code_type` already contains `session`; the Drizzle schema does not. We sync the schema to the DB (no enum migration needed).

## File map

- Create: `artifacts/api-server/vitest.config.ts` — test runner config.
- Create: `artifacts/api-server/src/lib/validateLeaderSession.ts` — shared PIN-session validator.
- Create: `artifacts/api-server/src/lib/validateLeaderSession.test.ts` — unit tests.
- Create: `artifacts/api-server/src/lib/phone.ts` — `normalizePhone()` helper.
- Create: `artifacts/api-server/src/lib/phone.test.ts` — unit tests.
- Create: `artifacts/api-server/src/lib/membersDirectoryQuery.ts` — query-param parser.
- Create: `artifacts/api-server/src/lib/membersDirectoryQuery.test.ts` — unit tests.
- Create: `artifacts/api-server/src/lib/deleteProfileCascade.ts` — cascading delete.
- Modify: `artifacts/api-server/src/lib/permissions.ts` — harden `resolveAuth`.
- Modify: `artifacts/api-server/src/middlewares/requireLeaderSession.ts` — use shared validator.
- Modify: `artifacts/api-server/src/routes/qrcodes.ts` — guard + remove dup route.
- Modify: `artifacts/api-server/src/routes/admin.ts` — guard via middleware.
- Modify: `artifacts/api-server/src/routes/messages.ts` — harden PIN branch.
- Modify: `artifacts/api-server/src/routes/profiles.ts` — avatar auth, members-directory, phone checks, cascade.
- Modify: `artifacts/api-server/src/routes/leaders.ts` — cascade in account delete.
- Modify: `lib/db/src/schema/index.ts` — enum sync + phone unique index.
- Modify: `artifacts/api-server/package.json` — add vitest + test script.

---

### Task 1: Add the Vitest test harness

**Files:**
- Modify: `artifacts/api-server/package.json`
- Create: `artifacts/api-server/vitest.config.ts`
- Create: `artifacts/api-server/src/lib/smoke.test.ts` (temporary sanity test, deleted in Step 5)

- [ ] **Step 1: Add vitest devDependency and test script**

In `artifacts/api-server/package.json`, add to `"scripts"`:
```json
    "test": "vitest run"
```
and add to `"devDependencies"`:
```json
    "vitest": "^3.2.4"
```

- [ ] **Step 2: Install**

Run: `pnpm install --no-frozen-lockfile`
Expected: completes, vitest added.

- [ ] **Step 3: Create vitest config**

Create `artifacts/api-server/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Add a temporary smoke test**

Create `artifacts/api-server/src/lib/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run, then delete the smoke test**

Run: `pnpm --filter=@workspace/api-server test`
Expected: 1 passed. Then delete `artifacts/api-server/src/lib/smoke.test.ts`.

- [ ] **Step 6: Commit**
```bash
git add artifacts/api-server/package.json artifacts/api-server/vitest.config.ts pnpm-lock.yaml
git commit -m "chore(api): add vitest test harness"
```

---

### Task 2: `validateLeaderSession()` helper + unit tests

**Files:**
- Create: `artifacts/api-server/src/lib/validateLeaderSession.ts`
- Create: `artifacts/api-server/src/lib/validateLeaderSession.test.ts`

This is the single source of truth for PIN-session validation: parse header → require
`profile_id` + `session_token` + unexpired `expires_at` → load profile → confirm
`profile.session_token === session_token`.

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/validateLeaderSession.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
vi.mock("@workspace/db", () => ({
  db: { query: { profilesTable: { findFirst: (...a: unknown[]) => findFirst(...a) } } },
  profilesTable: {},
}));
vi.mock("drizzle-orm", () => ({ eq: (..._a: unknown[]) => ({}) }));

import { validateLeaderSession } from "./validateLeaderSession";

const future = Date.now() + 60_000;

beforeEach(() => findFirst.mockReset());

describe("validateLeaderSession", () => {
  it("returns null for non-string header", async () => {
    expect(await validateLeaderSession(undefined)).toBeNull();
  });

  it("returns null for malformed JSON", async () => {
    expect(await validateLeaderSession("not json")).toBeNull();
  });

  it("returns null when required fields missing", async () => {
    expect(await validateLeaderSession(JSON.stringify({ profile_id: "p1" }))).toBeNull();
  });

  it("returns null when expired", async () => {
    const h = JSON.stringify({ profile_id: "p1", session_token: "t", expires_at: Date.now() - 1 });
    expect(await validateLeaderSession(h)).toBeNull();
  });

  it("returns null when token does not match DB", async () => {
    findFirst.mockResolvedValue({ id: "p1", session_token: "OTHER" });
    const h = JSON.stringify({ profile_id: "p1", session_token: "t", expires_at: future });
    expect(await validateLeaderSession(h)).toBeNull();
  });

  it("returns the profile on a valid session", async () => {
    findFirst.mockResolvedValue({ id: "p1", session_token: "t", role: "leader" });
    const h = JSON.stringify({ profile_id: "p1", session_token: "t", expires_at: future });
    const result = await validateLeaderSession(h);
    expect(result).toMatchObject({ id: "p1", role: "leader" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter=@workspace/api-server test`
Expected: FAIL — cannot find module `./validateLeaderSession`.

- [ ] **Step 3: Implement the helper**

Create `artifacts/api-server/src/lib/validateLeaderSession.ts`:
```ts
import { db, profilesTable, type Profile } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Validates a PIN leader session from the x-leader-session header.
 * Returns the backing profile if the session is well-formed, unexpired, and its
 * session_token matches the one stored on the profile row; otherwise null.
 */
export async function validateLeaderSession(header: unknown): Promise<Profile | null> {
  if (typeof header !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(header);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const { profile_id, session_token, expires_at } = parsed as Record<string, unknown>;
  if (typeof profile_id !== "string" || typeof session_token !== "string") return null;

  const exp =
    typeof expires_at === "number"
      ? expires_at
      : typeof expires_at === "string"
        ? Date.parse(expires_at)
        : NaN;
  if (!Number.isFinite(exp) || Date.now() >= exp) return null;

  const profile = await db.query.profilesTable.findFirst({
    where: eq(profilesTable.id, profile_id),
  });
  if (!profile || !profile.session_token || profile.session_token !== session_token) {
    return null;
  }
  return profile;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter=@workspace/api-server test`
Expected: all `validateLeaderSession` tests pass.

- [ ] **Step 5: Commit**
```bash
git add artifacts/api-server/src/lib/validateLeaderSession.ts artifacts/api-server/src/lib/validateLeaderSession.test.ts
git commit -m "feat(api): add shared validateLeaderSession helper"
```

---

### Task 3: Route `requireLeaderSession` and `resolveAuth` through the shared validator

**Files:**
- Modify: `artifacts/api-server/src/middlewares/requireLeaderSession.ts`
- Modify: `artifacts/api-server/src/lib/permissions.ts`

- [ ] **Step 1: Refactor the middleware's PIN branch**

In `artifacts/api-server/src/middlewares/requireLeaderSession.ts`, replace the entire
PIN-session block (the `if (!profile) { const sessionHeader = ... }` section, currently
lines ~29–61) with a call to the shared validator. The new block:
```ts
      // 2. If no Clerk profile, try PIN-based session (x-leader-session)
      if (!profile) {
        profile = await validateLeaderSession(req.headers["x-leader-session"]);
      }
```
Add the import at the top:
```ts
import { validateLeaderSession } from "../lib/validateLeaderSession";
```
Leave the role-hierarchy check (steps 3–5) and `req.leaderId`/`req.leaderRole` assignment
unchanged.

- [ ] **Step 2: Harden `resolveAuth`'s PIN branch**

In `artifacts/api-server/src/lib/permissions.ts`, replace the PIN/leader-session block
(currently lines ~47–67, the `const header = req.headers["x-leader-session"]; if (header) {...}`)
with profile-derived flags from the validated session:
```ts
  // ── PIN / leader session header (validated against the DB) ───────────────────
  const sessionProfile = await validateLeaderSession(req.headers["x-leader-session"]);
  if (sessionProfile) {
    const isPrivileged =
      sessionProfile.role === "super_admin" || sessionProfile.role === "leader";
    return {
      type: "leader_session",
      userId: null,
      profileId: sessionProfile.id,
      role: sessionProfile.role as ResolvedAuth["role"],
      canCreateEvents: isPrivileged || sessionProfile.can_create_events,
      canViewKpis: isPrivileged || sessionProfile.can_view_kpis,
      canViewMembers: isPrivileged || sessionProfile.can_view_members,
      canViewAttendance: isPrivileged || sessionProfile.can_view_attendance,
    };
  }

  return null;
```
Add the import at the top:
```ts
import { validateLeaderSession } from "./validateLeaderSession";
```

- [ ] **Step 3: Build and typecheck**

Run: `pnpm -w run typecheck:libs && pnpm --filter=@workspace/api-server run build`
Expected: success, no type errors.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter=@workspace/api-server test`
Expected: existing tests still pass.

- [ ] **Step 5: Commit**
```bash
git add artifacts/api-server/src/middlewares/requireLeaderSession.ts artifacts/api-server/src/lib/permissions.ts
git commit -m "refactor(api): route requireLeaderSession and resolveAuth through validateLeaderSession (hardens resolveAuth)"
```

---

### Task 4: Fix the session-QR route and sync the enum (bug #10)

**Files:**
- Modify: `lib/db/src/schema/index.ts`
- Modify: `artifacts/api-server/src/routes/qrcodes.ts`

- [ ] **Step 1: Sync the Drizzle enum to the live DB**

In `lib/db/src/schema/index.ts`, change:
```ts
export const qrCodeTypeEnum = pgEnum("qr_code_type", ["public", "leader"]);
```
to:
```ts
export const qrCodeTypeEnum = pgEnum("qr_code_type", ["public", "leader", "session"]);
```

- [ ] **Step 2: Remove the duplicate route and guard the survivor**

In `artifacts/api-server/src/routes/qrcodes.ts`:
1. Delete the **second** `router.post("/qrcodes/session", ...)` handler entirely (currently
   lines ~159–203 — the one that deactivates/inserts `type: "leader"`).
2. On the **first** `router.post("/qrcodes/session", ...)` (line ~63), add the middleware
   guard and drop the inline auth. Change the signature to:
   ```ts
   router.post("/qrcodes/session", requireLeaderSession("leader"), async (req, res) => {
   ```
   and delete the inline auth block inside it (the `const auth = getAuth(req); const leaderSessionHeader = ...; let isAuthorized = ...; if (!isAuthorized) return 401;` lines). Keep the deactivate + insert + `return res.json({ slug: newQr.slug, type: newQr.type });`.
3. Because the enum now includes `"session"`, change `type: "session" as any` to
   `type: "session"` and `eq(qrCodesTable.type, "session" as any)` to
   `eq(qrCodesTable.type, "session")`. Update the `getActiveQr` param type
   `type: "public" | "leader" | "session"` (already includes session) and remove its
   `type as any` cast → `eq(qrCodesTable.type, type)`.
4. Add the import at the top:
   ```ts
   import { requireLeaderSession } from "../middlewares/requireLeaderSession";
   ```
5. For `router.get("/qrcodes/leader", ...)` and `router.post("/qrcodes/regenerate", ...)`,
   replace their inline `const auth = getAuth(req); if (!auth?.userId) return 401;` with the
   `requireLeaderSession("leader")` guard in the route signature, and remove the now-unused
   `getAuth` import if nothing else uses it.

- [ ] **Step 3: Build and typecheck**

Run: `pnpm -w run typecheck:libs && pnpm --filter=@workspace/api-server run build`
Expected: success. (Confirms only one `/qrcodes/session` and no `any` casts remain.)

- [ ] **Step 4: Grep to confirm the duplicate is gone**

Run: `grep -c "qrcodes/session" artifacts/api-server/src/routes/qrcodes.ts`
Expected: `1`.

- [ ] **Step 5: Commit**
```bash
git add lib/db/src/schema/index.ts artifacts/api-server/src/routes/qrcodes.ts
git commit -m "fix(api): remove duplicate session-QR route, guard via middleware, sync qr_code_type enum"
```

---

### Task 5: Guard `admin.ts /reset-data` via middleware

**Files:**
- Modify: `artifacts/api-server/src/routes/admin.ts`

- [ ] **Step 1: Replace inline auth with the middleware**

In `artifacts/api-server/src/routes/admin.ts`:
1. Delete the `hasLeaderSession` helper (lines ~18–27) and the inline auth block at the top
   of the `/reset-data` handler (the `const auth = getAuth(req); const isLeaderSess = ...;`
   through the `if (!requesterProfile || requesterProfile.role !== "super_admin")` checks).
2. Change the route signature to:
   ```ts
   router.post("/reset-data", requireLeaderSession("super_admin"), async (req: Request, res: Response) => {
   ```
3. Add the import:
   ```ts
   import { requireLeaderSession } from "../middlewares/requireLeaderSession";
   ```
4. Remove the now-unused `getAuth` import if unused.
5. Type the transaction callback without `any`: change `await db.transaction(async (tx: any) => {`
   to use the inferred tx type:
   ```ts
   await db.transaction(async (tx) => {
   ```
   and change `nonSuperAdmins.map((p: any) => p.id)` to `nonSuperAdmins.map((p) => p.id)`.

- [ ] **Step 2: Build and typecheck**

Run: `pnpm -w run typecheck:libs && pnpm --filter=@workspace/api-server run build`
Expected: success with no `any`-related type errors. (If `tx` inference fails, import the
type: `import type { ExtractTablesWithRelations } from "drizzle-orm";` is NOT needed —
prefer letting Drizzle infer the callback param; only if the build fails, type it as
`Parameters<Parameters<typeof db.transaction>[0]>[0]`.)

- [ ] **Step 3: Commit**
```bash
git add artifacts/api-server/src/routes/admin.ts
git commit -m "refactor(api): guard /reset-data via requireLeaderSession, drop inline auth"
```

---

### Task 6: Harden `messages.ts` PIN validation (fixes role-trust escalation)

**Files:**
- Modify: `artifacts/api-server/src/routes/messages.ts`

The two middlewares inject `sender_*` into `req.body`, so they stay — but their PIN branch
must validate `session_token` and read the role from the DB (today `resolveSuperAdmin`
trusts the client-supplied `s.role`).

- [ ] **Step 1: Rewrite the PIN branch of `resolveLeaderOrSuperAdmin`**

In `artifacts/api-server/src/routes/messages.ts`, replace the PIN block in
`resolveLeaderOrSuperAdmin` (currently lines ~45–59, `const h = req.headers["x-leader-session"]; if (h) {...}`)
with:
```ts
    const sessionProfile = await validateLeaderSession(req.headers["x-leader-session"]);
    if (sessionProfile && ["leader", "super_admin"].includes(sessionProfile.role)) {
      req.body.sender_id = sessionProfile.id;
      req.body.sender_role = sessionProfile.role;
      req.body.sender_name = sessionProfile.full_name;
      return next();
    }
```

- [ ] **Step 2: Rewrite the PIN branch of `resolveSuperAdmin`**

Replace its PIN block (currently lines ~92–100) with:
```ts
    const sessionProfile = await validateLeaderSession(req.headers["x-leader-session"]);
    if (sessionProfile && sessionProfile.role === "super_admin") {
      return next();
    }
```

- [ ] **Step 3: Add the import**

At the top of `messages.ts`:
```ts
import { validateLeaderSession } from "../lib/validateLeaderSession";
```

- [ ] **Step 4: Build and typecheck**

Run: `pnpm -w run typecheck:libs && pnpm --filter=@workspace/api-server run build`
Expected: success.

- [ ] **Step 5: Commit**
```bash
git add artifacts/api-server/src/routes/messages.ts
git commit -m "fix(api): validate session_token and DB role in messages auth (closes role-trust escalation)"
```

---

### Task 7: Route the avatar-upload auth through `resolveAuth`

**Files:**
- Modify: `artifacts/api-server/src/routes/profiles.ts`

- [ ] **Step 1: Replace the inline session parsing in avatar upload**

In `artifacts/api-server/src/routes/profiles.ts`, in `POST /profiles/avatar/upload`
(currently lines ~623–651), replace the two-step auth (Clerk lookup + inline
`x-leader-session` JSON parse) with:
```ts
    const auth = await resolveAuth(req);
    const profileId = auth?.profileId ?? null;

    if (!profileId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
```
Remove the now-unused local `let profileId` two-block logic.

- [ ] **Step 2: Add the import**

At the top of `profiles.ts`:
```ts
import { resolveAuth } from "../lib/permissions";
```

- [ ] **Step 3: Build and typecheck**

Run: `pnpm -w run typecheck:libs && pnpm --filter=@workspace/api-server run build`
Expected: success.

- [ ] **Step 4: Commit**
```bash
git add artifacts/api-server/src/routes/profiles.ts
git commit -m "refactor(api): use resolveAuth for avatar upload, drop inline session parse"
```

---

### Task 8: `GET /profiles/members-directory` + query-parser unit tests

**Files:**
- Create: `artifacts/api-server/src/lib/membersDirectoryQuery.ts`
- Create: `artifacts/api-server/src/lib/membersDirectoryQuery.test.ts`
- Modify: `artifacts/api-server/src/routes/profiles.ts`

- [ ] **Step 1: Write the failing parser test**

Create `artifacts/api-server/src/lib/membersDirectoryQuery.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseMembersDirectoryQuery } from "./membersDirectoryQuery";

describe("parseMembersDirectoryQuery", () => {
  it("defaults page=1 limit=50 with no params", () => {
    expect(parseMembersDirectoryQuery({})).toEqual({
      search: undefined, role: undefined, page: 1, limit: 50, offset: 0,
    });
  });

  it("clamps limit to 100 and page to >=1", () => {
    const r = parseMembersDirectoryQuery({ limit: "500", page: "0" });
    expect(r.limit).toBe(100);
    expect(r.page).toBe(1);
  });

  it("computes offset from page and limit", () => {
    const r = parseMembersDirectoryQuery({ page: "3", limit: "20" });
    expect(r.offset).toBe(40);
  });

  it("accepts a valid role and ignores an invalid one", () => {
    expect(parseMembersDirectoryQuery({ role: "leader" }).role).toBe("leader");
    expect(parseMembersDirectoryQuery({ role: "visitor" }).role).toBeUndefined();
    expect(parseMembersDirectoryQuery({ role: "garbage" }).role).toBeUndefined();
  });

  it("passes through a trimmed non-empty search", () => {
    expect(parseMembersDirectoryQuery({ search: "  ann " }).search).toBe("ann");
    expect(parseMembersDirectoryQuery({ search: "   " }).search).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter=@workspace/api-server test`
Expected: FAIL — cannot find `./membersDirectoryQuery`.

- [ ] **Step 3: Implement the parser**

Create `artifacts/api-server/src/lib/membersDirectoryQuery.ts`:
```ts
export type DirectoryRole = "member" | "leader" | "super_admin";

export interface MembersDirectoryQuery {
  search: string | undefined;
  role: DirectoryRole | undefined;
  page: number;
  limit: number;
  offset: number;
}

const ALLOWED_ROLES: DirectoryRole[] = ["member", "leader", "super_admin"];

export function parseMembersDirectoryQuery(
  q: Record<string, unknown>,
): MembersDirectoryQuery {
  const rawSearch = typeof q.search === "string" ? q.search.trim() : "";
  const search = rawSearch.length > 0 ? rawSearch : undefined;

  const roleStr = typeof q.role === "string" ? q.role : "";
  const role = (ALLOWED_ROLES as string[]).includes(roleStr)
    ? (roleStr as DirectoryRole)
    : undefined;

  const page = Math.max(1, parseInt(String(q.page ?? "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(q.limit ?? "50"), 10) || 50));
  const offset = (page - 1) * limit;

  return { search, role, page, limit, offset };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter=@workspace/api-server test`
Expected: parser tests pass.

- [ ] **Step 5: Add the endpoint**

In `artifacts/api-server/src/routes/profiles.ts`, add this route immediately **before**
the existing `router.get("/profiles", ...)` (so the literal path is matched before the
`/profiles/:id` patterns; `/profiles/members-directory` must not be captured by
`/profiles/:id`):
```ts
// GET /profiles/members-directory - member|leader|super_admin only (protected: leaders)
router.get(
  "/profiles/members-directory",
  requireLeaderSession("leader"),
  async (req: Request, res: Response) => {
    try {
      const { search, role, page, limit, offset } = parseMembersDirectoryQuery(req.query);

      const roleFilter = role
        ? eq(profilesTable.role, role)
        : inArray(profilesTable.role, ["member", "leader", "super_admin"]);
      const searchFilter = search
        ? or(
            ilike(profilesTable.full_name, `%${search}%`),
            ilike(profilesTable.phone, `%${search}%`),
          )
        : undefined;
      const whereClause = searchFilter ? and(roleFilter, searchFilter) : roleFilter;

      const [countResult] = await db
        .select({ value: count() })
        .from(profilesTable)
        .where(whereClause);
      const total = countResult?.value ? Number(countResult.value) : 0;

      const data = await db
        .select({
          id: profilesTable.id,
          full_name: profilesTable.full_name,
          role: profilesTable.role,
          phone: profilesTable.phone,
          email: profilesTable.email,
          school: profilesTable.school,
          parent_phone: profilesTable.parent_phone,
          parent_name: profilesTable.parent_name,
          whatsapp_opt_in: profilesTable.whatsapp_opt_in,
          avatar_url: profilesTable.avatar_url,
          created_at: profilesTable.created_at,
          can_create_events: profilesTable.can_create_events,
          can_view_kpis: profilesTable.can_view_kpis,
          can_view_members: profilesTable.can_view_members,
          can_view_attendance: profilesTable.can_view_attendance,
        })
        .from(profilesTable)
        .where(whereClause)
        .limit(limit)
        .offset(offset);

      return res.json({ data, total, page, limit });
    } catch (err) {
      req.log.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);
```
Add `inArray` to the existing `drizzle-orm` import line (it currently imports
`eq, ilike, or, and, count`), and import the parser:
```ts
import { parseMembersDirectoryQuery } from "../lib/membersDirectoryQuery";
```

- [ ] **Step 6: Build, typecheck, test**

Run: `pnpm -w run typecheck:libs && pnpm --filter=@workspace/api-server run build && pnpm --filter=@workspace/api-server test`
Expected: all succeed.

- [ ] **Step 7: Commit**
```bash
git add artifacts/api-server/src/lib/membersDirectoryQuery.ts artifacts/api-server/src/lib/membersDirectoryQuery.test.ts artifacts/api-server/src/routes/profiles.ts
git commit -m "feat(api): add GET /profiles/members-directory"
```

---

### Task 9: Phone normalization + uniqueness checks

**Files:**
- Create: `artifacts/api-server/src/lib/phone.ts`
- Create: `artifacts/api-server/src/lib/phone.test.ts`
- Modify: `artifacts/api-server/src/routes/profiles.ts`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/phone.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("lowercases and trims", () => {
    expect(normalizePhone("  +27 82 ABC  ")).toBe("+27 82 abc");
  });
  it("returns null for null/empty/whitespace", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter=@workspace/api-server test`
Expected: FAIL — cannot find `./phone`.

- [ ] **Step 3: Implement the helper**

Create `artifacts/api-server/src/lib/phone.ts`:
```ts
/**
 * Normalizes a phone string for uniqueness comparison: trims and lowercases.
 * Returns null when the value is absent or blank. Must mirror the DB index
 * predicate `lower(btrim(phone))`.
 */
export function normalizePhone(phone: unknown): string | null {
  if (typeof phone !== "string") return null;
  const trimmed = phone.trim();
  if (trimmed.length === 0) return null;
  return trimmed.toLowerCase();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter=@workspace/api-server test`
Expected: phone tests pass.

- [ ] **Step 5: Add a uniqueness guard used by the register endpoints**

In `artifacts/api-server/src/routes/profiles.ts`, add a helper near the top (after imports):
```ts
import { normalizePhone } from "../lib/phone";
import { sql, ne } from "drizzle-orm";

/**
 * Returns true if another profile already uses this phone (normalized).
 * `excludeId` lets a self-update skip its own row.
 */
async function phoneInUse(phone: unknown, excludeId?: string): Promise<boolean> {
  const norm = normalizePhone(phone);
  if (!norm) return false;
  const rows = await db
    .select({ id: profilesTable.id })
    .from(profilesTable)
    .where(
      excludeId
        ? and(sql`lower(btrim(${profilesTable.phone})) = ${norm}`, ne(profilesTable.id, excludeId))
        : sql`lower(btrim(${profilesTable.phone})) = ${norm}`,
    )
    .limit(1);
  return rows.length > 0;
}
```
(Add `sql` and `ne` to the `drizzle-orm` import if not already present.)

- [ ] **Step 6: Enforce in the three write paths**

1. In `POST /profiles/register/first-timer`, after the `parsed` success check and before
   the insert, add:
   ```ts
   if (await phoneInUse(parsed.data.phone)) {
     return res.status(409).json({ error: "This number is already registered", duplicate: true });
   }
   ```
2. In `POST /profiles/register`, after the `parsed` success check and before the insert,
   add the same block.
3. In `PATCH /profiles/me` (self-update), after loading `existing` and before the update,
   add (only when phone is being changed):
   ```ts
   if (parsed.data.phone !== undefined && (await phoneInUse(parsed.data.phone, existing.id))) {
     return res.status(409).json({ error: "This number is already registered", duplicate: true });
   }
   ```
4. In leader `PATCH /profiles/:id`, after building `updateData` and before the update, add:
   ```ts
   if (updateData.phone !== undefined && (await phoneInUse(updateData.phone, req.params.id as string))) {
     return res.status(409).json({ error: "This number is already registered", duplicate: true });
   }
   ```

- [ ] **Step 7: Build, typecheck, test**

Run: `pnpm -w run typecheck:libs && pnpm --filter=@workspace/api-server run build && pnpm --filter=@workspace/api-server test`
Expected: all succeed.

- [ ] **Step 8: Commit**
```bash
git add artifacts/api-server/src/lib/phone.ts artifacts/api-server/src/lib/phone.test.ts artifacts/api-server/src/routes/profiles.ts
git commit -m "feat(api): enforce phone uniqueness on register and profile updates"
```

---

### Task 10: Cascading profile delete helper + wire into both delete routes

**Files:**
- Create: `artifacts/api-server/src/lib/deleteProfileCascade.ts`
- Modify: `artifacts/api-server/src/routes/profiles.ts`
- Modify: `artifacts/api-server/src/routes/leaders.ts`

- [ ] **Step 1: Implement the cascade helper**

Create `artifacts/api-server/src/lib/deleteProfileCascade.ts`:
```ts
import {
  db,
  profilesTable,
  attendanceTable,
  rsvpsTable,
  membershipRequestsTable,
  checkInRequestsTable,
  leaderPermissionsTable,
  eventsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Deletes a profile and all rows that FK-reference it, inside one transaction.
 * Child rows that merely *reference* the profile via a nullable audit column
 * (reviewed_by, created_by) are nulled rather than deleted, to preserve the
 * referenced records (events, other members' requests).
 *
 * Note: chat `messages` are intentionally NOT touched — they have no FK to
 * profiles (sender_id is free text) and live on a separate connection.
 * The caller is responsible for deleting the Clerk user AFTER this resolves.
 */
export async function deleteProfileCascade(profileId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(attendanceTable).where(eq(attendanceTable.profile_id, profileId));
    await tx.delete(rsvpsTable).where(eq(rsvpsTable.profile_id, profileId));
    await tx.delete(checkInRequestsTable).where(eq(checkInRequestsTable.profile_id, profileId));
    await tx
      .update(checkInRequestsTable)
      .set({ reviewed_by: null })
      .where(eq(checkInRequestsTable.reviewed_by, profileId));
    await tx.delete(membershipRequestsTable).where(eq(membershipRequestsTable.profile_id, profileId));
    await tx
      .update(membershipRequestsTable)
      .set({ reviewed_by: null })
      .where(eq(membershipRequestsTable.reviewed_by, profileId));
    await tx.delete(leaderPermissionsTable).where(eq(leaderPermissionsTable.profile_id, profileId));
    await tx.update(eventsTable).set({ created_by: null }).where(eq(eventsTable.created_by, profileId));
    await tx.delete(profilesTable).where(eq(profilesTable.id, profileId));
  });
}
```

- [ ] **Step 2: Use it in `DELETE /profiles/:id`**

In `artifacts/api-server/src/routes/profiles.ts`, replace the body of
`DELETE /profiles/:id` so it loads the profile, calls the cascade, then deletes Clerk:
```ts
router.delete("/profiles/:id", requireLeaderSession("super_admin"), async (req: Request, res: Response) => {
  try {
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, req.params.id as string),
    });
    if (!profile) return res.status(404).json({ error: "Profile not found" });

    await deleteProfileCascade(profile.id);

    if (profile.clerk_id && process.env.CLERK_SECRET_KEY) {
      try {
        await fetch(`https://api.clerk.com/v1/users/${profile.clerk_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
        });
      } catch (clerkErr) {
        req.log.error(
          { clerkErr, orphanedClerkId: profile.clerk_id, profileId: req.params.id },
          "Failed to delete Clerk user after profile cascade",
        );
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    req.log.error(err, "Delete failed");
    return res.status(500).json({ error: "Delete failed" });
  }
});
```
Add the import:
```ts
import { deleteProfileCascade } from "../lib/deleteProfileCascade";
```

- [ ] **Step 3: Use it in `DELETE /leaders/:profileId/account`**

In `artifacts/api-server/src/routes/leaders.ts`, replace the two raw deletes
(`db.delete(leaderPermissionsTable)...` and `db.delete(profilesTable)...`, currently lines
~157–158) in `DELETE /leaders/:profileId/account` with a single call **before** or after
the Clerk delete, matching the existing order (Clerk delete is currently first). New body
of that route:
```ts
router.delete("/leaders/:profileId/account", requireLeaderSession("super_admin"), async (req, res) => {
  try {
    const target = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, req.params.profileId as string),
    });
    if (!target) return res.status(404).json({ error: "Profile not found" });

    await deleteProfileCascade(target.id);

    if (target.clerk_id && process.env.CLERK_SECRET_KEY) {
      try {
        await fetch(`https://api.clerk.com/v1/users/${target.clerk_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
        });
      } catch (clerkErr) {
        req.log.warn({ clerkErr }, "Failed to delete Clerk user — DB row already removed");
      }
    }

    return res.status(204).send();
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
```
Add the import to `leaders.ts`:
```ts
import { deleteProfileCascade } from "../lib/deleteProfileCascade";
```

- [ ] **Step 4: Build and typecheck**

Run: `pnpm -w run typecheck:libs && pnpm --filter=@workspace/api-server run build`
Expected: success. If the `tx` callback param fails to infer, type it as
`Parameters<Parameters<typeof db.transaction>[0]>[0]` (no `any`).

- [ ] **Step 5: Commit**
```bash
git add artifacts/api-server/src/lib/deleteProfileCascade.ts artifacts/api-server/src/routes/profiles.ts artifacts/api-server/src/routes/leaders.ts
git commit -m "feat(api): cascading profile delete via shared helper"
```

---

### Task 11: Apply the phone unique index migration (CONTROLLER-RUN)

**This task is executed by the human controller using the Supabase tool, not a code
subagent — it touches the live database.** The implementer should STOP here and report.

The controller will:

- [ ] **Step 1: Verify zero duplicates one more time (read-only)**
```sql
SELECT lower(btrim(phone)) AS p, count(*) FROM profiles
WHERE phone IS NOT NULL AND btrim(phone) <> ''
GROUP BY 1 HAVING count(*) > 1;
```
Expected: 0 rows. If any rows appear, STOP and resolve duplicates first.

- [ ] **Step 2: Apply the partial unique index (migration)**
```sql
CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_unique
  ON profiles (lower(btrim(phone)))
  WHERE phone IS NOT NULL AND btrim(phone) <> '';
```

- [ ] **Step 3: Verify the index exists**
```sql
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'profiles' AND indexname = 'profiles_phone_unique';
```
Expected: one row.

- [ ] **Step 4: Mirror the index in the Drizzle schema**

In `lib/db/src/schema/index.ts`, add to the `profilesTable` definition a third argument
(table extras) declaring the partial unique index, so the schema reflects the DB:
```ts
import { uniqueIndex, sql } from "drizzle-orm/pg-core"; // add uniqueIndex; sql from drizzle-orm
```
(Use `sql` from `drizzle-orm`.) Append after the columns object:
```ts
}, (table) => ({
  phoneUnique: uniqueIndex("profiles_phone_unique")
    .on(sql`lower(btrim(${table.phone}))`)
    .where(sql`${table.phone} is not null and btrim(${table.phone}) <> ''`),
}));
```
Then `pnpm -w run typecheck:libs` must pass. (If Drizzle's `uniqueIndex().on(sql...)`
expression form does not typecheck in this Drizzle version, leave a code comment above the
columns documenting the DB index by name and predicate instead, and skip the Drizzle
expression — the DB index is the source of truth. Do not block on this.)

- [ ] **Step 5: Controller cascade verification (always rolls back)**

Run as one `execute_sql` call — seeds a throwaway profile + children, runs the cascade
SQL, asserts, and raises to roll everything back:
```sql
DO $$
DECLARE pid uuid; remaining int;
BEGIN
  INSERT INTO profiles (full_name, phone, role)
    VALUES ('CASCADE_TEST_DELETE_ME', '+000cascade-test', 'member') RETURNING id INTO pid;
  INSERT INTO attendance (profile_id, session_date) VALUES (pid, CURRENT_DATE);
  INSERT INTO membership_requests (profile_id, reason) VALUES (pid, 'test');
  -- cascade
  DELETE FROM attendance WHERE profile_id = pid;
  DELETE FROM rsvps WHERE profile_id = pid;
  DELETE FROM check_in_requests WHERE profile_id = pid;
  UPDATE check_in_requests SET reviewed_by = NULL WHERE reviewed_by = pid;
  DELETE FROM membership_requests WHERE profile_id = pid;
  UPDATE membership_requests SET reviewed_by = NULL WHERE reviewed_by = pid;
  DELETE FROM leader_permissions WHERE profile_id = pid;
  UPDATE events SET created_by = NULL WHERE created_by = pid;
  DELETE FROM profiles WHERE id = pid;
  SELECT count(*) INTO remaining FROM profiles WHERE id = pid;
  RAISE EXCEPTION 'CASCADE_VERIFY remaining_profiles=% (expected 0)', remaining;
END $$;
```
Expected: the call returns an error containing `CASCADE_VERIFY remaining_profiles=0`. The
`RAISE EXCEPTION` guarantees the whole block rolls back, so nothing persists.

- [ ] **Step 6: Commit the schema mirror (if changed)**
```bash
git add lib/db/src/schema/index.ts
git commit -m "feat(db): partial unique index on normalized phone"
```

---

### Task 12: Full verification gate

No code changes. Final end-to-end check.

- [ ] **Step 1: Typecheck + both builds**

Run: `pnpm -w run typecheck:libs && pnpm --filter=@workspace/api-server run build && pnpm --filter=@workspace/jg-youth run build`
Expected: all succeed.

- [ ] **Step 2: Run the full test suite**

Run: `pnpm --filter=@workspace/api-server test`
Expected: all tests pass (validateLeaderSession, membersDirectoryQuery, phone).

- [ ] **Step 3: Confirm no inline session parsing remains**

Run: `grep -rn "x-leader-session" artifacts/api-server/src/routes artifacts/api-server/src/middlewares`
Expected: matches ONLY inside `validateLeaderSession.ts` is not in routes; routes/middlewares
should show NO direct `JSON.parse(...x-leader-session...)`. The only allowed reference is
passing `req.headers["x-leader-session"]` into `validateLeaderSession(...)`.

- [ ] **Step 4: Clean working tree check**

Run: `git status --porcelain`
Expected: only build-artifact noise under `public/`/`dist` (ignored or regenerable).
