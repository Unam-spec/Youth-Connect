# Configurable Check-In Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let leaders & super-admins configure weekly check-in days/times from the dashboard, enforced server-side, with a master "restrict to schedule" toggle and a leader bypass.

**Architecture:** Two new tables (`checkin_settings` single-row toggle + `checkin_windows` per-weekday rows) created/seeded idempotently in the api-server's boot-time `SCHEMA_PATCHES`. A pure function evaluates open/closed from the schedule + current SAST time (unit-tested); a thin DB-reading wrapper feeds it. New `GET` (public) / `PUT` (leader-guarded) `/api/checkin/schedule` endpoints. A new dashboard panel edits the schedule; the check-in page reads it to drive the open/closed banner.

**Tech Stack:** Express + Drizzle (node-postgres) backend, Vitest tests, React + Tailwind + shadcn/ui frontend, `date-fns-tz` for SAST.

**Spec:** `docs/superpowers/specs/2026-06-05-checkin-schedule-design.md`

---

## File structure

- `artifacts/api-server/src/lib/checkinSchedule.ts` — **new**. Pure `evaluateCheckinOpen()` + types; DB-reading `getSchedule()` and `isCheckinOpenNow()`.
- `artifacts/api-server/src/lib/checkinSchedule.test.ts` — **new**. Unit tests for the pure evaluator.
- `lib/db/src/schema/index.ts` — **modify**. Add `checkinSettingsTable`, `checkinWindowsTable`.
- `artifacts/api-server/src/db/index.ts` — **modify**. Add CREATE TABLE + seed to `SCHEMA_PATCHES`.
- `artifacts/api-server/src/routes/checkin.ts` — **modify**. Add GET/PUT `/checkin/schedule`; swap window logic + leader bypass in `POST /checkin/requests`.
- `artifacts/jg-youth/src/components/panels/CheckInSchedulePanel.tsx` — **new**. Dashboard editor.
- `artifacts/jg-youth/src/pages/dashboard.tsx` — **modify**. Render the panel in the "session" tab.
- `artifacts/jg-youth/src/pages/checkin.tsx` — **modify**. Drive the banner from the fetched schedule.

---

## Task 1: Pure window-evaluation function (TDD)

**Files:**
- Create: `artifacts/api-server/src/lib/checkinSchedule.ts`
- Test: `artifacts/api-server/src/lib/checkinSchedule.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// artifacts/api-server/src/lib/checkinSchedule.test.ts
import { describe, it, expect } from "vitest";
import { evaluateCheckinOpen, type CheckinWindow } from "./checkinSchedule";

const friday: CheckinWindow[] = [
  { day_of_week: 5, start_time: "18:30", end_time: "22:00", enabled: true },
];

describe("evaluateCheckinOpen", () => {
  it("always open when restriction is off", () => {
    expect(evaluateCheckinOpen(false, [], 2, "03:00")).toBe(true);
  });
  it("open inside an enabled window for the current weekday", () => {
    expect(evaluateCheckinOpen(true, friday, 5, "19:00")).toBe(true);
  });
  it("open exactly at start", () => {
    expect(evaluateCheckinOpen(true, friday, 5, "18:30")).toBe(true);
  });
  it("closed exactly at end (exclusive)", () => {
    expect(evaluateCheckinOpen(true, friday, 5, "22:00")).toBe(false);
  });
  it("closed before start", () => {
    expect(evaluateCheckinOpen(true, friday, 5, "18:29")).toBe(false);
  });
  it("closed on a different weekday", () => {
    expect(evaluateCheckinOpen(true, friday, 4, "19:00")).toBe(false);
  });
  it("closed when the day's window is disabled", () => {
    const disabled = [{ ...friday[0], enabled: false }];
    expect(evaluateCheckinOpen(true, disabled, 5, "19:00")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd artifacts/api-server && npx vitest run src/lib/checkinSchedule.test.ts`
Expected: FAIL — cannot find module `./checkinSchedule` / `evaluateCheckinOpen is not a function`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// artifacts/api-server/src/lib/checkinSchedule.ts
export interface CheckinWindow {
  day_of_week: number; // 0=Sun … 6=Sat (matches JS Date.getDay())
  start_time: string;  // "HH:MM" 24h SAST
  end_time: string;    // "HH:MM" 24h SAST
  enabled: boolean;
}

export interface CheckinSchedule {
  restrict_to_schedule: boolean;
  windows: CheckinWindow[];
}

/**
 * Pure open/closed decision. `nowHHMM` must be zero-padded "HH:MM".
 * Time comparison is a lexical string compare, valid for equal-length "HH:MM".
 */
export function evaluateCheckinOpen(
  restrict: boolean,
  windows: CheckinWindow[],
  dayOfWeek: number,
  nowHHMM: string,
): boolean {
  if (!restrict) return true;
  return windows.some(
    (w) =>
      w.enabled &&
      w.day_of_week === dayOfWeek &&
      nowHHMM >= w.start_time &&
      nowHHMM < w.end_time,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd artifacts/api-server && npx vitest run src/lib/checkinSchedule.test.ts`
Expected: PASS (7 passing).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/checkinSchedule.ts artifacts/api-server/src/lib/checkinSchedule.test.ts
git commit -m "feat(checkin): pure window-evaluation function with tests"
```

---

## Task 2: Drizzle tables for the schedule

**Files:**
- Modify: `lib/db/src/schema/index.ts` (add after `pendingEmailsTable`, near line 281)

- [ ] **Step 1: Add the table definitions**

Add to `lib/db/src/schema/index.ts` (the file already imports `pgTable, text, uuid, integer, boolean, timestamp`):

```ts
export const checkinSettingsTable = pgTable("checkin_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  restrict_to_schedule: boolean("restrict_to_schedule").notNull().default(true),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  updated_by: uuid("updated_by"),
});

export const checkinWindowsTable = pgTable("checkin_windows", {
  id: uuid("id").primaryKey().defaultRandom(),
  day_of_week: integer("day_of_week").notNull().unique(),
  start_time: text("start_time").notNull(),
  end_time: text("end_time").notNull(),
  enabled: boolean("enabled").notNull().default(true),
});

export type CheckinSettingsRow = typeof checkinSettingsTable.$inferSelect;
export type CheckinWindowRow = typeof checkinWindowsTable.$inferSelect;
```

(`lib/db/src/index.ts` already does `export * from "./schema"`, so these are exported as `@workspace/db` automatically — no change needed there.)

- [ ] **Step 2: Verify it compiles**

Run: `pnpm -w run typecheck:libs`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add lib/db/src/schema/index.ts
git commit -m "feat(db): add checkin_settings and checkin_windows tables"
```

---

## Task 3: Create + seed the tables on boot (SCHEMA_PATCHES)

**Files:**
- Modify: `artifacts/api-server/src/db/index.ts` (inside the `SCHEMA_PATCHES` template literal, before the closing backtick at line ~81)

- [ ] **Step 1: Add CREATE TABLE + idempotent seed**

Append to the `SCHEMA_PATCHES` string (just before the closing `` ` ``):

```sql

-- Configurable check-in schedule (added 2026-06): single-row settings + per-weekday windows.
CREATE TABLE IF NOT EXISTS "checkin_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "restrict_to_schedule" boolean NOT NULL DEFAULT true,
  "updated_at" timestamp with time zone DEFAULT now(),
  "updated_by" uuid
);

CREATE TABLE IF NOT EXISTS "checkin_windows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "day_of_week" integer NOT NULL UNIQUE,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true
);

-- Seed defaults only when empty (never overwrites leader edits).
INSERT INTO "checkin_settings" ("restrict_to_schedule")
  SELECT true WHERE NOT EXISTS (SELECT 1 FROM "checkin_settings");

INSERT INTO "checkin_windows" ("day_of_week", "start_time", "end_time", "enabled")
  SELECT 5, '18:30', '22:00', true
  WHERE NOT EXISTS (SELECT 1 FROM "checkin_windows");
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter=@workspace/api-server run build`
Expected: PASS — `dist/index.mjs` produced (the SQL is a string literal; this just confirms no syntax break).

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/db/index.ts
git commit -m "feat(checkin): create+seed schedule tables in SCHEMA_PATCHES"
```

---

## Task 4: Schedule read + isCheckinOpenNow (DB wrapper)

**Files:**
- Modify: `artifacts/api-server/src/lib/checkinSchedule.ts`

- [ ] **Step 1: Add the DB-reading helpers**

Append to `artifacts/api-server/src/lib/checkinSchedule.ts`:

```ts
import { toZonedTime } from "date-fns-tz";
import { db, checkinSettingsTable, checkinWindowsTable } from "@workspace/db";

const TZ = "Africa/Johannesburg";

/** Reads the schedule, normalizing windows to all 7 weekdays (0..6). */
export async function getSchedule(): Promise<CheckinSchedule> {
  const settings = await db.query.checkinSettingsTable.findFirst();
  const rows = await db.select().from(checkinWindowsTable);
  const byDay = new Map<number, (typeof rows)[number]>(
    rows.map((r) => [r.day_of_week, r]),
  );
  const windows: CheckinWindow[] = [];
  for (let d = 0; d < 7; d++) {
    const r = byDay.get(d);
    windows.push({
      day_of_week: d,
      start_time: r?.start_time ?? "",
      end_time: r?.end_time ?? "",
      enabled: r?.enabled ?? false,
    });
  }
  return { restrict_to_schedule: settings?.restrict_to_schedule ?? true, windows };
}

/** Current SAST { dayOfWeek, hhmm } as zero-padded "HH:MM". */
export function sastNow(now: Date = new Date()): { dayOfWeek: number; hhmm: string } {
  const z = toZonedTime(now, TZ);
  const hh = String(z.getHours()).padStart(2, "0");
  const mm = String(z.getMinutes()).padStart(2, "0");
  return { dayOfWeek: z.getDay(), hhmm: `${hh}:${mm}` };
}

/** True if a non-leader may check in right now. Fails safe to closed on error. */
export async function isCheckinOpenNow(): Promise<boolean> {
  const schedule = await getSchedule();
  const { dayOfWeek, hhmm } = sastNow();
  return evaluateCheckinOpen(
    schedule.restrict_to_schedule,
    schedule.windows.filter((w) => w.enabled && w.start_time && w.end_time),
    dayOfWeek,
    hhmm,
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter=@workspace/api-server run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/lib/checkinSchedule.ts
git commit -m "feat(checkin): schedule read + isCheckinOpenNow (SAST)"
```

---

## Task 5: GET/PUT /api/checkin/schedule endpoints

**Files:**
- Modify: `artifacts/api-server/src/routes/checkin.ts`

- [ ] **Step 1: Update imports**

At the top of `checkin.ts`, add the new table imports to the existing `@workspace/db` import and import the schedule helpers:

```ts
import {
  db,
  profilesTable,
  checkInRequestsTable,
  attendanceTable,
  visitorsTable,
  pendingEmailsTable,
  checkinSettingsTable,
  checkinWindowsTable,
  type Profile,
} from "@workspace/db";
import { getSchedule, isCheckinOpenNow, type CheckinWindow } from "../lib/checkinSchedule";
```

- [ ] **Step 2: Add the two routes**

Insert these route handlers in `checkin.ts` (e.g. directly after the `router.get("/checkin/search", ...)` block):

```ts
// GET /api/checkin/schedule - current schedule (public read)
router.get("/checkin/schedule", async (req, res) => {
  try {
    const schedule = await getSchedule();
    return res.json(schedule);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

const HHMM = /^\d{2}:\d{2}$/;

// PUT /api/checkin/schedule - update schedule (leaders & super-admins)
router.put("/checkin/schedule", requireLeaderSession("leader"), async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      restrict_to_schedule?: unknown;
      windows?: unknown;
    };
    const restrict = body.restrict_to_schedule !== false; // default true
    const rawWindows = Array.isArray(body.windows) ? body.windows : [];

    const windows: CheckinWindow[] = [];
    for (const w of rawWindows as Record<string, unknown>[]) {
      const day = Number(w.day_of_week);
      const enabled = w.enabled === true;
      const start = String(w.start_time ?? "");
      const end = String(w.end_time ?? "");
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        return res.status(400).json({ error: `Invalid day_of_week: ${w.day_of_week}` });
      }
      if (enabled) {
        if (!HHMM.test(start) || !HHMM.test(end)) {
          return res.status(400).json({ error: `Times must be "HH:MM" for day ${day}` });
        }
        if (start >= end) {
          return res.status(400).json({ error: `Start must be before end for day ${day}` });
        }
      }
      windows.push({ day_of_week: day, start_time: start, end_time: end, enabled });
    }

    await db.transaction(async (tx) => {
      // settings: update the single row, or insert if none exists yet
      const existing = await tx.query.checkinSettingsTable.findFirst();
      if (existing) {
        await tx
          .update(checkinSettingsTable)
          .set({ restrict_to_schedule: restrict, updated_at: new Date(), updated_by: req.leaderId })
          .where(eq(checkinSettingsTable.id, existing.id));
      } else {
        await tx
          .insert(checkinSettingsTable)
          .values({ restrict_to_schedule: restrict, updated_by: req.leaderId });
      }
      // windows: replace all with the submitted set
      await tx.delete(checkinWindowsTable);
      const toInsert = windows.filter((w) => HHMM.test(w.start_time) && HHMM.test(w.end_time));
      if (toInsert.length > 0) {
        await tx.insert(checkinWindowsTable).values(
          toInsert.map((w) => ({
            day_of_week: w.day_of_week,
            start_time: w.start_time,
            end_time: w.end_time,
            enabled: w.enabled,
          })),
        );
      }
    });

    const saved = await getSchedule();
    return res.json(saved);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
```

(`eq` and `requireLeaderSession` are already imported in `checkin.ts`. `req.leaderId` is set by `requireLeaderSession`.)

- [ ] **Step 3: Verify it compiles**

Run: `pnpm --filter=@workspace/api-server run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/checkin.ts
git commit -m "feat(checkin): GET/PUT /api/checkin/schedule endpoints"
```

---

## Task 6: Enforce schedule + leader bypass in POST /checkin/requests

**Files:**
- Modify: `artifacts/api-server/src/routes/checkin.ts` (the `POST /checkin/requests` handler)

- [ ] **Step 1: Replace the window guard with profile-first + leader bypass**

In the `POST /checkin/requests` handler, replace the block that currently runs the auth check, then `if (!isCheckinWindowOpen()) { ...403... }`, then `resolveClerkProfile`, with this order (resolve profile first, then enforce only for non-leaders):

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

    // Leaders & super-admins may check in any time; everyone else is limited
    // to the configured schedule.
    const isLeader = profile.role === "leader" || profile.role === "super_admin";
    if (!isLeader && !(await isCheckinOpenNow())) {
      return res.status(403).json({
        error: "Check-in is closed right now. Please check in during the scheduled times.",
      });
    }
```

Then delete the now-unused `isCheckinWindowOpen()` function and its block. (Keep `getSastToday()` — it is still used for `session_date`.) The rest of the handler (existing-attendance/request checks, the leader/super_admin attendance insert, the member `check_in_requests` insert) is unchanged.

- [ ] **Step 2: Remove the dead helper**

Delete the `function isCheckinWindowOpen(): boolean { ... }` definition (no longer referenced).

- [ ] **Step 3: Verify it compiles**

Run: `pnpm --filter=@workspace/api-server run build`
Expected: PASS — no "isCheckinWindowOpen is not defined" or unused-var errors.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/checkin.ts
git commit -m "feat(checkin): enforce schedule server-side with leader bypass"
```

---

## Task 7: Dashboard schedule editor panel

**Files:**
- Create: `artifacts/jg-youth/src/components/panels/CheckInSchedulePanel.tsx`
- Modify: `artifacts/jg-youth/src/pages/dashboard.tsx`

- [ ] **Step 1: Create the panel**

```tsx
// artifacts/jg-youth/src/components/panels/CheckInSchedulePanel.tsx
import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useApiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { DashCard, SectionTitle } from "./shared";

interface Window {
  day_of_week: number;
  start_time: string;
  end_time: string;
  enabled: boolean;
}

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function CheckInSchedulePanel() {
  const apiFetch = useApiFetch();
  const { toast } = useToast();
  const [restrict, setRestrict] = useState(true);
  const [windows, setWindows] = useState<Window[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/checkin/schedule");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setRestrict(data.restrict_to_schedule !== false);
            setWindows(
              (data.windows ?? []).map((w: Window) => ({
                ...w,
                start_time: w.start_time || "18:30",
                end_time: w.end_time || "22:00",
              })),
            );
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function updateDay(day: number, patch: Partial<Window>) {
    setWindows((prev) => prev.map((w) => (w.day_of_week === day ? { ...w, ...patch } : w)));
  }

  async function handleSave() {
    for (const w of windows) {
      if (w.enabled && w.start_time >= w.end_time) {
        toast({
          title: "Invalid times",
          description: `${DAY_LABELS[w.day_of_week]}: start must be before end.`,
          variant: "destructive",
        });
        return;
      }
    }
    setSaving(true);
    try {
      const res = await apiFetch("/api/checkin/schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restrict_to_schedule: restrict, windows }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({ title: "Save failed", description: data.error ?? "Please try again.", variant: "destructive" });
        return;
      }
      toast({ title: "Schedule saved", description: "Check-in times updated." });
    } catch {
      toast({ title: "Save failed", description: "Network error.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashCard>
      <SectionTitle title="Check-In Schedule" icon={<Clock className="h-4 w-4 text-primary" />} />
      {loading ? (
        <p className="text-sm text-muted-foreground py-4">Loading…</p>
      ) : (
        <div className="space-y-4">
          <label className="flex items-center gap-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={restrict}
              onChange={(e) => setRestrict(e.target.checked)}
              className="h-4 w-4"
            />
            Restrict check-in to scheduled times
            <span className="text-xs text-muted-foreground">(off = always open)</span>
          </label>

          <div className={`space-y-2 ${restrict ? "" : "opacity-50 pointer-events-none"}`}>
            {windows.map((w) => (
              <div key={w.day_of_week} className="flex items-center gap-3 text-sm">
                <label className="flex items-center gap-2 w-32">
                  <input
                    type="checkbox"
                    checked={w.enabled}
                    onChange={(e) => updateDay(w.day_of_week, { enabled: e.target.checked })}
                    className="h-4 w-4"
                  />
                  {DAY_LABELS[w.day_of_week]}
                </label>
                <input
                  type="time"
                  value={w.start_time}
                  disabled={!w.enabled}
                  onChange={(e) => updateDay(w.day_of_week, { start_time: e.target.value })}
                  className="h-9 rounded-md border border-input bg-background px-2 disabled:opacity-50"
                />
                <span className="text-muted-foreground">to</span>
                <input
                  type="time"
                  value={w.end_time}
                  disabled={!w.enabled}
                  onChange={(e) => updateDay(w.day_of_week, { end_time: e.target.value })}
                  className="h-9 rounded-md border border-input bg-background px-2 disabled:opacity-50"
                />
              </div>
            ))}
          </div>

          <Button onClick={handleSave} disabled={saving} className="rounded-xl">
            {saving ? "Saving…" : "Save Schedule"}
          </Button>
        </div>
      )}
    </DashCard>
  );
}
```

- [ ] **Step 2: Render it in the dashboard "session" tab**

In `artifacts/jg-youth/src/pages/dashboard.tsx`:

1. Add the import alongside the other panel imports (near line 94):
```tsx
import { CheckInSchedulePanel } from "@/components/panels/CheckInSchedulePanel";
```
2. Inside `<TabsContent value="session" ...>` (around line 1127), add the panel after the `AttendancePanel` block:
```tsx
            <CheckInSchedulePanel />
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm --filter=@workspace/jg-youth run build`
Expected: PASS (Vite build succeeds).

- [ ] **Step 4: Commit**

```bash
git add artifacts/jg-youth/src/components/panels/CheckInSchedulePanel.tsx artifacts/jg-youth/src/pages/dashboard.tsx
git commit -m "feat(checkin): dashboard schedule editor panel"
```

---

## Task 8: Drive the check-in page banner from the schedule

**Files:**
- Modify: `artifacts/jg-youth/src/pages/checkin.tsx`

- [ ] **Step 1: Fetch the schedule and compute window state from it**

In `checkin.tsx`, replace the hardcoded `getCheckinWindowState()` (which assumes Friday 18:30–22:00) with schedule-driven logic:

1. Add state + fetch inside the `CheckIn` component (near the other `useState`/`useEffect` hooks):
```tsx
  const [schedule, setSchedule] = useState<{
    restrict_to_schedule: boolean;
    windows: { day_of_week: number; start_time: string; end_time: string; enabled: boolean }[];
  } | null>(null);

  useEffect(() => {
    fetch("/api/checkin/schedule")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSchedule(d))
      .catch(() => setSchedule(null));
  }, []);
```

2. Replace the body of `getCheckinWindowState()` so it uses the fetched schedule (keep the same `WindowState` return type `"before" | "open" | "after" | "wrong_day"`):
```tsx
  function getCheckinWindowState(): WindowState {
    // No schedule loaded yet, or restriction off → treat as open.
    if (!schedule || schedule.restrict_to_schedule === false) return "open";
    const { dayOfWeek, hours, minutes } = getSastTime();
    const nowMins = hours * 60 + minutes;
    const today = schedule.windows.find(
      (w) => w.day_of_week === dayOfWeek && w.enabled && w.start_time && w.end_time,
    );
    if (!today) return "wrong_day";
    const [sh, sm] = today.start_time.split(":").map(Number);
    const [eh, em] = today.end_time.split(":").map(Number);
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    if (nowMins < start) return "before";
    if (nowMins >= end) return "after";
    return "open";
  }
```

`getCheckinWindowState` is called during render, so it re-evaluates when `schedule` state updates. `getSastTime()` already exists and is unchanged. Leaders/super-admins keep `canBypassWindow` (form shown regardless).

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter=@workspace/jg-youth run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/jg-youth/src/pages/checkin.tsx
git commit -m "feat(checkin): drive check-in page banner from configured schedule"
```

---

## Task 9: Full verification

- [ ] **Step 1: Run the api-server unit tests**

Run: `cd artifacts/api-server && npx vitest run`
Expected: PASS, including `checkinSchedule.test.ts`.

- [ ] **Step 2: Typecheck + build both packages**

Run: `pnpm -w run typecheck:libs && pnpm --filter=@workspace/api-server run build && pnpm --filter=@workspace/jg-youth run build`
Expected: all PASS.

- [ ] **Step 3: Push and verify in deployment**

```bash
git push origin main
```
After Railway + Vercel redeploy, verify against the live app:
- `GET https://youth-connect-production.up.railway.app/api/checkin/schedule` → returns `restrict_to_schedule` + 7 windows, Friday enabled 18:30–22:00 (the seed).
- Dashboard → "session" tab → **Check-In Schedule** panel loads; toggle a day / change a time / Save → toast success; re-fetch shows the change.
- Member self check-in respects the schedule (open inside an enabled window, 403 outside); a leader/super-admin can check in any time.

---

## Notes for the implementer

- **Times are SAST** (`Africa/Johannesburg`) everywhere; do not introduce a timezone option.
- **String time compare** (`"HH:MM"`) only works because values are zero-padded and equal-length — keep that invariant (the PUT validation enforces `^\d{2}:\d{2}$`, and `sastNow()` zero-pads).
- **End is exclusive** (`now < end`): a window of 18:30–22:00 is closed exactly at 22:00. The frontend uses the same `>= end` rule.
- The check-in page's `GET /api/checkin/schedule` is unauthenticated by design (just hours); the **PUT** is leader-guarded and the backend re-validates everything the panel sends.
- `db.query.checkinSettingsTable` / `db.query.checkinWindowsTable` work because the tables are registered in the `lib/db` schema (Task 2) that `@workspace/db`'s `db` is created with.
