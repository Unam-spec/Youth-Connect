# Date of Birth & Always-Correct Ages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the frozen `age` integer with a captured date of birth and a live-computed age, fixing the "everyone is 18 / some are 0 / male" bug at its root and laying the foundation for the birthday feature (Part 2).

**Architecture:** Add a nullable `date_of_birth` column to `profiles` and `visitors` (keeping the legacy `age` column as a fallback). A small pure `computeAge`/`validateDob` utility derives age from the date. New sign-ups and profile edits capture the date; age is derived on write and computed live for display. Existing members get an optional one-time "add your birthday" prompt. No data is invented or destroyed.

**Tech Stack:** pnpm monorepo · Drizzle ORM + Postgres (shared by Render api-server and Supabase) · Express (api-server) · React + Vite + react-hook-form + Zod (web) · Vitest (api-server tests).

**Branch:** `feature/date-of-birth-age-fix` (already created; spec committed there).

---

## Root cause (confirmed)

1. `register.tsx` defaults `age: 18` and `gender: "male"`; users click past them → stored as 18/male forever.
2. The directory endpoints (`GET /profiles`, `GET /profiles/members-directory`) **do not select `age`/`gender`**, so the leader edit dialog's `profile.age ?? 18` is **always 18** and gender **always male** for everyone.
3. Direct Clerk sign-ups insert `age: 0` (`/profiles/me`) → "0".
4. A static `age` can never stay correct and cannot tell us when a birthday is.

## File map

| File | Responsibility | Action |
|---|---|---|
| `lib/db/drizzle/0016_add_date_of_birth.sql` | Migration SQL | Create |
| `lib/db/src/schema/index.ts` | Drizzle schema (source of truth) | Modify (profiles, visitors) |
| `supabase/functions/_shared/schema.ts` | Schema mirror (Deno) | Modify (profiles, visitors) |
| `artifacts/api-server/src/lib/age.ts` | `computeAge` / `validateDob` / `todaySAST` | Create |
| `artifacts/api-server/src/lib/age.test.ts` | Unit tests | Create |
| `artifacts/api-server/src/routes/register.ts` | Visitor registration backend | Modify |
| `artifacts/api-server/src/routes/profiles.ts` | Profile read/write + auto-create + directory selects | Modify |
| `artifacts/api-server/src/routes/pinAccounts.ts` | Under-13 consent caller | Modify |
| `artifacts/jg-youth/src/lib/age.ts` | Frontend `computeAge` / `todaySAST` (mirror) | Create |
| `artifacts/jg-youth/src/pages/register.tsx` | Sign-up DOB picker | Modify |
| `artifacts/jg-youth/src/components/panels/DialogManager.tsx` | Leader edit dialog: DOB + read-only age | Modify |
| `artifacts/jg-youth/src/pages/dashboard.tsx` | Edit state + save + open dialog | Modify |
| `artifacts/jg-youth/src/pages/my.tsx` | Member "add your birthday" prompt | Modify |

**Deferred (out of scope for this plan):** Supabase edge-function *body* parity for `register`/`profiles`/`pinAccounts` (non-live; lives on the separate `backend-to-supabase` effort). The shared **schema** mirror IS included (Task 1) so that branch keeps compiling. See "Deferred follow-up" at the end.

---

### Task 1: Database migration — add `date_of_birth`

**Files:**
- Create: `lib/db/drizzle/0016_add_date_of_birth.sql`
- Modify: `lib/db/src/schema/index.ts` (profilesTable ~line 73; visitorsTable ~line 195)
- Modify: `supabase/functions/_shared/schema.ts` (profilesTable ~line 34; visitorsTable ~line 124)

- [ ] **Step 1: Write the migration SQL**

Create `lib/db/drizzle/0016_add_date_of_birth.sql`:

```sql
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "date_of_birth" date;
ALTER TABLE "visitors" ADD COLUMN IF NOT EXISTS "date_of_birth" date;
```

- [ ] **Step 2: Add the column to the Drizzle schema**

In `lib/db/src/schema/index.ts`, in `profilesTable` add directly after the `age` line (`age: integer("age"),`):

```ts
  date_of_birth: date("date_of_birth"),
```

In `visitorsTable`, after `age: integer("age").notNull(),` add:

```ts
  date_of_birth: date("date_of_birth"),
```

(`date` is already imported at the top of this file.)

- [ ] **Step 3: Mirror into the Supabase shared schema**

In `supabase/functions/_shared/schema.ts`, add the same `date_of_birth: date("date_of_birth"),` line to `profilesTable` (after `age`) and `visitorsTable` (after `age`). Confirm `date` is in the `drizzle-orm/pg-core` import at the top of that file; if not, add it.

- [ ] **Step 4: Typecheck**

Run: `pnpm run typecheck:libs`
Expected: PASS (no type errors).

- [ ] **Step 5: Apply the migration to the live database** ⚠️ CHECKPOINT

This is additive and safe (adds two nullable columns, no backfill, nothing dropped). Apply the SQL from Step 1 to the production Postgres using the project's normal path — the Supabase MCP `apply_migration` (name: `add_date_of_birth`) or the Supabase SQL editor. **Pause here for human confirmation before applying to production.**

Verify after applying:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name='profiles' AND column_name='date_of_birth';
```
Expected: one row.

- [ ] **Step 6: Commit**

```bash
git add lib/db/drizzle/0016_add_date_of_birth.sql lib/db/src/schema/index.ts supabase/functions/_shared/schema.ts
git commit -m "feat(db): add date_of_birth column to profiles and visitors"
```

---

### Task 2: Age utility + tests (api-server)

**Files:**
- Create: `artifacts/api-server/src/lib/age.ts`
- Test: `artifacts/api-server/src/lib/age.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/lib/age.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeAge, validateDob, MIN_AGE, MAX_AGE } from "./age";

describe("computeAge", () => {
  it("returns null for null/empty/invalid input", () => {
    expect(computeAge(null)).toBeNull();
    expect(computeAge("")).toBeNull();
    expect(computeAge("not-a-date")).toBeNull();
  });
  it("computes age when the birthday already passed this year", () => {
    expect(computeAge("2000-01-10", "2026-06-29")).toBe(26);
  });
  it("computes age when the birthday is later this year", () => {
    expect(computeAge("2000-12-10", "2026-06-29")).toBe(25);
  });
  it("counts the birthday on the day itself", () => {
    expect(computeAge("2008-06-29", "2026-06-29")).toBe(18);
  });
  it("does not count the birthday the day before", () => {
    expect(computeAge("2008-06-30", "2026-06-29")).toBe(17);
  });
  it("handles a Feb 29 birth date in a non-leap year", () => {
    expect(computeAge("2008-02-29", "2025-02-28")).toBe(16);
    expect(computeAge("2008-02-29", "2025-03-01")).toBe(17);
  });
});

describe("validateDob", () => {
  it("accepts a valid past date and returns the derived age", () => {
    expect(validateDob("2008-06-29", "2026-06-29")).toEqual({ ok: true, age: 18 });
  });
  it("rejects a future date", () => {
    expect(validateDob("2030-01-01", "2026-06-29").ok).toBe(false);
  });
  it("rejects an impossible calendar date", () => {
    expect(validateDob("2009-02-31", "2026-06-29").ok).toBe(false);
  });
  it(`rejects ages above ${MAX_AGE}`, () => {
    expect(validateDob("1900-01-01", "2026-06-29").ok).toBe(false);
  });
  it(`rejects ages below ${MIN_AGE}`, () => {
    expect(validateDob("2024-01-01", "2026-06-29").ok).toBe(false);
  });
  it("rejects malformed input", () => {
    expect(validateDob(12345 as unknown).ok).toBe(false);
    expect(validateDob("29-06-2008").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/age.test.ts`
Expected: FAIL ("Failed to resolve import './age'" / function not defined).

- [ ] **Step 3: Implement the utility**

Create `artifacts/api-server/src/lib/age.ts`:

```ts
// Pure, dependency-free age helpers shared by the api-server.
// (A byte-identical copy lives at artifacts/jg-youth/src/lib/age.ts for the web app.)

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MIN_AGE = 5;
export const MAX_AGE = 100;

/** Today's date in South Africa (SAST, UTC+2) as 'YYYY-MM-DD'. */
export function todaySAST(now: Date = new Date()): string {
  // 'en-CA' renders as YYYY-MM-DD; timeZone pins it to SAST regardless of host TZ.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Whole-years age from a 'YYYY-MM-DD' date of birth, relative to `today`
 * (defaults to SAST today). Returns null for missing/invalid input or an
 * out-of-range result. String math avoids Date timezone pitfalls.
 */
export function computeAge(
  dob: string | null | undefined,
  today: string = todaySAST(),
): number | null {
  if (!dob) return null;
  const b = DATE_RE.exec(dob.trim());
  const t = DATE_RE.exec(today);
  if (!b || !t) return null;
  const by = +b[1], bm = +b[2], bd = +b[3];
  const ty = +t[1], tm = +t[2], td = +t[3];
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  if (age < 0 || age > 150) return null;
  return age;
}

export interface DobValidation {
  ok: boolean;
  age?: number;
  error?: string;
}

/**
 * Validates a 'YYYY-MM-DD' date of birth for registration/profile edits:
 * a real, past calendar date yielding an age within [MIN_AGE, MAX_AGE].
 */
export function validateDob(
  dob: unknown,
  today: string = todaySAST(),
): DobValidation {
  if (typeof dob !== "string" || !DATE_RE.test(dob.trim())) {
    return { ok: false, error: "Date of birth must be a valid date (YYYY-MM-DD)." };
  }
  const trimmed = dob.trim();
  const [y, m, d] = trimmed.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { ok: false, error: "Date of birth is not a real calendar date." };
  }
  if (trimmed > today) {
    return { ok: false, error: "Date of birth cannot be in the future." };
  }
  const age = computeAge(trimmed, today);
  if (age === null || age < MIN_AGE || age > MAX_AGE) {
    return { ok: false, error: `Age must be between ${MIN_AGE} and ${MAX_AGE}.` };
  }
  return { ok: true, age };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/age.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/age.ts artifacts/api-server/src/lib/age.test.ts
git commit -m "feat(api): add computeAge/validateDob age utility with tests"
```

---

### Task 3: Visitor registration backend uses date of birth

**Files:**
- Modify: `artifacts/api-server/src/routes/register.ts`

- [ ] **Step 1: Import the validator**

At the top of `register.ts`, add to the imports:

```ts
import { validateDob } from "../lib/age";
```

- [ ] **Step 2: Accept `date_of_birth` and derive age**

In the `POST /register` handler, update the destructure to include `date_of_birth`:

```ts
    const { full_name, phone_number, email, gender, age, date_of_birth, how_did_you_hear, school, parent_phone, parent_name, whatsapp_opt_in, avatar_url } =
      req.body;
```

Replace the current age block (the `if (age === undefined ...)` check and the `ageInt` coercion, roughly lines 90–107) with date-of-birth-first logic that still falls back to a raw `age` for any old client during rollout:

```ts
    // Prefer date_of_birth (new clients). Fall back to a raw age only if an
    // older cached client posts without it. One of the two is required.
    let ageInt: number;
    let dobValue: string | null = null;
    if (date_of_birth !== undefined && date_of_birth !== null && date_of_birth !== "") {
      const v = validateDob(date_of_birth);
      if (!v.ok) return res.status(400).json({ error: v.error });
      ageInt = v.age!;
      dobValue = String(date_of_birth).trim();
    } else if (age !== undefined && age !== null && age !== "") {
      ageInt = parseInt(String(age), 10);
      if (isNaN(ageInt) || ageInt < 1 || ageInt > 120) {
        return res.status(400).json({ error: "age must be a valid number between 1 and 120" });
      }
    } else {
      return res.status(400).json({ error: "date_of_birth is required" });
    }
```

- [ ] **Step 3: Store both columns on insert**

In the `db.insert(visitorsTable).values({...})` call, keep `age: ageInt,` and add directly after it:

```ts
        date_of_birth: dobValue,
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @workspace/api-server run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/register.ts
git commit -m "feat(api): accept date_of_birth on visitor registration, derive age"
```

---

### Task 4: Profiles backend — DOB write paths, directory selects, no fake defaults

**Files:**
- Modify: `artifacts/api-server/src/routes/profiles.ts`

- [ ] **Step 1: Import helpers**

Add near the top of `profiles.ts`:

```ts
import { validateDob, computeAge } from "../lib/age";
```

- [ ] **Step 2: Stop forcing `age: 0` / `gender: "other"` on Clerk auto-create**

In `GET /profiles/me`, in the `db.insert(profilesTable).values({...})` for new Clerk signups, **remove** these two lines:

```ts
          gender: "other",
          age: 0,
```

(Leaving both null = "unknown", instead of a misleading 0/other. Keep `heard_from: "clerk_signup"`.)

- [ ] **Step 3: Handle `date_of_birth` on self-update (`PATCH /profiles/me`)**

The generated `UpdateMyProfileBody` strips unknown keys, so handle DOB explicitly. Replace the update block:

```ts
    const [updated] = await db
      .update(profilesTable)
      .set(parsed.data)
      .where(eq(profilesTable.clerk_id, clerkId))
      .returning();
```

with:

```ts
    const updateData: Record<string, unknown> = { ...parsed.data };
    const dob = (req.body ?? {}).date_of_birth;
    if (dob !== undefined) {
      if (dob === null || dob === "") {
        updateData.date_of_birth = null;
      } else {
        const v = validateDob(dob);
        if (!v.ok) return res.status(400).json({ error: v.error });
        updateData.date_of_birth = String(dob).trim();
        updateData.age = v.age;
      }
    }
    const [updated] = await db
      .update(profilesTable)
      .set(updateData)
      .where(eq(profilesTable.clerk_id, clerkId))
      .returning();
```

- [ ] **Step 4: Handle `date_of_birth` on leader edit (`PATCH /profiles/:id`)**

In the `PATCH /profiles/:id` handler, add `date_of_birth` to the destructure:

```ts
    const { full_name, phone, email, gender, age, date_of_birth, school, parent_phone, parent_name, whatsapp_opt_in, avatar_url } = req.body;
```

Then, directly after the existing `if (age !== undefined) ...` line, add:

```ts
    if (date_of_birth !== undefined) {
      if (date_of_birth === null || date_of_birth === "") {
        updateData.date_of_birth = null;
      } else {
        const v = validateDob(date_of_birth);
        if (!v.ok) return res.status(400).json({ error: v.error });
        updateData.date_of_birth = String(date_of_birth).trim();
        updateData.age = v.age; // DOB is authoritative when provided
      }
    }
```

- [ ] **Step 5: Return `date_of_birth`, `age`, `gender` from the directory endpoints**

In **both** `GET /profiles/members-directory` and `GET /profiles` the `.select({...})` objects omit age/gender/DOB, which is why the edit dialog always shows 18/male. Add these three lines to **each** of the two `.select({...})` blocks (e.g. after `avatar_url: profilesTable.avatar_url,`):

```ts
          gender: profilesTable.gender,
          age: profilesTable.age,
          date_of_birth: profilesTable.date_of_birth,
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @workspace/api-server run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/routes/profiles.ts
git commit -m "feat(api): capture date_of_birth on profile writes; return age/gender/dob in directory; drop fake age:0/other"
```

---

### Task 5: Under-13 consent uses computed age

**Files:**
- Modify: `artifacts/api-server/src/routes/pinAccounts.ts` (call site ~line 157)

- [ ] **Step 1: Import computeAge**

Add to the imports in `pinAccounts.ts`:

```ts
import { computeAge } from "../lib/age";
```

- [ ] **Step 2: Pass computed age into the consent gate**

In the `canGrantMembership({ role: target.role, age: target.age, ... })` call, change the `age` line to prefer the live-computed age, falling back to the stored value:

```ts
          age: computeAge(target.date_of_birth) ?? target.age,
```

- [ ] **Step 3: Typecheck + run the consent tests**

Run: `pnpm --filter @workspace/api-server run typecheck`
Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/membershipConsent.test.ts`
Expected: PASS (consent logic unchanged; tests still green).

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/pinAccounts.ts
git commit -m "feat(api): under-13 consent uses live computed age from date_of_birth"
```

---

### Task 6: Frontend age utility (mirror)

**Files:**
- Create: `artifacts/jg-youth/src/lib/age.ts`

- [ ] **Step 1: Create the mirror utility**

Create `artifacts/jg-youth/src/lib/age.ts` with the same logic as the api-server copy plus a small display helper:

```ts
// Pure age helpers for the web app. Logic mirrors
// artifacts/api-server/src/lib/age.ts (kept in sync by hand).

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MIN_AGE = 5;
export const MAX_AGE = 100;

/** Today's date in South Africa (SAST, UTC+2) as 'YYYY-MM-DD'. */
export function todaySAST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Whole-years age from a 'YYYY-MM-DD' date of birth, or null if unknown/invalid. */
export function computeAge(
  dob: string | null | undefined,
  today: string = todaySAST(),
): number | null {
  if (!dob) return null;
  const b = DATE_RE.exec(dob.trim());
  const t = DATE_RE.exec(today);
  if (!b || !t) return null;
  const by = +b[1], bm = +b[2], bd = +b[3];
  const ty = +t[1], tm = +t[2], td = +t[3];
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  if (age < 0 || age > 150) return null;
  return age;
}

/**
 * Best display age: live age from date_of_birth, else the legacy stored age,
 * else "—". Used everywhere age is shown.
 */
export function displayAge(
  dob: string | null | undefined,
  storedAge: number | null | undefined,
): string {
  const live = computeAge(dob);
  if (live !== null) return String(live);
  if (typeof storedAge === "number" && storedAge > 0) return String(storedAge);
  return "—";
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/jg-youth run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/jg-youth/src/lib/age.ts
git commit -m "feat(web): add computeAge/displayAge age utility (mirror)"
```

---

### Task 7: Sign-up form captures date of birth

**Files:**
- Modify: `artifacts/jg-youth/src/pages/register.tsx`

- [ ] **Step 1: Import the frontend age helpers**

Add near the existing imports:

```ts
import { computeAge, MIN_AGE, MAX_AGE, todaySAST } from "@/lib/age";
```

- [ ] **Step 2: Swap the `age` field for `date_of_birth` in the Zod schema**

In `registerSchema`, remove the `age: z.coerce.number()...` block and add:

```ts
  date_of_birth: z
    .string()
    .min(1, "Date of birth is required")
    .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && v <= todaySAST(), {
      message: "Enter a valid date of birth (not in the future)",
    })
    .refine((v) => {
      const a = computeAge(v);
      return a !== null && a >= MIN_AGE && a <= MAX_AGE;
    }, { message: `Age must be between ${MIN_AGE} and ${MAX_AGE}` }),
```

- [ ] **Step 3: Update default values and the step-1 validation list**

In `useForm({ defaultValues: {...} })`, remove `age: 18,` and add `date_of_birth: "",`. Also change `gender: "male",` to `gender: "" as any,` so no gender is pre-selected (fixes "everyone male").

In `nextStep`, change the step-1 field list from `[... "gender", "age"]` to `[... "gender", "date_of_birth"]`.

- [ ] **Step 4: Replace the Age input with a date-of-birth picker**

Replace the `age` `FormField` (the `<Input type="number" ...>` for Age) with:

```tsx
                    <FormField
                      control={form.control}
                      name="date_of_birth"
                      render={({ field }) => {
                        const liveAge = computeAge(field.value);
                        return (
                          <FormItem>
                            <FormLabel className="text-foreground">Date of Birth *</FormLabel>
                            <FormControl>
                              <Input
                                type="date"
                                max={todaySAST()}
                                className="bg-card border-border text-foreground focus:border-primary focus:ring-primary rounded-xl h-11"
                                {...field}
                              />
                            </FormControl>
                            {liveAge !== null && (
                              <p className="text-xs text-muted-foreground mt-1">Age: {liveAge}</p>
                            )}
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />
```

- [ ] **Step 5: Submit `date_of_birth` instead of `age`**

In `onSubmit`, in the `fetch("/api/register", { body: JSON.stringify({...}) })` payload, remove `age: parseInt(String(data.age), 10),` and add:

```ts
          date_of_birth: data.date_of_birth,
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @workspace/jg-youth run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/jg-youth/src/pages/register.tsx
git commit -m "feat(web): sign-up captures date of birth instead of a typed age"
```

---

### Task 8: Leader edit dialog uses date of birth

**Files:**
- Modify: `artifacts/jg-youth/src/components/panels/DialogManager.tsx`
- Modify: `artifacts/jg-youth/src/pages/dashboard.tsx`

- [ ] **Step 1: DialogManager — swap props from age to date_of_birth**

In `DialogManagerProps`, replace:

```ts
  editAge: number;
  setEditAge: (v: number) => void;
```

with:

```ts
  editDateOfBirth: string;
  setEditDateOfBirth: (v: string) => void;
```

- [ ] **Step 2: DialogManager — import computeAge and replace the Age input**

Add `import { computeAge } from "@/lib/age";` to the imports. Replace the Age `<Input type="number" ...>` block (the one with `id="edit-age"`) with a date input plus a read-only computed age:

```tsx
              <div className="space-y-1.5">
                <Label htmlFor="edit-dob" className="text-foreground">Date of Birth</Label>
                <Input
                  id="edit-dob"
                  type="date"
                  value={props.editDateOfBirth}
                  onChange={(e) => props.setEditDateOfBirth(e.target.value)}
                  className="bg-card border-border rounded-xl"
                />
                <p className="text-xs text-muted-foreground">
                  Age: {computeAge(props.editDateOfBirth) ?? "—"}
                </p>
              </div>
```

- [ ] **Step 3: dashboard.tsx — replace edit state**

Replace `const [editAge, setEditAge] = useState(18);` with:

```ts
  const [editDateOfBirth, setEditDateOfBirth] = useState("");
```

(Keep `editGender` as-is.)

- [ ] **Step 4: dashboard.tsx — set DOB and real gender when opening the dialog**

In `openEditDialog`, replace `setEditAge(profile.age ?? 18);` with:

```ts
    setEditDateOfBirth(profile.date_of_birth ?? "");
```

(The `setEditGender(profile.gender === "female" ? "female" : "male")` line stays; gender now arrives real from the directory endpoint, so it no longer defaults for everyone.)

- [ ] **Step 5: dashboard.tsx — send date_of_birth on save**

In `handleSaveEdit`'s PATCH body, remove the `age: editAge ? parseInt(String(editAge), 10) : null,` line and add:

```ts
          date_of_birth: editDateOfBirth || null,
```

- [ ] **Step 6: dashboard.tsx — pass the new props to DialogManager**

Where `<DialogManager ... editAge={editAge} setEditAge={setEditAge} />` is rendered, replace those two props with:

```tsx
        editDateOfBirth={editDateOfBirth}
        setEditDateOfBirth={setEditDateOfBirth}
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @workspace/jg-youth run typecheck`
Expected: PASS (no remaining references to `editAge`/`setEditAge`).

- [ ] **Step 8: Commit**

```bash
git add artifacts/jg-youth/src/components/panels/DialogManager.tsx artifacts/jg-youth/src/pages/dashboard.tsx
git commit -m "feat(web): leader edit dialog uses date of birth with live age"
```

---

### Task 9: Member "Add your birthday" prompt

**Files:**
- Modify: `artifacts/jg-youth/src/pages/my.tsx`

The member home already fetches `profile` (Clerk-authed) and shows optional prompts. Add a self-contained, dismissible birthday prompt that saves via a same-origin `fetch` to `/api/profiles/me` (the Clerk session cookie authenticates it automatically — same pattern the register form uses).

- [ ] **Step 1: Add imports + state**

Ensure these imports exist near the top of `my.tsx`:

```ts
import { computeAge, MIN_AGE, MAX_AGE, todaySAST } from "@/lib/age";
import { getGetMyProfileQueryKey } from "@workspace/api-client-react";
```

(`getGetMyProfileQueryKey` is already used in this file. Add only what's missing.)

Add state alongside the other prompt state (near `showProfilePrompt`):

```ts
  const [showBirthdayPrompt, setShowBirthdayPrompt] = useState(false);
  const [birthdayInput, setBirthdayInput] = useState("");
  const [isSavingBirthday, setIsSavingBirthday] = useState(false);
```

- [ ] **Step 2: Decide when to show it**

After the existing `shouldPrompt` computation, add:

```ts
  // Show the birthday prompt to members who have no date_of_birth yet, unless
  // they dismissed it before. Independent of (and lower priority than) the
  // profile-completion prompt.
  const needsBirthday =
    profileLoaded &&
    !(profile as any).date_of_birth &&
    !localStorage.getItem("dismissed_birthday_prompt");

  if (needsBirthday && !shouldPrompt && !showBirthdayPrompt && birthdayInput === "") {
    setShowBirthdayPrompt(true);
  }
```

- [ ] **Step 3: Add the save handler**

Add near `handleSaveProfile`:

```ts
  async function handleSaveBirthday() {
    const a = computeAge(birthdayInput);
    if (a === null || a < MIN_AGE || a > MAX_AGE || birthdayInput > todaySAST()) {
      toast({ title: "Enter a valid date of birth", variant: "destructive" });
      return;
    }
    setIsSavingBirthday(true);
    try {
      const res = await fetch("/api/profiles/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date_of_birth: birthdayInput }),
      });
      if (!res.ok) throw new Error();
      queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      toast({ title: "Birthday saved 🎂" });
      setShowBirthdayPrompt(false);
    } catch {
      toast({ title: "Could not save your birthday", variant: "destructive" });
    } finally {
      setIsSavingBirthday(false);
    }
  }

  function dismissBirthdayPrompt() {
    localStorage.setItem("dismissed_birthday_prompt", "true");
    setShowBirthdayPrompt(false);
  }
```

- [ ] **Step 4: Render the dialog**

Near the other dialogs at the end of the JSX (e.g. just before the lightbox `<Dialog open={!!lightboxImage} ...>`), add:

```tsx
      <Dialog open={showBirthdayPrompt} onOpenChange={(o) => { if (!o) dismissBirthdayPrompt(); }}>
        <DialogContent className="rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-center text-2xl font-semibold tracking-tight">
              Add your birthday 🎂
            </DialogTitle>
            <DialogDescription className="text-center pt-1">
              So we can celebrate you and keep your age up to date.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="birthday-input">Date of birth</Label>
            <Input
              id="birthday-input"
              type="date"
              max={todaySAST()}
              value={birthdayInput}
              onChange={(e) => setBirthdayInput(e.target.value)}
              className="bg-card border-border rounded-xl"
            />
            {computeAge(birthdayInput) !== null && (
              <p className="text-xs text-muted-foreground">Age: {computeAge(birthdayInput)}</p>
            )}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button onClick={handleSaveBirthday} disabled={isSavingBirthday} className="w-full rounded-xl">
              {isSavingBirthday ? "Saving…" : "Save"}
            </Button>
            <Button variant="ghost" onClick={dismissBirthdayPrompt} className="w-full rounded-xl">
              Maybe later
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

Confirm `Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, Label, Input, Button` are already imported in `my.tsx` (they are used elsewhere in the file); add any that are missing.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @workspace/jg-youth run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/jg-youth/src/pages/my.tsx
git commit -m "feat(web): one-time 'add your birthday' prompt for members without a DOB"
```

---

### Task 10: Full verification

- [ ] **Step 1: Typecheck the whole workspace**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 2: Run api-server tests**

Run: `pnpm --filter @workspace/api-server test`
Expected: PASS (age + consent + existing suites green).

- [ ] **Step 3: Build the web app**

Run: `pnpm --filter @workspace/jg-youth run build`
Expected: build succeeds.

- [ ] **Step 4: Manual smoke test (local or preview)** — verify each:
  - New registration: the sign-up form shows a **Date of Birth** picker (no Age box), live age preview appears, future dates rejected.
  - Leader dashboard → Member Directory → a member → **View Profile**: shows the member's real gender and a **Date of Birth** field with a correct live "Age:" (no longer 18/male for everyone). Setting a DOB and saving updates the age.
  - Member home (`/my`): a member with no DOB sees the **Add your birthday 🎂** prompt; saving stores it and the prompt does not reappear; "Maybe later" dismisses it.
  - A blank-age record now reads "—" rather than 0/18.

- [ ] **Step 5: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore: date-of-birth age fix — verification cleanup"
```

---

## Deferred follow-up (not in this plan)

**Supabase edge-function body parity.** The Render api-server is live; the Supabase `register`/`profiles`/`pinAccounts` functions are a parallel, non-live port. The shared **schema** mirror is already done (Task 1, Step 3), so that branch compiles. When that branch is next worked on, mirror the same `date_of_birth` handling: add a Deno copy of the age utility at `supabase/functions/_shared/age.ts`, then apply the equivalents of Task 3 (register), Task 4 (profiles), and Task 5 (consent) to `supabase/functions/register/index.ts`, `supabase/functions/profiles/index.ts`, and the consent call site. Tracked here so it isn't forgotten.

**Part 2 (Happy Birthday feature)** and **Part 3 (Member directory split)** are separate specs/plans that build on this foundation.
```
