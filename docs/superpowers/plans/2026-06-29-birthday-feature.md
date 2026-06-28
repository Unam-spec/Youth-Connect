# Happy Birthday Feature — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show members a birthday celebration on their home screen, and give leaders a dashboard widget listing today's & this-week's birthdays (display-only).

**Architecture:** Pure birthday helpers (`daysUntilBirthday`/`isBirthdayToday`/`isBirthdayThisWeek`/`ageTurning`) added to the existing age utility; a pure `selectBirthdays` bucketer; a thin leader-only `GET /api/birthdays` endpoint; a `BirthdaysPanel` widget on the leader dashboard; a dismissible birthday banner on the member home. No schema changes (Part 1 added `date_of_birth`).

**Tech Stack:** Same as Part 1 — Express + Drizzle (api-server), React + Vite + react-query (web), Vitest.

**Branch:** continue on `feature/date-of-birth-age-fix` (Part 2 builds on Part 1).

## File map

| File | Responsibility | Action |
|---|---|---|
| `artifacts/api-server/src/lib/age.ts` | + birthday helpers | Modify |
| `artifacts/api-server/src/lib/age.test.ts` | + helper tests | Modify |
| `artifacts/jg-youth/src/lib/age.ts` | mirror helpers | Modify |
| `artifacts/api-server/src/lib/birthdays.ts` | `selectBirthdays` bucketer | Create |
| `artifacts/api-server/src/lib/birthdays.test.ts` | unit tests | Create |
| `artifacts/api-server/src/routes/birthdays.ts` | `GET /birthdays` (leader) | Create |
| `artifacts/api-server/src/routes/index.ts` | register router | Modify |
| `artifacts/jg-youth/src/components/panels/BirthdaysPanel.tsx` | leader widget | Create |
| `artifacts/jg-youth/src/pages/dashboard.tsx` | mount widget (members tab) | Modify |
| `artifacts/jg-youth/src/pages/my.tsx` | member birthday banner | Modify |

---

### Task 1: Birthday helpers + tests

**Files:**
- Modify: `artifacts/api-server/src/lib/age.ts`
- Modify: `artifacts/api-server/src/lib/age.test.ts`
- Modify: `artifacts/jg-youth/src/lib/age.ts`

- [ ] **Step 1: Add failing tests**

Append to `artifacts/api-server/src/lib/age.test.ts`:

```ts
import {
  daysUntilBirthday,
  isBirthdayToday,
  isBirthdayThisWeek,
  ageTurning,
} from "./age";

describe("daysUntilBirthday", () => {
  it("is 0 on the birthday", () => {
    expect(daysUntilBirthday("2008-06-29", "2026-06-29")).toBe(0);
  });
  it("counts forward to a later-this-year birthday", () => {
    expect(daysUntilBirthday("2008-07-02", "2026-06-29")).toBe(3);
  });
  it("wraps to next year when the birthday already passed", () => {
    expect(daysUntilBirthday("2008-06-28", "2026-06-29")).toBe(364);
  });
  it("treats Feb 29 as Feb 28 in a non-leap year", () => {
    expect(daysUntilBirthday("2008-02-29", "2025-02-28")).toBe(0);
  });
  it("returns null for missing/invalid input", () => {
    expect(daysUntilBirthday(null, "2026-06-29")).toBeNull();
    expect(daysUntilBirthday("nope", "2026-06-29")).toBeNull();
  });
});

describe("isBirthdayToday / isBirthdayThisWeek", () => {
  it("isBirthdayToday true only on the day", () => {
    expect(isBirthdayToday("2008-06-29", "2026-06-29")).toBe(true);
    expect(isBirthdayToday("2008-06-30", "2026-06-29")).toBe(false);
  });
  it("isBirthdayThisWeek includes day 6 and today, excludes day 7", () => {
    expect(isBirthdayThisWeek("2008-06-29", "2026-06-29")).toBe(true); // 0
    expect(isBirthdayThisWeek("2008-07-05", "2026-06-29")).toBe(true); // 6
    expect(isBirthdayThisWeek("2008-07-06", "2026-06-29")).toBe(false); // 7
  });
});

describe("ageTurning", () => {
  it("is the current age on the birthday itself", () => {
    expect(ageTurning("2008-06-29", "2026-06-29")).toBe(18);
  });
  it("is the next age for an upcoming birthday", () => {
    expect(ageTurning("2008-07-02", "2026-06-29")).toBe(18);
  });
  it("handles a Dec->Jan year wrap", () => {
    // Born 2009-01-02; on 2026-12-31 the next birthday is 2027-01-02 → turning 18.
    expect(ageTurning("2009-01-02", "2026-12-31")).toBe(18);
  });
  it("returns null for invalid input", () => {
    expect(ageTurning(null, "2026-06-29")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/age.test.ts`
Expected: FAIL (new helpers not exported).

- [ ] **Step 3: Implement the helpers**

Append to `artifacts/api-server/src/lib/age.ts`:

```ts
const DAY_MS = 86_400_000;

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * Whole days until the next birthday occurrence (0 = today), relative to
 * `today` (SAST). Feb 29 is treated as Feb 28 in non-leap years. null for
 * missing/invalid input.
 */
export function daysUntilBirthday(
  dob: string | null | undefined,
  today: string = todaySAST(),
): number | null {
  if (!dob) return null;
  const b = DATE_RE.exec(dob.trim());
  const t = DATE_RE.exec(today);
  if (!b || !t) return null;
  const bm = +b[2], bd = +b[3];
  const ty = +t[1], tm = +t[2], td = +t[3];
  const birthdayInYear = (year: number): number => {
    const day = bm === 2 && bd === 29 && !isLeap(year) ? 28 : bd;
    return Date.UTC(year, bm - 1, day);
  };
  const todayUTC = Date.UTC(ty, tm - 1, td);
  let next = birthdayInYear(ty);
  if (next < todayUTC) next = birthdayInYear(ty + 1);
  return Math.round((next - todayUTC) / DAY_MS);
}

/** True when today is the person's birthday. */
export function isBirthdayToday(
  dob: string | null | undefined,
  today: string = todaySAST(),
): boolean {
  return daysUntilBirthday(dob, today) === 0;
}

/** True when the birthday falls within the next 7 days (today..+6). */
export function isBirthdayThisWeek(
  dob: string | null | undefined,
  today: string = todaySAST(),
): boolean {
  const d = daysUntilBirthday(dob, today);
  return d !== null && d <= 6;
}

/** Age the person reaches on their next birthday occurrence. null if invalid. */
export function ageTurning(
  dob: string | null | undefined,
  today: string = todaySAST(),
): number | null {
  const d = daysUntilBirthday(dob, today);
  if (d === null || !dob) return null;
  const b = DATE_RE.exec(dob.trim());
  const t = DATE_RE.exec(today);
  if (!b || !t) return null;
  const by = +b[1];
  const ty = +t[1], tm = +t[2], td = +t[3];
  const nextBirthday = new Date(Date.UTC(ty, tm - 1, td + d));
  return nextBirthday.getUTCFullYear() - by;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/age.test.ts`
Expected: PASS (all old + new cases).

- [ ] **Step 5: Mirror helpers into the frontend copy**

Append the **same four exported functions + `DAY_MS` + `isLeap`** (identical code) to `artifacts/jg-youth/src/lib/age.ts`.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @workspace/jg-youth run typecheck`
Expected: PASS.

```bash
git add artifacts/api-server/src/lib/age.ts artifacts/api-server/src/lib/age.test.ts artifacts/jg-youth/src/lib/age.ts
git commit -m "feat: add birthday detection helpers (today/this-week/age-turning) with tests"
```

---

### Task 2: `selectBirthdays` bucketer + tests

**Files:**
- Create: `artifacts/api-server/src/lib/birthdays.ts`
- Test: `artifacts/api-server/src/lib/birthdays.test.ts`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/birthdays.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { selectBirthdays } from "./birthdays";

const p = (id: string, full_name: string, dob: string | null) => ({
  id,
  full_name,
  avatar_url: null,
  date_of_birth: dob,
});

describe("selectBirthdays", () => {
  const today = "2026-06-29";
  const rows = [
    p("a", "Alice", "2008-06-29"), // today, turning 18
    p("b", "Bob", "2010-07-02"),   // +3, this week
    p("c", "Cara", "2010-07-05"),  // +6, this week
    p("d", "Dan", "2010-07-06"),   // +7, NOT this week
    p("e", "Eve", null),           // no dob, excluded
    p("f", "Fin", "1999-06-29"),   // today, turning 27
  ];

  it("buckets today vs this-week and excludes no-dob / out-of-range", () => {
    const out = selectBirthdays(rows, today);
    expect(out.today.map((x) => x.id)).toEqual(["a", "f"]);
    expect(out.this_week.map((x) => x.id)).toEqual(["b", "c"]);
  });

  it("computes age_turning", () => {
    const out = selectBirthdays(rows, today);
    expect(out.today.find((x) => x.id === "a")?.age_turning).toBe(18);
    expect(out.this_week.find((x) => x.id === "b")?.age_turning).toBe(16);
  });

  it("sorts today by name and this_week by days then name", () => {
    const out = selectBirthdays(rows, today);
    expect(out.today.map((x) => x.full_name)).toEqual(["Alice", "Fin"]);
    expect(out.this_week.map((x) => x.full_name)).toEqual(["Bob", "Cara"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/birthdays.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `artifacts/api-server/src/lib/birthdays.ts`:

```ts
import { daysUntilBirthday, ageTurning } from "./age";

export interface BirthdayProfile {
  id: string;
  full_name: string;
  avatar_url: string | null;
  date_of_birth: string | null;
}

export interface BirthdayEntry {
  id: string;
  full_name: string;
  avatar_url: string | null;
  date_of_birth: string;
  age_turning: number | null;
}

export interface BirthdayBuckets {
  today: BirthdayEntry[];
  this_week: BirthdayEntry[];
}

/**
 * Buckets profiles into today's and this-week's (next 1–6 days) birthdays.
 * Rows without a date_of_birth are skipped. `today` is 'YYYY-MM-DD' (SAST).
 */
export function selectBirthdays(
  profiles: BirthdayProfile[],
  today: string,
): BirthdayBuckets {
  type Ranked = BirthdayEntry & { _d: number };
  const todayList: Ranked[] = [];
  const weekList: Ranked[] = [];

  for (const pr of profiles) {
    if (!pr.date_of_birth) continue;
    const d = daysUntilBirthday(pr.date_of_birth, today);
    if (d === null) continue;
    const entry: Ranked = {
      id: pr.id,
      full_name: pr.full_name,
      avatar_url: pr.avatar_url,
      date_of_birth: pr.date_of_birth,
      age_turning: ageTurning(pr.date_of_birth, today),
      _d: d,
    };
    if (d === 0) todayList.push(entry);
    else if (d <= 6) weekList.push(entry);
  }

  const byDayThenName = (a: Ranked, b: Ranked) =>
    a._d - b._d || a.full_name.localeCompare(b.full_name);
  todayList.sort(byDayThenName);
  weekList.sort(byDayThenName);

  const strip = ({ _d, ...rest }: Ranked): BirthdayEntry => rest;
  return { today: todayList.map(strip), this_week: weekList.map(strip) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/birthdays.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/birthdays.ts artifacts/api-server/src/lib/birthdays.test.ts
git commit -m "feat(api): add selectBirthdays bucketer with tests"
```

---

### Task 3: `GET /api/birthdays` endpoint

**Files:**
- Create: `artifacts/api-server/src/routes/birthdays.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

- [ ] **Step 1: Create the route**

Create `artifacts/api-server/src/routes/birthdays.ts`:

```ts
import { Router, Request, Response } from "express";
import { isNotNull } from "drizzle-orm";
import { db, profilesTable } from "@workspace/db";
import { requireLeaderSession } from "../middlewares/requireLeaderSession";
import { todaySAST } from "../lib/age";
import { selectBirthdays } from "../lib/birthdays";

const router = Router();

// GET /birthdays — today's & this-week's birthdays across all profiles with a
// date_of_birth (leaders only). Display data for the dashboard widget.
router.get("/birthdays", requireLeaderSession("leader"), async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: profilesTable.id,
        full_name: profilesTable.full_name,
        avatar_url: profilesTable.avatar_url,
        date_of_birth: profilesTable.date_of_birth,
      })
      .from(profilesTable)
      .where(isNotNull(profilesTable.date_of_birth));

    return res.json(selectBirthdays(rows, todaySAST()));
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
```

- [ ] **Step 2: Register the router**

In `artifacts/api-server/src/routes/index.ts`, add the import near the others:

```ts
import birthdaysRouter from "./birthdays";
```

and add the mount alongside the other `router.use(...)` lines (e.g. after `router.use(dashboardRouter);`):

```ts
router.use(birthdaysRouter);
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter @workspace/api-server run typecheck`
Expected: PASS.

```bash
git add artifacts/api-server/src/routes/birthdays.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(api): add GET /api/birthdays leader endpoint"
```

---

### Task 4: Leader Birthdays widget

**Files:**
- Create: `artifacts/jg-youth/src/components/panels/BirthdaysPanel.tsx`
- Modify: `artifacts/jg-youth/src/pages/dashboard.tsx`

- [ ] **Step 1: Create the panel**

Create `artifacts/jg-youth/src/components/panels/BirthdaysPanel.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Cake } from "lucide-react";
import { useApiFetch } from "@/lib/api";
import { DashCard, SectionTitle, EmptyState } from "./shared";

interface BirthdayEntry {
  id: string;
  full_name: string;
  avatar_url: string | null;
  date_of_birth: string;
  age_turning: number | null;
}
interface BirthdayData {
  today: BirthdayEntry[];
  this_week: BirthdayEntry[];
}

function Avatar({ entry }: { entry: BirthdayEntry }) {
  const url = entry.avatar_url;
  const initials =
    entry.full_name?.split(" ").map((n) => n[0]).join("").substring(0, 2).toUpperCase() || "?";
  return (
    <div className="h-10 w-10 rounded-full overflow-hidden flex items-center justify-center shrink-0 text-sm font-bold border bg-muted text-foreground border-border">
      {url ? (
        url.startsWith("gradient:") ? (
          <div className="h-full w-full" style={{ background: url.replace("gradient:", "") }} />
        ) : (
          <img src={url} alt={entry.full_name} className="h-full w-full object-cover" />
        )
      ) : (
        initials
      )}
    </div>
  );
}

function Row({ entry }: { entry: BirthdayEntry }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
      <Avatar entry={entry} />
      <div className="min-w-0">
        <p className="font-semibold text-sm leading-tight truncate">{entry.full_name}</p>
        {entry.age_turning !== null && (
          <p className="text-xs text-muted-foreground">turning {entry.age_turning}</p>
        )}
      </div>
    </div>
  );
}

export function BirthdaysPanel() {
  const apiFetch = useApiFetch();
  const { data, isLoading, isError } = useQuery<BirthdayData>({
    queryKey: ["birthdays"],
    queryFn: async () => {
      const res = await apiFetch("/api/birthdays");
      if (!res.ok) throw new Error("Failed to load birthdays");
      return (await res.json()) as BirthdayData;
    },
  });

  const today = data?.today ?? [];
  const thisWeek = data?.this_week ?? [];

  return (
    <DashCard>
      <SectionTitle title="Birthdays" icon={<Cake className="h-4 w-4 text-primary" />} />
      {isLoading ? (
        <p className="text-sm text-muted-foreground py-2">Loading…</p>
      ) : isError ? (
        <p className="text-sm text-destructive py-2">Could not load birthdays.</p>
      ) : today.length === 0 && thisWeek.length === 0 ? (
        <EmptyState text="No birthdays this week." />
      ) : (
        <div className="space-y-5">
          {today.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">🎂 Today</p>
              <div className="space-y-2">
                {today.map((e) => <Row key={e.id} entry={e} />)}
              </div>
            </div>
          )}
          {thisWeek.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">This week</p>
              <div className="space-y-2">
                {thisWeek.map((e) => <Row key={e.id} entry={e} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </DashCard>
  );
}
```

- [ ] **Step 2: Mount it on the dashboard (members tab)**

In `artifacts/jg-youth/src/pages/dashboard.tsx`, add the import with the other panel imports:

```ts
import { BirthdaysPanel } from "@/components/panels/BirthdaysPanel";
```

Then render it at the top of the `members` tab content — change:

```tsx
          <TabsContent value="members" className="mt-0 space-y-6">
            <PinAccountsPanel />
```

to:

```tsx
          <TabsContent value="members" className="mt-0 space-y-6">
            <BirthdaysPanel />
            <PinAccountsPanel />
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter @workspace/jg-youth run typecheck`
Expected: PASS.

```bash
git add artifacts/jg-youth/src/components/panels/BirthdaysPanel.tsx artifacts/jg-youth/src/pages/dashboard.tsx
git commit -m "feat(web): leader Birthdays widget (today & this week)"
```

---

### Task 5: Member birthday banner

**Files:**
- Modify: `artifacts/jg-youth/src/pages/my.tsx`

- [ ] **Step 1: Import the helper**

`my.tsx` already imports `todaySAST` from `@/lib/age` (Part 1). Extend that import to include `isBirthdayToday`:

```ts
import { computeAge, MIN_AGE, MAX_AGE, todaySAST, isBirthdayToday } from "@/lib/age";
```

- [ ] **Step 2: Add dismiss state + derived flag**

Near the other prompt state (after `isSavingBirthday`), add:

```ts
  const birthdayKey = `bday_dismissed_${todaySAST()}`;
  const [bdayDismissed, setBdayDismissed] = useState(
    () => typeof localStorage !== "undefined" && !!localStorage.getItem(`bday_dismissed_${todaySAST()}`),
  );
```

After `profileLoaded` is computed (it already exists in this file), add:

```ts
  const showBirthdayBanner =
    profileLoaded && isBirthdayToday((profile as any).date_of_birth) && !bdayDismissed;
```

- [ ] **Step 3: Render the banner**

Inside the main content container `<div className="max-w-4xl mx-auto space-y-10 py-6 px-4">`, immediately **before** the `{showServiceBanner && (` block, add:

```tsx
        {showBirthdayBanner && (
          <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/15 via-primary/10 to-transparent p-5 flex items-center justify-between gap-3 animate-fade-in">
            <div className="flex items-center gap-3">
              <span className="text-3xl animate-bounce">🎂</span>
              <div>
                <p className="text-lg font-bold text-foreground">
                  Happy Birthday, {(profile!.full_name ?? "friend").split(" ")[0]}! 🎉
                </p>
                <p className="text-sm text-muted-foreground">Wishing you an amazing day from all of us at JG Youth.</p>
              </div>
            </div>
            <button
              onClick={() => {
                localStorage.setItem(birthdayKey, "1");
                setBdayDismissed(true);
              }}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}
```

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm --filter @workspace/jg-youth run typecheck`
Expected: PASS.

```bash
git add artifacts/jg-youth/src/pages/my.tsx
git commit -m "feat(web): member birthday celebration banner"
```

---

### Task 6: Full verification

- [ ] **Step 1: api-server tests**

Run: `pnpm --filter @workspace/api-server test`
Expected: PASS (age + birthdays + existing suites).

- [ ] **Step 2: Whole-workspace typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Build the web app**

Run: `pnpm --filter @workspace/jg-youth run build`
Expected: build succeeds.

- [ ] **Step 4: Manual smoke test** (after deploy, or locally):
  - Temporarily set a member's `date_of_birth` to today (via the leader edit dialog) → that member's home shows the "Happy Birthday" banner; Dismiss hides it for the day.
  - Leader dashboard → Members tab → **Birthdays** widget shows that member under **🎂 Today** with the right "turning N"; someone with a birthday in the next few days appears under **This week**; empty state reads "No birthdays this week." when none.

---

## Deferred follow-up

Supabase edge-function parity (non-live): a `GET /birthdays` equivalent + helper mirror can be added to the Supabase functions when that branch is next worked on. Not required for the live Render app.
```
