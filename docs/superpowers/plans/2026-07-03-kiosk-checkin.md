# Kiosk Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A locked `/kiosk` page on the leader's phone where members check in by tap and newcomers get a username+PIN visitor account on the spot — plus the `/account` upgrades (push, events) that close the autonomy loop, and two security fixes in the kiosk's data path.

**Architecture:** Kiosk runs entirely under the leader's `x-leader-session`. New thin `routes/kiosk.ts` endpoints sit over a new pure, tested `lib/kioskAccount.ts` (username/PIN generation). Member check-in reuses a hardened `POST /api/attendance`. Kiosk first-timers become PIN-account visitors on `profiles` (not the legacy `visitors` table). Spec: `docs/superpowers/specs/2026-07-03-kiosk-checkin-design.md`.

**Tech Stack:** Express + drizzle (api-server), vitest, React + wouter + react-hook-form/zod (jg-youth), existing `apiFetch` PIN/leader session plumbing.

**Branch:** `feat/kiosk-mode` stacked on `fix/pin-account-birthday` (account.tsx edits depend on it).

---

### Task 1: Pure helpers `lib/kioskAccount.ts` (TDD)

**Files:**
- Create: `artifacts/api-server/src/lib/kioskAccount.ts`
- Test: `artifacts/api-server/src/lib/kioskAccount.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { usernameFromName, usernameCandidates, generatePin } from "./kioskAccount";
import { validateUsername } from "./username";
import { validatePin } from "./pin";

describe("usernameFromName", () => {
  it("slugifies a full name to a valid username base", () => {
    expect(usernameFromName("Thandi Khumalo")).toBe("thandi_khumalo");
  });
  it("strips accents and punctuation", () => {
    expect(usernameFromName("Léa-Marie O'Neil")).toBe("leamarie_oneil");
  });
  it("caps at 20 characters", () => {
    expect(usernameFromName("Bartholomew Montgomery Fitzgerald").length).toBeLessThanOrEqual(20);
  });
  it("pads very short or empty names to a valid username", () => {
    for (const name of ["Al", "李", ""]) {
      const u = usernameFromName(name);
      expect(validateUsername(u).ok).toBe(true);
    }
  });
});

describe("usernameCandidates", () => {
  it("yields the base first, then numeric suffixes, all valid and within 20 chars", () => {
    const it_ = usernameCandidates("thandi_khumalo");
    expect(it_.next().value).toBe("thandi_khumalo");
    expect(it_.next().value).toBe("thandi_khumalo2");
    const gen = usernameCandidates("a_very_long_username"); // exactly 20 chars
    const first = gen.next().value as string;
    const second = gen.next().value as string;
    expect(first.length).toBeLessThanOrEqual(20);
    expect(second.length).toBeLessThanOrEqual(20);
    expect(validateUsername(second).ok).toBe(true);
  });
});

describe("generatePin", () => {
  it("always produces a 4-digit PIN accepted by validatePin", () => {
    for (let i = 0; i < 50; i++) {
      const pin = generatePin();
      expect(pin).toMatch(/^\d{4}$/);
      expect(validatePin(pin).ok).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run to verify RED** — `pnpm --filter=@workspace/api-server exec vitest run src/lib/kioskAccount.test.ts` → FAIL (module missing)

- [ ] **Step 3: Minimal implementation**

```typescript
// Pure username/PIN generation for kiosk-created visitor accounts.
import crypto from "node:crypto";
import { validatePin } from "./pin";

/** Slugify a full name into a valid username base (3-20 chars, [a-z0-9_]). */
export function usernameFromName(fullName: string): string {
  const slug = fullName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9\s_]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 20);
  if (slug.length >= 3) return slug;
  return (slug + "guest").slice(0, 20);
}

/** Base first, then numeric suffixes trimmed to fit 20 chars. */
export function* usernameCandidates(base: string): Generator<string> {
  yield base;
  for (let i = 2; i < 1000; i++) {
    const suffix = String(i);
    yield base.slice(0, 20 - suffix.length) + suffix;
  }
}

/** Non-trivial 4-digit PIN (validatePin rejects 0000/1234-style PINs). */
export function generatePin(): string {
  let pin: string;
  do {
    pin = String(crypto.randomInt(1000, 10000));
  } while (!validatePin(pin).ok);
  return pin;
}
```

- [ ] **Step 4: Run to verify GREEN** — same command → PASS
- [ ] **Step 5: Commit** — `git add ... && git commit -m "feat(kiosk): pure username/PIN generators for kiosk accounts"`

---

### Task 2: Security — project `GET /api/checkin/search`

**Files:** Modify `artifacts/api-server/src/routes/checkin.ts:40-50`

- [ ] **Step 1:** Replace the bare `select()` with a projection (the page renders only name/phone; kiosk adds avatar/role):

```typescript
    const profiles = await db
      .select({
        id: profilesTable.id,
        full_name: profilesTable.full_name,
        phone: profilesTable.phone,
        avatar_url: profilesTable.avatar_url,
        role: profilesTable.role,
      })
      .from(profilesTable)
      .where(/* unchanged or/ilike */)
      .limit(20);
```

- [ ] **Step 2:** Verify no server code depends on extra fields from this endpoint (grep `checkin/search` callers) → only `checkin.tsx` search UI (uses id/full_name/phone).
- [ ] **Step 3:** `pnpm --filter=@workspace/api-server run typecheck` → clean; commit `fix(security): stop leaking full profile rows (incl. PINs) from public check-in search`

---

### Task 3: Security — gate + dedupe `POST /api/attendance`

**Files:** Modify `artifacts/api-server/src/routes/attendance.ts:62-96`

- [ ] **Step 1:** Confirm frontend callers send the leader header: `follow-up-hub.tsx` uses `useApiFetch` (attaches `x-leader-session`) ✓. Grep for other `POST` callers of `/api/attendance`.
- [ ] **Step 2:** Add `requireLeaderSession("leader")` middleware and same-day dedupe before insert:

```typescript
router.post("/attendance", requireLeaderSession("leader"), async (req, res) => {
  try {
    const parsed = CheckInBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const today = new Date().toISOString().split("T")[0];
    const existing = await db
      .select({ id: attendanceTable.id })
      .from(attendanceTable)
      .where(and(
        eq(attendanceTable.profile_id, parsed.data.profile_id),
        eq(attendanceTable.session_date, today),
      ))
      .limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ error: "Already checked in today" });
    }
    // ... existing insert + publishActivity unchanged
```

- [ ] **Step 3:** typecheck + full vitest suite → green; commit `fix(security): require leader session + same-day dedupe on POST /attendance`

---

### Task 4: Kiosk backend `routes/kiosk.ts`

**Files:**
- Create: `artifacts/api-server/src/routes/kiosk.ts`
- Modify: `artifacts/api-server/src/routes/index.ts` (import + `router.use(kioskRouter)`)

- [ ] **Step 1:** Implement three leader-gated endpoints (thin over tested helpers):

```typescript
import { Router } from "express";
import bcrypt from "bcrypt";
import { and, eq } from "drizzle-orm";
import { db, profilesTable, attendanceTable, membershipRequestsTable } from "@workspace/db";
import { requireLeaderSession } from "../middlewares/requireLeaderSession";
import { validateDob } from "../lib/age";
import { publishActivity } from "../lib/activityStream";
import { usernameFromName, usernameCandidates, generatePin } from "../lib/kioskAccount";

const router = Router();

// POST /kiosk/register — leader registers a newcomer at the kiosk. Creates a
// username+PIN visitor profile (login-capable), records tonight's attendance,
// and returns the credentials once for handoff.
router.post("/kiosk/register", requireLeaderSession("leader"), async (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const fullName = typeof b.full_name === "string" ? b.full_name.trim() : "";
    if (!fullName) return res.status(400).json({ error: "full_name is required" });
    const avatarUrl = typeof b.avatar_url === "string" ? b.avatar_url.trim() : "";
    if (!avatarUrl) return res.status(400).json({ error: "A profile picture is required" });
    if (b.gender !== "male" && b.gender !== "female") {
      return res.status(400).json({ error: "gender is required" });
    }
    const v = validateDob(b.date_of_birth);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const phone = typeof b.phone === "string" && b.phone.trim() ? b.phone.trim() : null;
    const parentName = typeof b.parent_name === "string" && b.parent_name.trim() ? b.parent_name.trim() : null;
    const parentPhone = typeof b.parent_phone === "string" && b.parent_phone.trim() ? b.parent_phone.trim() : null;

    const pin = generatePin();
    const pinHash = await bcrypt.hash(pin, 12);

    let inserted = null;
    for (const candidate of usernameCandidates(usernameFromName(fullName))) {
      try {
        [inserted] = await db.insert(profilesTable).values({
          full_name: fullName,
          username: candidate,
          pin_hash: pinHash,
          pin_plain: pin, // deliberate: leaders can always recover kids' PINs
          date_of_birth: String(b.date_of_birth).trim(),
          age: v.age,
          gender: b.gender,
          phone,
          avatar_url: avatarUrl,
          parent_name: parentName,
          parent_phone: parentPhone,
          role: "visitor",
          heard_from: "kiosk",
        }).returning();
        break;
      } catch (e) {
        if ((e as { code?: string })?.code === "23505") continue; // username race → next candidate
        throw e;
      }
    }
    if (!inserted) return res.status(500).json({ error: "Could not allocate a username" });

    const today = new Date().toISOString().split("T")[0] as string;
    await db.insert(attendanceTable).values({
      profile_id: inserted.id,
      session_date: today,
      check_in_method: "manual",
      type: "visitor",
    });
    publishActivity({
      type: "registration",
      profile_id: inserted.id,
      profile_name: inserted.full_name,
      metadata: { source: "kiosk_registration" },
    });
    return res.status(201).json({
      profile_id: inserted.id,
      full_name: inserted.full_name,
      username: inserted.username,
      pin,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /kiosk/request-membership — idempotent pending membership request.
router.post("/kiosk/request-membership", requireLeaderSession("leader"), async (req, res) => {
  try {
    const profileId = (req.body ?? {}).profile_id;
    if (typeof profileId !== "string" || !profileId) {
      return res.status(400).json({ error: "profile_id is required" });
    }
    const target = await db.query.profilesTable.findFirst({ where: eq(profilesTable.id, profileId) });
    if (!target) return res.status(404).json({ error: "Profile not found" });
    const existing = await db
      .select({ id: membershipRequestsTable.id })
      .from(membershipRequestsTable)
      .where(and(
        eq(membershipRequestsTable.profile_id, profileId),
        eq(membershipRequestsTable.status, "pending"),
      ))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(membershipRequestsTable).values({
        profile_id: profileId,
        reason: "Kiosk registration",
        status: "pending",
      });
      publishActivity({
        type: "membership_request",
        profile_id: target.id,
        profile_name: target.full_name,
        metadata: { source: "kiosk_registration" },
      });
    }
    return res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /kiosk/verify-pin — leader re-authenticates to exit kiosk mode.
router.post("/kiosk/verify-pin", requireLeaderSession("leader"), async (req, res) => {
  try {
    const pin = typeof (req.body ?? {}).pin === "string" ? (req.body as { pin: string }).pin : "";
    const profile = await db.query.profilesTable.findFirst({ where: eq(profilesTable.id, req.leaderId!) });
    if (!profile?.pin_hash) return res.json({ valid: false, no_pin: true });
    // Legacy short hashes are plaintext (same fallback as /leaders/verify-pin).
    const valid = profile.pin_hash.length < 20
      ? pin === profile.pin_hash
      : await bcrypt.compare(pin, profile.pin_hash);
    return res.json({ valid });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
```

- [ ] **Step 2:** Mount in `routes/index.ts`: `import kioskRouter from "./kiosk";` + `router.use(kioskRouter);`
- [ ] **Step 3:** typecheck + full suite green; commit `feat(kiosk): leader-gated register / request-membership / verify-pin endpoints`

---

### Task 5: `/kiosk` page + route

**Files:**
- Create: `artifacts/jg-youth/src/pages/kiosk.tsx`
- Modify: `artifacts/jg-youth/src/App.tsx` (route `/kiosk`, imported like siblings)

Screens as a state machine (`home → search → confirm → success/already`, `register → credentials → membership`), no `Layout` chrome, `getLeaderSession()` gate with `Redirect to="/leader-login"`. Big touch targets (`h-14+`, `text-lg+`). Member search via public `/api/checkin/search` (now returns `avatar_url`); check-in via `apiFetch POST /api/attendance {profile_id, check_in_method:"manual"}` (409 → "already" screen). Registration form: photo (required, `POST /api/register/photo` multipart like register.tsx:129-155), name, gender toggle, DOB (`type="date"`, live age via `computeAge`), phone optional (`PhoneInput`), parent name/phone shown when `computeAge(dob) < 13`. Submit → `apiFetch POST /api/kiosk/register` → credentials screen (username + PIN large, `wa.me/<digits>?text=<encoded login message>` button when phone present) → membership Yes/No (`POST /api/kiosk/request-membership`) → home. Idle: 45 s timer resets `search/confirm/success/already` screens to `home` (never the form). Exit: lock icon → `GET /api/profiles/me/pin`; if `hasPIN`, 4-digit prompt → `POST /api/kiosk/verify-pin`; else confirm dialog → `setLocation("/dashboard")`.

- [ ] Build page, wire route, `tsc --noEmit` clean, commit `feat(kiosk): locked shared-phone check-in + on-the-spot registration page`

---

### Task 6: `/account` upgrade (autonomy loop)

**Files:** Modify `artifacts/jg-youth/src/pages/account.tsx`

- [ ] Add `<NotificationSetupCard />` (from `@/components/member/NotificationSetupCard` — Clerk-free, `apiFetch` handles the PIN session) directly under the profile card.
- [ ] Add "Upcoming events" card: `fetch("/api/events?public_only=true&upcoming=true")`, render up to 4 rows (title, date · time, location), friendly empty state.
- [ ] `tsc --noEmit` clean, commit `feat(account): notification setup + upcoming events for PIN accounts`

---

### Task 7: Dashboard entry point

**Files:** Modify `artifacts/jg-youth/src/pages/dashboard.tsx` (session section, next to the "Generate Session QR" action around `handleGenerateSessionQrCode`)

- [ ] Add a "Start Kiosk Mode" button (MonitorSmartphone icon) navigating to `/kiosk`; commit `feat(kiosk): dashboard entry button`

---

### Task 8: Full verification + push

- [ ] `pnpm --filter=@workspace/api-server run test` → all green (117 + new)
- [ ] `pnpm --filter=@workspace/api-server run typecheck` → exit 0
- [ ] `node node_modules/typescript/bin/tsc -p artifacts/jg-youth/tsconfig.json --noEmit` → exit 0
- [ ] `pnpm --filter=@workspace/jg-youth run build` → success
- [ ] Push `feat/kiosk-mode`, report PR link
