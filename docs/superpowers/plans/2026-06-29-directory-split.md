# Member Directory Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the leader Member Directory into **Leaders** and **Members (+visitors)** tabs, default A–Z with Newest/Oldest sort options.

**Architecture:** A pure `resolveDirectoryListParams` helper maps `group`/`sort`/pagination query params to a role list + order; `GET /api/profiles` applies them (role `inArray` + search + `ORDER BY`). The `MemberDirectoryPanel` gains a tab toggle and a sort dropdown wired into its existing infinite-scroll query.

**Tech Stack:** Express + Drizzle (api-server), React + react-query (web), Vitest.

**Branch:** continue on `feature/date-of-birth-age-fix`.

## File map

| File | Responsibility | Action |
|---|---|---|
| `artifacts/api-server/src/lib/directoryListParams.ts` | param → roles/sort/paging | Create |
| `artifacts/api-server/src/lib/directoryListParams.test.ts` | unit tests | Create |
| `artifacts/api-server/src/routes/profiles.ts` | `GET /profiles` uses helper + orderBy | Modify |
| `artifacts/jg-youth/src/components/panels/MemberDirectoryPanel.tsx` | tabs + sort + query wiring | Modify |

---

### Task 1: `resolveDirectoryListParams` helper + tests

**Files:**
- Create: `artifacts/api-server/src/lib/directoryListParams.ts`
- Test: `artifacts/api-server/src/lib/directoryListParams.test.ts`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/directoryListParams.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveDirectoryListParams } from "./directoryListParams";

describe("resolveDirectoryListParams", () => {
  it("maps group=leaders to leader + super_admin", () => {
    expect(resolveDirectoryListParams({ group: "leaders" }).roles).toEqual([
      "leader",
      "super_admin",
    ]);
  });
  it("maps group=members to member + visitor", () => {
    expect(resolveDirectoryListParams({ group: "members" }).roles).toEqual([
      "member",
      "visitor",
    ]);
  });
  it("falls back to a single valid role param when no group", () => {
    expect(resolveDirectoryListParams({ role: "leader" }).roles).toEqual(["leader"]);
  });
  it("leaves roles undefined when neither group nor a valid role is given", () => {
    expect(resolveDirectoryListParams({}).roles).toBeUndefined();
    expect(resolveDirectoryListParams({ role: "bogus" }).roles).toBeUndefined();
  });
  it("maps sort, defaulting to name", () => {
    expect(resolveDirectoryListParams({ sort: "newest" }).sort).toBe("newest");
    expect(resolveDirectoryListParams({ sort: "oldest" }).sort).toBe("oldest");
    expect(resolveDirectoryListParams({ sort: "bogus" }).sort).toBe("name");
    expect(resolveDirectoryListParams({}).sort).toBe("name");
  });
  it("trims search to undefined when blank", () => {
    expect(resolveDirectoryListParams({ search: "  " }).search).toBeUndefined();
    expect(resolveDirectoryListParams({ search: " ann " }).search).toBe("ann");
  });
  it("computes pagination (page -> offset, clamps pageSize)", () => {
    const p = resolveDirectoryListParams({ page: "3", pageSize: "20" });
    expect(p).toMatchObject({ page: 3, pageSize: 20, offset: 40 });
    expect(resolveDirectoryListParams({ pageSize: "9999" }).pageSize).toBe(100);
    expect(resolveDirectoryListParams({ page: "0" }).page).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/directoryListParams.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `artifacts/api-server/src/lib/directoryListParams.ts`:

```ts
export type ProfileRole = "super_admin" | "leader" | "member" | "visitor";
export type DirectorySort = "name" | "newest" | "oldest";

export interface DirectoryListParams {
  roles: ProfileRole[] | undefined;
  sort: DirectorySort;
  search: string | undefined;
  page: number;
  pageSize: number;
  offset: number;
}

const ALL_ROLES: ProfileRole[] = ["super_admin", "leader", "member", "visitor"];

/**
 * Resolves the directory listing query into a role filter + sort + pagination.
 * `group` ("leaders" | "members") takes precedence over a legacy single `role`.
 */
export function resolveDirectoryListParams(
  q: Record<string, unknown>,
): DirectoryListParams {
  const rawSearch = typeof q.search === "string" ? q.search.trim() : "";
  const search = rawSearch.length > 0 ? rawSearch : undefined;

  const group = typeof q.group === "string" ? q.group : "";
  let roles: ProfileRole[] | undefined;
  if (group === "leaders") roles = ["leader", "super_admin"];
  else if (group === "members") roles = ["member", "visitor"];
  else {
    const role = typeof q.role === "string" ? q.role : "";
    roles = (ALL_ROLES as string[]).includes(role) ? [role as ProfileRole] : undefined;
  }

  const sortRaw = typeof q.sort === "string" ? q.sort : "";
  const sort: DirectorySort =
    sortRaw === "newest" ? "newest" : sortRaw === "oldest" ? "oldest" : "name";

  const page = Math.max(1, parseInt(String(q.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(q.pageSize ?? "50"), 10) || 50));
  const offset = (page - 1) * pageSize;

  return { roles, sort, search, page, pageSize, offset };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/directoryListParams.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/directoryListParams.ts artifacts/api-server/src/lib/directoryListParams.test.ts
git commit -m "feat(api): add resolveDirectoryListParams (group + sort) helper with tests"
```

---

### Task 2: `GET /api/profiles` applies group filter + sort order

**Files:**
- Modify: `artifacts/api-server/src/routes/profiles.ts`

- [ ] **Step 1: Import the helper and ordering ops**

Add to the `drizzle-orm` import (it currently imports `eq, ilike, or, and, count, inArray, sql, ne`) the `asc` and `desc` operators:

```ts
import { eq, ilike, or, and, count, inArray, sql, ne, asc, desc } from "drizzle-orm";
```

Add near the other lib imports:

```ts
import { resolveDirectoryListParams } from "../lib/directoryListParams";
```

- [ ] **Step 2: Replace the `GET /profiles` handler body**

Replace the body of `router.get("/profiles", requireLeaderSession("leader"), async (req, res) => { ... })` — from the param parsing through the `return res.json(profiles)` — with:

```ts
  try {
    const { roles, sort, search, pageSize, offset } = resolveDirectoryListParams(req.query);

    const roleFilter = roles ? inArray(profilesTable.role, roles) : undefined;
    const searchFilter = search
      ? or(
          ilike(profilesTable.full_name, `%${search}%`),
          ilike(profilesTable.phone, `%${search}%`),
        )
      : undefined;
    const whereClause =
      roleFilter && searchFilter
        ? and(roleFilter, searchFilter)
        : (roleFilter ?? searchFilter);

    const orderBy =
      sort === "newest"
        ? desc(profilesTable.created_at)
        : sort === "oldest"
          ? asc(profilesTable.created_at)
          : sql`lower(${profilesTable.full_name}) asc`;

    const profiles = await db
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
        gender: profilesTable.gender,
        age: profilesTable.age,
        date_of_birth: profilesTable.date_of_birth,
        created_at: profilesTable.created_at,
        can_create_events: profilesTable.can_create_events,
        can_view_kpis: profilesTable.can_view_kpis,
        can_view_members: profilesTable.can_view_members,
        can_view_attendance: profilesTable.can_view_attendance,
      })
      .from(profilesTable)
      .where(whereClause)
      .orderBy(orderBy)
      .limit(pageSize)
      .offset(offset);

    return res.json(profiles);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
```

(This removes the previously-computed-but-unused `total` count from this endpoint — the route returns the array as before.)

- [ ] **Step 3: Typecheck + tests**

Run: `pnpm --filter @workspace/api-server run typecheck`
Run: `pnpm --filter @workspace/api-server test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/profiles.ts
git commit -m "feat(api): GET /profiles supports group filter + name/newest/oldest sort"
```

---

### Task 3: Directory tabs + sort control (frontend)

**Files:**
- Modify: `artifacts/jg-youth/src/components/panels/MemberDirectoryPanel.tsx`

- [ ] **Step 1: Add group + sort state**

After `const [search, setSearch] = useState("");` (and the debounced value line), add:

```ts
  const [group, setGroup] = useState<"members" | "leaders">("members");
  const [sort, setSort] = useState<"name" | "newest" | "oldest">("name");
```

- [ ] **Step 2: Feed group + sort into the infinite query**

Change the `queryKey` to include them:

```ts
    queryKey: [...getListProfilesQueryKey(), "infinite", group, sort, debouncedSearch],
```

And in `queryFn`, add the params to the querystring (after the existing `page`/`pageSize` set, before the search check):

```ts
      qs.set("group", group);
      qs.set("sort", sort);
```

- [ ] **Step 3: Render the tab toggle + sort dropdown**

Immediately after the header `<div className="mb-5 flex flex-col gap-3 ...">…</div>` block (the one containing the SectionTitle and the search input) and before the `{isProfilesLoading ? (` block, insert:

```tsx
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-xl border border-border bg-card p-1">
          {([
            { key: "members", label: "Members" },
            { key: "leaders", label: "Leaders" },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setGroup(t.key)}
              className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-colors ${
                group === t.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as "name" | "newest" | "oldest")}
          className="h-9 rounded-xl border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label="Sort members"
        >
          <option value="name">Sort: A–Z</option>
          <option value="newest">Sort: Newest first</option>
          <option value="oldest">Sort: Oldest first</option>
        </select>
      </div>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @workspace/jg-youth run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/jg-youth/src/components/panels/MemberDirectoryPanel.tsx
git commit -m "feat(web): directory Leaders/Members tabs + A-Z/Newest/Oldest sort"
```

---

### Task 4: Full verification

- [ ] **Step 1: api-server tests**

Run: `pnpm --filter @workspace/api-server test`
Expected: PASS.

- [ ] **Step 2: Whole-workspace typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Build the web app**

Run: `pnpm --filter @workspace/jg-youth run build`
Expected: build succeeds.

- [ ] **Step 4: Manual smoke test** (after deploy, or locally):
  - Directory **Members** tab lists only members + visitors; **Leaders** tab lists only leaders + super-admins.
  - Sort **A–Z** orders by name; **Newest**/**Oldest** order by join date.
  - Search filters within the active tab; switching tab/sort reloads from the top.

---

## Deferred follow-up

Supabase edge-function parity (non-live): mirror the `group`/`sort` handling in the Supabase `profiles` function when that branch is next worked on. Not required for the live Render app.
```
