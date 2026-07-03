# Web Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Free outbound phone notifications (Web Push/VAPID) so members return to the app without being personally asked — check-in-open pushes and leader-triggered event announcements.

**Architecture:** The Express api-server (Render) stores browser push subscriptions in Postgres and sends notifications via the `web-push` npm package signed with free VAPID keys. The check-in push hooks into the existing 60-second `followUpGenerator` tick with a DB-backed once-per-day dedupe. The Vite SPA becomes an installable PWA (manifest + service worker) with a platform-aware "Enable notifications" card on the member dashboard and a leader "Notify members" button per event.

**Tech Stack:** Express 5, drizzle-orm, `web-push`, vitest, Vite + React 19, Tailwind/shadcn UI.

**Spec:** `docs/superpowers/specs/2026-07-02-web-push-notifications-design.md`

**Codebase facts the engineer needs:**
- Drizzle table definitions live in `lib/db/src/schema/index.ts`; the live DB is migrated by idempotent SQL DDL (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS) inside `artifacts/api-server/src/db/index.ts`, which runs at server startup. **Both must be updated together.**
- Routers live in `artifacts/api-server/src/routes/*.ts` and are registered in `routes/index.ts`; the app mounts them at `/api` (`app.ts:58`).
- Member auth (Clerk **or** username+PIN): `resolveAccount(req)` from `../lib/resolveAccount` returns a `Profile` or `null`. Leader auth: `requireLeaderSession("leader")` middleware (sets `req.leaderId`).
- Frontend API calls: `apiFetch(url, options)` from `artifacts/jg-youth/src/lib/api.ts` attaches Clerk bearer + `x-leader-session` headers and uses relative URLs (Vercel rewrites `/api/*` to Render). `EventsPanel.tsx` uses its own local pattern (`VITE_API_URL` base + manual headers) — follow the local pattern inside that file.
- Static frontend files go in `artifacts/jg-youth/public/` (Vite copies them to the build output; `build-vercel.cjs` copies the build to repo-root `public/` for Vercel). Note: `public/index.html` and `public/assets/` are stale committed build output — ignore them, do not edit them.
- Tests: vitest in api-server (`pnpm --filter=@workspace/api-server test`). Existing tests cover pure functions only (`src/lib/checkinSchedule.test.ts`) — DB-touching code is not unit-tested in this codebase; keep that convention.
- Run all commands from the repo root `C:\Users\Cash\Youth-Connect`.

---

### Task 1: Add the `web-push` dependency

**Files:**
- Modify: `artifacts/api-server/package.json` (via pnpm)

- [ ] **Step 1: Install**

Run:
```bash
pnpm --filter=@workspace/api-server add web-push
pnpm --filter=@workspace/api-server add -D @types/web-push
```
Expected: both succeed; `web-push` appears under dependencies, `@types/web-push` under devDependencies.

- [ ] **Step 2: Commit**

```bash
git add artifacts/api-server/package.json pnpm-lock.yaml
git commit -m "feat(push): add web-push dependency"
```

---

### Task 2: Database schema — `push_subscriptions`, `push_send_log`, `events.last_notified_at`

**Files:**
- Modify: `lib/db/src/schema/index.ts`
- Modify: `artifacts/api-server/src/db/index.ts`

- [ ] **Step 1: Add drizzle tables**

In `lib/db/src/schema/index.ts`, ensure `unique` is included in the `drizzle-orm/pg-core` import list, then append at the end of the file:

```ts
// Web push (2026-07): one row per browser/device push subscription.
export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  profile_id: uuid("profile_id")
    .notNull()
    .references(() => profilesTable.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  user_agent: text("user_agent"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Restart-safe dedupe for automated pushes: one row per (kind, day) fired.
export const pushSendLogTable = pgTable(
  "push_send_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    sent_on: date("sent_on").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    kindSentOnUnique: unique("push_send_log_kind_sent_on_unique").on(
      t.kind,
      t.sent_on,
    ),
  }),
);
```

And inside `eventsTable` (after the `target_gender` column):

```ts
  // Set when a leader push-notifies members about this event (24h re-notify cap).
  last_notified_at: timestamp("last_notified_at", { withTimezone: true }),
```

- [ ] **Step 2: Add startup DDL**

In `artifacts/api-server/src/db/index.ts`, append to the same SQL DDL block that contains the `checkin_settings` / `feedbacks` CREATE TABLE statements (match the existing comment style):

```sql
-- Web push (2026-07): browser push subscriptions + automated-send dedupe log.
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "profile_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "endpoint" text NOT NULL UNIQUE,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_profile_id ON push_subscriptions (profile_id);

CREATE TABLE IF NOT EXISTS "push_send_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" text NOT NULL,
  "sent_on" date NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "push_send_log_kind_sent_on_unique" UNIQUE ("kind", "sent_on")
);

-- 24h cap for leader "Notify members" event pushes.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "last_notified_at" timestamp with time zone;
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter=@workspace/api-server typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add lib/db/src/schema/index.ts artifacts/api-server/src/db/index.ts
git commit -m "feat(push): push_subscriptions + push_send_log tables, events.last_notified_at"
```

---

### Task 3: Pure push logic helpers (TDD)

**Files:**
- Create: `artifacts/api-server/src/lib/pushLogic.ts`
- Test: `artifacts/api-server/src/lib/pushLogic.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/lib/pushLogic.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  windowJustOpened,
  eventNotifyAllowed,
  shouldDeleteSubscription,
  eventPushPayload,
  checkinOpenPayload,
  type PushWindow,
} from "./pushLogic";

const friday: PushWindow = {
  day_of_week: 5,
  start_time: "18:30",
  end_time: "22:00",
  enabled: true,
};

describe("windowJustOpened", () => {
  it("fires at the exact opening minute", () => {
    expect(windowJustOpened([friday], 5, "18:30")).toBe(true);
  });
  it("fires within the 2-minute grace period", () => {
    expect(windowJustOpened([friday], 5, "18:32")).toBe(true);
  });
  it("does not fire before opening", () => {
    expect(windowJustOpened([friday], 5, "18:29")).toBe(false);
  });
  it("does not fire after the grace period", () => {
    expect(windowJustOpened([friday], 5, "18:33")).toBe(false);
  });
  it("does not fire on another weekday", () => {
    expect(windowJustOpened([friday], 4, "18:30")).toBe(false);
  });
  it("ignores disabled windows", () => {
    expect(windowJustOpened([{ ...friday, enabled: false }], 5, "18:30")).toBe(false);
  });
  it("ignores windows with blank times", () => {
    expect(
      windowJustOpened([{ ...friday, start_time: "" }], 5, "18:30"),
    ).toBe(false);
  });
});

describe("eventNotifyAllowed", () => {
  const now = new Date("2026-07-02T18:00:00Z");
  it("allows when never notified", () => {
    expect(eventNotifyAllowed(null, now)).toBe(true);
  });
  it("blocks within 24 hours", () => {
    expect(
      eventNotifyAllowed(new Date("2026-07-02T10:00:00Z"), now),
    ).toBe(false);
  });
  it("allows after 24 hours", () => {
    expect(
      eventNotifyAllowed(new Date("2026-07-01T17:59:00Z"), now),
    ).toBe(true);
  });
});

describe("shouldDeleteSubscription", () => {
  it("deletes on 404 and 410", () => {
    expect(shouldDeleteSubscription(404)).toBe(true);
    expect(shouldDeleteSubscription(410)).toBe(true);
  });
  it("keeps on other statuses", () => {
    expect(shouldDeleteSubscription(429)).toBe(false);
    expect(shouldDeleteSubscription(500)).toBe(false);
    expect(shouldDeleteSubscription(0)).toBe(false);
  });
});

describe("payloads", () => {
  it("check-in payload links to /checkin", () => {
    const p = checkinOpenPayload();
    expect(p.url).toBe("/checkin");
    expect(p.body).toContain("Check-in is open");
  });
  it("event payload contains title, readable date, time, and links to /my", () => {
    const p = eventPushPayload({
      id: "abc",
      title: "Youth Night",
      date: "2026-07-10",
      time: "18:30:00",
    });
    expect(p.title).toContain("Youth Night");
    expect(p.body).toContain("18:30");
    expect(p.body).toContain("Friday");
    expect(p.url).toBe("/my");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter=@workspace/api-server exec vitest run src/lib/pushLogic.test.ts`
Expected: FAIL — cannot resolve `./pushLogic`.

- [ ] **Step 3: Implement**

Create `artifacts/api-server/src/lib/pushLogic.ts`:

```ts
/**
 * Pure helpers for web push. No DB, no network — fully unit-testable.
 */

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

export interface PushWindow {
  day_of_week: number; // 0=Sun … 6=Sat
  start_time: string; // "HH:MM" 24h SAST
  end_time: string;
  enabled: boolean;
}

/**
 * True when `hhmm` falls inside [start, start+2min] of an enabled window for
 * `dayOfWeek` — the 60s job tick is guaranteed to land in that grace period.
 */
export function windowJustOpened(
  windows: PushWindow[],
  dayOfWeek: number,
  hhmm: string,
): boolean {
  const [nowH, nowM] = hhmm.split(":").map(Number);
  const nowTotal = nowH * 60 + nowM;
  return windows.some((w) => {
    if (!w.enabled || w.day_of_week !== dayOfWeek || !w.start_time) return false;
    const [sh, sm] = w.start_time.split(":").map(Number);
    if (Number.isNaN(sh) || Number.isNaN(sm)) return false;
    const delta = nowTotal - (sh * 60 + sm);
    return delta >= 0 && delta <= 2;
  });
}

/** 24h cap between leader "Notify members" blasts per event. */
export function eventNotifyAllowed(
  lastNotifiedAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!lastNotifiedAt) return true;
  return now.getTime() - lastNotifiedAt.getTime() >= 24 * 60 * 60 * 1000;
}

/** Push services answer 404/410 for revoked/expired subscriptions. */
export function shouldDeleteSubscription(statusCode: number): boolean {
  return statusCode === 404 || statusCode === 410;
}

export function checkinOpenPayload(): PushPayload {
  return {
    title: "JG Youth",
    body: "Check-in is open! Tap to check in 🙌",
    url: "/checkin",
  };
}

/** "📅 Youth Night" / "Friday, 10 July at 18:30 — tap for details" */
export function eventPushPayload(event: {
  id: string;
  title: string;
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:MM" or "HH:MM:SS"
}): PushPayload {
  let when = event.date;
  try {
    when = new Date(`${event.date}T00:00:00`).toLocaleDateString("en-ZA", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  } catch {
    /* keep ISO date */
  }
  const hhmm = event.time.slice(0, 5);
  return {
    title: `📅 ${event.title}`,
    body: `${when} at ${hhmm} — tap for details`,
    // No event-detail page exists; the member dashboard lists events.
    url: "/my",
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter=@workspace/api-server exec vitest run src/lib/pushLogic.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/pushLogic.ts artifacts/api-server/src/lib/pushLogic.test.ts
git commit -m "feat(push): pure push logic helpers with tests"
```

---

### Task 4: Push sender (`web-push` wrapper with self-cleaning subscriptions)

**Files:**
- Create: `artifacts/api-server/src/lib/pushSender.ts`

- [ ] **Step 1: Implement**

Create `artifacts/api-server/src/lib/pushSender.ts`:

```ts
/**
 * Sends web push notifications via VAPID. Free — messages go straight to
 * Apple/Google push servers, signed with the VAPID keys in env.
 *
 * Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…).
 * When keys are missing every send quietly no-ops (dev-safe).
 */
import webpush from "web-push";
import { inArray } from "drizzle-orm";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { logger } from "./logger";
import { shouldDeleteSubscription, type PushPayload } from "./pushLogic";

let configured = false;
let warnedUnconfigured = false;

export function isPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function ensureConfigured(): boolean {
  if (configured) return true;
  if (!isPushConfigured()) {
    if (!warnedUnconfigured) {
      logger.warn("[push] VAPID keys not set — web push disabled");
      warnedUnconfigured = true;
    }
    return false;
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:matheatauunam@gmail.com",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
  return true;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

async function sendToSubscriptions(
  subs: SubscriptionRow[],
  payload: PushPayload,
): Promise<number> {
  if (!ensureConfigured() || subs.length === 0) return 0;
  const body = JSON.stringify(payload);
  const dead: string[] = [];
  let sent = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
        sent++;
      } catch (err) {
        const status =
          typeof (err as { statusCode?: unknown })?.statusCode === "number"
            ? (err as { statusCode: number }).statusCode
            : 0;
        if (shouldDeleteSubscription(status)) {
          dead.push(s.id);
        } else {
          logger.warn({ err, status }, "[push] send failed");
        }
      }
    }),
  );

  if (dead.length > 0) {
    await db
      .delete(pushSubscriptionsTable)
      .where(inArray(pushSubscriptionsTable.id, dead));
    logger.info({ count: dead.length }, "[push] Removed expired subscriptions");
  }
  return sent;
}

/**
 * Send a push to every device of the given profiles ("all" = every
 * subscriber). Returns the number of devices successfully reached.
 */
export async function sendPushToProfiles(
  profileIds: string[] | "all",
  payload: PushPayload,
): Promise<number> {
  if (profileIds !== "all" && profileIds.length === 0) return 0;
  const subs =
    profileIds === "all"
      ? await db.select().from(pushSubscriptionsTable)
      : await db
          .select()
          .from(pushSubscriptionsTable)
          .where(inArray(pushSubscriptionsTable.profile_id, profileIds));
  return sendToSubscriptions(subs, payload);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter=@workspace/api-server typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/lib/pushSender.ts
git commit -m "feat(push): web-push sender with expired-subscription cleanup"
```

---

### Task 5: Push routes (subscribe / unsubscribe / public-key / test)

**Files:**
- Create: `artifacts/api-server/src/routes/push.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

- [ ] **Step 1: Create the router**

Create `artifacts/api-server/src/routes/push.ts`:

```ts
import { Router, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { resolveAccount } from "../lib/resolveAccount";
import { isPushConfigured, sendPushToProfiles } from "../lib/pushSender";

const router = Router();

// GET /push/public-key — VAPID public key the browser needs to subscribe (public).
router.get("/push/public-key", (_req: Request, res: Response) => {
  if (!isPushConfigured()) {
    return res.status(503).json({ error: "Push notifications not configured" });
  }
  return res.json({ public_key: process.env.VAPID_PUBLIC_KEY });
});

// POST /push/subscribe — store this browser's push subscription (member-facing;
// accepts Clerk and username+PIN accounts alike).
router.post("/push/subscribe", async (req: Request, res: Response) => {
  try {
    const profile = await resolveAccount(req);
    if (!profile) return res.status(401).json({ error: "Not signed in" });

    const body = req.body as {
      endpoint?: unknown;
      keys?: { p256dh?: unknown; auth?: unknown };
    };
    if (
      typeof body?.endpoint !== "string" ||
      body.endpoint.length === 0 ||
      typeof body?.keys?.p256dh !== "string" ||
      typeof body?.keys?.auth !== "string"
    ) {
      return res.status(400).json({ error: "Invalid push subscription" });
    }

    // Same device re-subscribing (or a device changing owners) updates in place.
    await db
      .insert(pushSubscriptionsTable)
      .values({
        profile_id: profile.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        user_agent: req.headers["user-agent"] ?? null,
      })
      .onConflictDoUpdate({
        target: pushSubscriptionsTable.endpoint,
        set: {
          profile_id: profile.id,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
        },
      });
    return res.status(201).json({ ok: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /push/unsubscribe — remove this browser's subscription.
router.post("/push/unsubscribe", async (req: Request, res: Response) => {
  try {
    const profile = await resolveAccount(req);
    if (!profile) return res.status(401).json({ error: "Not signed in" });

    const endpoint = (req.body as { endpoint?: unknown })?.endpoint;
    if (typeof endpoint !== "string" || endpoint.length === 0) {
      return res.status(400).json({ error: "endpoint required" });
    }
    await db
      .delete(pushSubscriptionsTable)
      .where(
        and(
          eq(pushSubscriptionsTable.endpoint, endpoint),
          eq(pushSubscriptionsTable.profile_id, profile.id),
        ),
      );
    return res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /push/test — push "it works" to the caller's own devices (verification).
router.post("/push/test", async (req: Request, res: Response) => {
  try {
    const profile = await resolveAccount(req);
    if (!profile) return res.status(401).json({ error: "Not signed in" });

    const sent = await sendPushToProfiles([profile.id], {
      title: "JG Youth",
      body: "🎉 Notifications are working!",
      url: "/my",
    });
    return res.json({ sent });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
```

- [ ] **Step 2: Register the router**

In `artifacts/api-server/src/routes/index.ts` add the import and mount it with the other auth-aware routers:

```ts
import pushRouter from "./push";
```

and after `router.use(whatsappRouter);`:

```ts
router.use(pushRouter);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter=@workspace/api-server typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/push.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(push): subscribe/unsubscribe/public-key/test endpoints"
```

---

### Task 6: Leader "notify members" endpoint on events

**Files:**
- Modify: `artifacts/api-server/src/routes/events.ts`

- [ ] **Step 1: Add the endpoint**

In `artifacts/api-server/src/routes/events.ts`, add to the imports:

```ts
import { eventNotifyAllowed, eventPushPayload } from "../lib/pushLogic";
import { sendPushToProfiles } from "../lib/pushSender";
```

Then add this route after the `POST /events` handler:

```ts
// POST /events/:id/notify — push-notify the event's audience (protected: leader).
// Respects target_gender; staff always included; max one blast per event per 24h.
router.post(
  "/events/:id/notify",
  requireLeaderSession("leader"),
  async (req: Request, res: Response) => {
    try {
      const [event] = await db
        .select()
        .from(eventsTable)
        .where(eq(eventsTable.id, req.params.id));
      if (!event) return res.status(404).json({ error: "Event not found" });

      if (!eventNotifyAllowed(event.last_notified_at ?? null)) {
        return res
          .status(429)
          .json({ error: "This event was already announced in the last 24 hours" });
      }

      // Gender-targeted events push to matching members/visitors; leaders and
      // super-admins always hear about every event. Untargeted events push to
      // every subscriber.
      let profileIds: string[] | "all" = "all";
      if (event.target_gender) {
        const rows = await db
          .select({ id: profilesTable.id })
          .from(profilesTable)
          .where(
            or(
              inArray(profilesTable.role, ["leader", "super_admin"]),
              eq(profilesTable.gender, event.target_gender),
            ),
          );
        profileIds = rows.map((r) => r.id);
      }

      const sent = await sendPushToProfiles(
        profileIds,
        eventPushPayload({
          id: event.id,
          title: event.title,
          date: event.date,
          time: event.time,
        }),
      );

      await db
        .update(eventsTable)
        .set({ last_notified_at: new Date() })
        .where(eq(eventsTable.id, event.id));

      return res.json({ sent });
    } catch (err) {
      req.log.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);
```

(`eq`, `or`, `inArray`, `profilesTable` are already imported at the top of events.ts.)

- [ ] **Step 2: Typecheck + run all api-server tests**

Run: `pnpm --filter=@workspace/api-server typecheck` then `pnpm --filter=@workspace/api-server test`
Expected: both PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/routes/events.ts
git commit -m "feat(push): leader notify-members endpoint with 24h cap and gender targeting"
```

---

### Task 7: Check-in-open push in the job tick

**Files:**
- Modify: `artifacts/api-server/src/jobs/followUpGenerator.ts`

- [ ] **Step 1: Wire the push into `tick()`**

Add to the imports in `followUpGenerator.ts`:

```ts
import { pushSendLogTable } from "@workspace/db";
import { windowJustOpened, checkinOpenPayload } from "../lib/pushLogic";
import { sendPushToProfiles } from "../lib/pushSender";
```

(`pushSendLogTable` joins the existing `@workspace/db` import list.)

Inside `tick()`, after the existing `--- 2. Check-in Reminders ---` block (which already loaded `activeWindow` for today), add:

```ts
    // --- 3. Check-in OPEN push — free web push to every subscriber the moment
    // the window opens. Dedupe is DB-backed (push_send_log) so a Render restart
    // inside the grace period cannot double-send.
    if (activeWindow.length > 0) {
      const w = activeWindow[0];
      const opened = windowJustOpened(
        [
          {
            day_of_week: w.day_of_week,
            start_time: w.start_time,
            end_time: w.end_time,
            enabled: w.enabled,
          },
        ],
        dayOfWeek,
        hhmm,
      );
      if (opened) {
        const claimed = await db
          .insert(pushSendLogTable)
          .values({ kind: "checkin_open", sent_on: today })
          .onConflictDoNothing()
          .returning();
        if (claimed.length > 0) {
          logger.info("[followUpGenerator] Check-in window opened — sending push…");
          const sent = await sendPushToProfiles("all", checkinOpenPayload());
          logger.info({ sent }, "[followUpGenerator] Check-in open push complete");
        }
      }
    }
```

Note: `tick()` computes `hhmm` via its local `getSastNow()`; `today` is already defined at the top of `tick()`.

- [ ] **Step 2: Typecheck + tests**

Run: `pnpm --filter=@workspace/api-server typecheck` then `pnpm --filter=@workspace/api-server test`
Expected: both PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/jobs/followUpGenerator.ts
git commit -m "feat(push): send check-in-open push from job tick with DB dedupe"
```

---

### Task 8: PWA shell — icons, manifest, service worker, registration

**Files:**
- Create: `artifacts/api-server/src/scripts/generatePwaIcons.ts`
- Create: `artifacts/jg-youth/public/manifest.webmanifest`
- Create: `artifacts/jg-youth/public/sw.js`
- Create (generated): `artifacts/jg-youth/public/icon-192.png`, `artifacts/jg-youth/public/icon-512.png`
- Modify: `artifacts/jg-youth/index.html`
- Modify: `artifacts/jg-youth/src/main.tsx`

- [ ] **Step 1: Icon generation script**

Create `artifacts/api-server/src/scripts/generatePwaIcons.ts` (lives in api-server because `sharp` is installed there; same pattern as `migrateAvatarsToStorage.ts`):

```ts
/**
 * One-off: rasterize the jg-youth favicon.svg into PWA icons.
 * Run: pnpm --filter=@workspace/api-server exec tsx src/scripts/generatePwaIcons.ts
 */
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "../../../jg-youth/public");
const svg = fs.readFileSync(path.join(publicDir, "favicon.svg"));

for (const size of [192, 512]) {
  await sharp(svg, { density: 512 })
    .resize(size, size, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toFile(path.join(publicDir, `icon-${size}.png`));
  console.log(`icon-${size}.png written`);
}
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter=@workspace/api-server exec tsx src/scripts/generatePwaIcons.ts`
Expected: `icon-192.png written` and `icon-512.png written`; both files exist in `artifacts/jg-youth/public/`. Open them to sanity-check they aren't blank.

- [ ] **Step 3: Manifest**

Create `artifacts/jg-youth/public/manifest.webmanifest`:

```json
{
  "name": "Jeremiah Generation Youth",
  "short_name": "JG Youth",
  "description": "Register, check in, and connect with the JG Youth community.",
  "start_url": "/my",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#2A9D8F",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 4: Service worker**

Create `artifacts/jg-youth/public/sw.js`:

```js
/* JG Youth service worker: web push display + click-through. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* non-JSON payload — show defaults */
  }
  const title = data.title || "JG Youth";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url || "/my" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/my";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if ("focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      })
  );
});
```

- [ ] **Step 5: Link manifest + iOS meta in `index.html`**

In `artifacts/jg-youth/index.html`, add inside `<head>` after the favicon link:

```html
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#2A9D8F" />
    <link rel="apple-touch-icon" href="/icon-192.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="JG Youth" />
```

- [ ] **Step 6: Register the service worker**

In `artifacts/jg-youth/src/main.tsx`, add just before the `createRoot(...)` call:

```ts
// Register the push/PWA service worker (no-op where unsupported).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((err) => {
    console.error("Service worker registration failed:", err);
  });
}
```

- [ ] **Step 7: Typecheck + build check**

Run: `pnpm --filter=@workspace/jg-youth typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/scripts/generatePwaIcons.ts artifacts/jg-youth/public/manifest.webmanifest artifacts/jg-youth/public/sw.js artifacts/jg-youth/public/icon-192.png artifacts/jg-youth/public/icon-512.png artifacts/jg-youth/index.html artifacts/jg-youth/src/main.tsx
git commit -m "feat(push): PWA shell — manifest, icons, service worker registration"
```

---

### Task 9: Frontend push client helper

**Files:**
- Create: `artifacts/jg-youth/src/lib/pushClient.ts`

- [ ] **Step 1: Implement**

Create `artifacts/jg-youth/src/lib/pushClient.ts`:

```ts
/**
 * Browser-side web push helpers. Platform notes:
 * - Android/desktop Chrome: PushManager available in the normal tab.
 * - iOS 16.4+: PushManager exists ONLY when running installed to the home
 *   screen (standalone). In a plain Safari tab isPushSupported() is false.
 * - iOS < 16.4: never supported.
 */
import { apiFetch } from "./api";

export type PushSetupState =
  | "unsupported" // no push here, and not an iOS-install candidate
  | "ios-needs-install" // iOS Safari tab: push works after Add to Home Screen
  | "blocked" // user denied the permission prompt
  | "ready" // can subscribe now
  | "subscribed"; // this device already has an active subscription

export function isPushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export async function getPushSetupState(): Promise<PushSetupState> {
  if (!isPushSupported()) {
    return isIos() && !isStandalone() ? "ios-needs-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission === "granted") {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) return "subscribed";
  }
  return "ready";
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function subscribeToPush(): Promise<
  "subscribed" | "denied" | "error"
> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";

    const keyRes = await apiFetch("/api/push/public-key");
    if (!keyRes.ok) return "error";
    const { public_key } = (await keyRes.json()) as { public_key: string };

    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key),
    });

    const save = await apiFetch("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify(sub.toJSON()),
    });
    if (!save.ok) {
      await sub.unsubscribe().catch(() => {});
      return "error";
    }
    return "subscribed";
  } catch (err) {
    console.error("subscribeToPush failed:", err);
    return "error";
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await apiFetch("/api/push/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    await sub.unsubscribe();
  } catch (err) {
    console.error("unsubscribeFromPush failed:", err);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter=@workspace/jg-youth typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/jg-youth/src/lib/pushClient.ts
git commit -m "feat(push): frontend push client helper"
```

---

### Task 10: NotificationSetupCard on the member dashboard

**Files:**
- Create: `artifacts/jg-youth/src/components/member/NotificationSetupCard.tsx`
- Modify: `artifacts/jg-youth/src/pages/my.tsx`

- [ ] **Step 1: Create the card**

Create `artifacts/jg-youth/src/components/member/NotificationSetupCard.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Bell, BellOff, Share, PlusSquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  getPushSetupState,
  subscribeToPush,
  unsubscribeFromPush,
  type PushSetupState,
} from "@/lib/pushClient";

const DISMISS_KEY = "jg_push_card_dismissed";

/**
 * Platform-aware "enable notifications" card. Hides itself when push can
 * never work here (old iOS, unsupported browsers) or after dismissal.
 */
export function NotificationSetupCard() {
  const { toast } = useToast();
  const [state, setState] = useState<PushSetupState | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === "1",
  );

  useEffect(() => {
    getPushSetupState().then(setState).catch(() => setState("unsupported"));
  }, []);

  if (dismissed || state === "loading" || state === "unsupported") return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  const handleEnable = async () => {
    setBusy(true);
    const result = await subscribeToPush();
    setBusy(false);
    if (result === "subscribed") {
      setState("subscribed");
      toast({
        title: "Notifications on 🎉",
        description: "We'll let you know when check-in opens and events drop.",
      });
    } else if (result === "denied") {
      setState("blocked");
    } else {
      toast({
        title: "Could not enable notifications",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    }
  };

  const handleDisable = async () => {
    setBusy(true);
    await unsubscribeFromPush();
    setBusy(false);
    setState("ready");
    toast({ title: "Notifications turned off" });
  };

  if (state === "subscribed") {
    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex items-center justify-between gap-3 py-3">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Bell className="h-4 w-4 text-primary" />
            Notifications are on for this device.
          </p>
          <Button variant="ghost" size="sm" onClick={handleDisable} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellOff className="h-4 w-4" />}
            <span className="ml-1">Turn off</span>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state === "blocked") {
    return (
      <Card className="border-border">
        <CardContent className="flex items-center justify-between gap-3 py-3">
          <p className="text-sm text-muted-foreground">
            Notifications are blocked for this site. Enable them in your
            browser settings to hear when check-in opens.
          </p>
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Dismiss
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state === "ios-needs-install") {
    return (
      <Card className="border-primary/30">
        <CardContent className="space-y-3 py-4">
          <p className="flex items-center gap-2 font-medium text-foreground">
            <Bell className="h-4 w-4 text-primary" />
            Get notified when check-in opens
          </p>
          <ol className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <Share className="h-4 w-4 shrink-0 text-primary" />
              1. Tap the <strong>Share</strong> button in Safari
            </li>
            <li className="flex items-center gap-2">
              <PlusSquare className="h-4 w-4 shrink-0 text-primary" />
              2. Choose <strong>Add to Home Screen</strong>
            </li>
            <li className="flex items-center gap-2">
              <Bell className="h-4 w-4 shrink-0 text-primary" />
              3. Open <strong>JG Youth</strong> from your home screen and turn
              on notifications here
            </li>
          </ol>
          <p className="text-xs text-muted-foreground">Needs iOS 16.4 or newer.</p>
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Not now
          </Button>
        </CardContent>
      </Card>
    );
  }

  // state === "ready"
  return (
    <Card className="border-primary/30">
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 font-medium text-foreground">
            <Bell className="h-4 w-4 text-primary" />
            Never miss check-in
          </p>
          <p className="text-sm text-muted-foreground">
            Get a notification when check-in opens and when new events drop.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleEnable} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Bell className="mr-1 h-4 w-4" />}
            Enable notifications
          </Button>
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Not now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Mount it on the dashboard**

In `artifacts/jg-youth/src/pages/my.tsx`:

1. Add the import next to the other `@/components/member/*` imports:

```tsx
import { NotificationSetupCard } from "@/components/member/NotificationSetupCard";
```

2. Render `<NotificationSetupCard />` as the **first element inside the main signed-in content container** (the wrapper that holds the dashboard sections/tabs — locate it by finding where `StreakWidget` or the profile section renders and insert the card above that block, spanning full width).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter=@workspace/jg-youth typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/jg-youth/src/components/member/NotificationSetupCard.tsx artifacts/jg-youth/src/pages/my.tsx
git commit -m "feat(push): notification setup card on member dashboard"
```

---

### Task 11: "Notify members" button for leaders

**Files:**
- Modify: `artifacts/jg-youth/src/components/panels/EventsPanel.tsx`

- [ ] **Step 1: Add the notify handler**

In `EventsPanel.tsx`, extend the lucide import with `Bell` and `Loader2`:

```ts
import { Calendar, Trash2, MapPin, Users, Globe, ImagePlus, X, Bell, Loader2 } from "lucide-react";
```

Add state + handler inside the component (below the `genderCounts` effect — note it reuses this file's existing auth-header pattern, not `apiFetch`):

```tsx
  const [notifyingId, setNotifyingId] = useState<string | null>(null);

  const handleNotifyMembers = async (event: any) => {
    setNotifyingId(event.id);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      try {
        const t = await getToken();
        if (t) headers["Authorization"] = `Bearer ${t}`;
      } catch {}
      try {
        const s = localStorage.getItem("jg_leader_session");
        if (s) {
          const p = JSON.parse(s);
          if (Date.now() < p.expires_at) headers["x-leader-session"] = s;
        }
      } catch {}
      const apiBase = import.meta.env.VITE_API_URL || "";
      const res = await fetch(`${apiBase}/api/events/${event.id}/notify`, {
        method: "POST",
        headers,
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({
          title: "Members notified 🔔",
          description: `Reached ${body.sent} device${body.sent === 1 ? "" : "s"}.`,
        });
      } else if (res.status === 429) {
        toast({
          title: "Already announced",
          description: "This event was already announced in the last 24 hours.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Could not notify members",
          description: body.error || "Something went wrong.",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Could not notify members",
        description: "Network error — please try again.",
        variant: "destructive",
      });
    } finally {
      setNotifyingId(null);
    }
  };
```

- [ ] **Step 2: Add the button to each event card**

In the event card JSX (the `events.map((event: any) => …)` block), locate the actions area that contains the delete button (`Trash2` / `setDeleteEventId`) and add a notify button next to it, gated the same way event management is (`canCreateEvents`):

```tsx
                    {canCreateEvents && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleNotifyMembers(event)}
                        disabled={notifyingId === event.id}
                        title="Send a push notification about this event"
                      >
                        {notifyingId === event.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Bell className="h-4 w-4" />
                        )}
                        <span className="ml-1 hidden sm:inline">Notify</span>
                      </Button>
                    )}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter=@workspace/jg-youth typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/jg-youth/src/components/panels/EventsPanel.tsx
git commit -m "feat(push): leader notify-members button on event cards"
```

---

### Task 12: Full verification

- [ ] **Step 1: Workspace-wide typecheck and tests**

Run from repo root:
```bash
pnpm run typecheck
pnpm --filter=@workspace/api-server test
```
Expected: both PASS.

- [ ] **Step 2: Generate VAPID keys (once)**

Run: `pnpm --filter=@workspace/api-server exec web-push generate-vapid-keys`
Expected: prints a public and private key pair. **Do not commit them.**

- [ ] **Step 3: Local smoke test**

1. Add to the api-server local env (`.env`): `VAPID_PUBLIC_KEY=…`, `VAPID_PRIVATE_KEY=…`, `VAPID_SUBJECT=mailto:matheatauunam@gmail.com`.
2. `pnpm dev` from repo root; open the app in Chrome; sign in as a member.
3. Confirm the NotificationSetupCard appears → Enable → permission prompt → card flips to "Notifications are on".
4. Trigger `POST /api/push/test` (e.g. from DevTools console: `fetch("/api/push/test", {method:"POST"})` — while signed in Clerk cookies ride along, or use the card's device) and confirm a desktop notification appears **with the tab in the background**.
5. As a leader, hit "Notify" on an event → confirm the notification arrives and a second click within 24h returns the "already announced" toast.

- [ ] **Step 4: Deploy checklist (manual, needs the user)**

1. Add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` to the Render service env (youth-connect backend) and redeploy.
2. Deploy the frontend to Vercel (normal flow).
3. On a real Android phone: open the site, enable notifications, send test push, confirm it arrives with the browser closed.
4. On a real iPhone (iOS 16.4+): follow the card's Add-to-Home-Screen steps, enable inside the installed app, send test push, confirm.
5. On the next service night: confirm the check-in-open push fires at window start (Render logs: `[followUpGenerator] Check-in open push complete`).

- [ ] **Step 5: Final commit of any fixups**

```bash
git add -A && git status  # review before committing
git commit -m "chore(push): verification fixups"
```
