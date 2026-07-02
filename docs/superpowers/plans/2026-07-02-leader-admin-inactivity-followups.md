# Leader & Super Admin Inactivity Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flag leaders and super admins who haven't checked in (stricter 1/2/4-week ladder), surface them role-badged in the Follow-up Hub, and message them with their own WhatsApp template sets resolved from their own profiles (name + phone).

**Architecture:** Extract role-aware stage/template/placeholder logic into a new pure module `src/lib/followUpStages.ts` (unit-tested, following the repo's existing `src/lib/*.test.ts` pattern), rewire the existing `followUpGenerator.ts` background job to it, add per-type seed guards for the new template types, expose `role` on the queue API, and extend the two React pages. No DB schema change (spec Option A: new `template_type` values).

**Tech Stack:** Express 5 + Drizzle ORM (api-server), Vitest, React + TanStack Query (jg-youth), PostgreSQL. Spec: `docs/superpowers/specs/2026-07-02-leader-admin-inactivity-followups-design.md`.

**Working directory:** repo root `C:\Users\Cash\Youth-Connect`. All commands below run from there.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `artifacts/api-server/src/lib/followUpStages.ts` | Create | Pure logic: role ladders (`stageForRole`), template-type mapping, placeholder substitution (fixes `[User]` vs `{{User}}` bug), fallback messages |
| `artifacts/api-server/src/lib/followUpStages.test.ts` | Create | Vitest unit tests for the above |
| `artifacts/api-server/src/jobs/followUpGenerator.ts` | Modify | Use the lib; widen both jobs to all four roles; load all three template types |
| `artifacts/api-server/src/db/index.ts` | Modify | Seed 6 new templates with per-type `WHERE NOT EXISTS` guards |
| `artifacts/api-server/src/routes/whatsapp.ts` | Modify | Queue GET returns `role` |
| `artifacts/api-server/src/routes/whatsappTemplates.ts` | Modify | PATCH preview-sync uses shared `applyTemplateVars` (DRY) |
| `artifacts/jg-youth/src/pages/follow-up-hub.tsx` | Modify | Role badges, stage-1 colour, copy tweak |
| `artifacts/jg-youth/src/pages/templates.tsx` | Modify | Two new template sections, placeholder hints, stage labels |

---

### Task 1: Role-aware stage & template logic (`followUpStages.ts`) — TDD

**Files:**
- Create: `artifacts/api-server/src/lib/followUpStages.ts`
- Test: `artifacts/api-server/src/lib/followUpStages.test.ts`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/followUpStages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  applyTemplateVars,
  defaultFollowUpMessage,
  isStaffRole,
  stageForRole,
  templateTypeForRole,
} from "./followUpStages";

describe("stageForRole", () => {
  it("keeps the member/visitor 2/4/6/8 ladder", () => {
    for (const role of ["member", "visitor"]) {
      expect(stageForRole(role, 0)).toBeNull();
      expect(stageForRole(role, 1)).toBeNull();
      expect(stageForRole(role, 2)).toBe(2);
      expect(stageForRole(role, 3)).toBe(2);
      expect(stageForRole(role, 4)).toBe(4);
      expect(stageForRole(role, 6)).toBe(6);
      expect(stageForRole(role, 8)).toBe(8);
      expect(stageForRole(role, 52)).toBe(8);
    }
  });

  it("uses the stricter 1/2/4 ladder for leaders and super admins", () => {
    for (const role of ["leader", "super_admin"]) {
      expect(stageForRole(role, 0)).toBeNull();
      expect(stageForRole(role, 1)).toBe(1);
      expect(stageForRole(role, 2)).toBe(2);
      expect(stageForRole(role, 3)).toBe(2);
      expect(stageForRole(role, 4)).toBe(4);
      expect(stageForRole(role, 5)).toBe(4);
      expect(stageForRole(role, 52)).toBe(4);
    }
  });

  it("returns null for missing weeks", () => {
    expect(stageForRole("member", null)).toBeNull();
    expect(stageForRole("leader", undefined)).toBeNull();
  });
});

describe("isStaffRole", () => {
  it("is true only for leader and super_admin", () => {
    expect(isStaffRole("leader")).toBe(true);
    expect(isStaffRole("super_admin")).toBe(true);
    expect(isStaffRole("member")).toBe(false);
    expect(isStaffRole("visitor")).toBe(false);
  });
});

describe("templateTypeForRole", () => {
  it("maps each role to its template set", () => {
    expect(templateTypeForRole("member")).toBe("follow_up");
    expect(templateTypeForRole("visitor")).toBe("follow_up");
    expect(templateTypeForRole("leader")).toBe("follow_up_leader");
    expect(templateTypeForRole("super_admin")).toBe("follow_up_super_admin");
  });
});

describe("applyTemplateVars", () => {
  it("substitutes the documented [Square] placeholder form", () => {
    expect(
      applyTemplateVars("Hi [User]! — [Leader]", {
        User: "Thabo",
        Leader: "JG Youth Team",
      }),
    ).toBe("Hi Thabo! — JG Youth Team");
  });

  it("substitutes the legacy {{Curly}} form too", () => {
    expect(
      applyTemplateVars("Hi {{User}}! — {{Leader}}", {
        User: "Thabo",
        Leader: "JG Youth Team",
      }),
    ).toBe("Hi Thabo! — JG Youth Team");
  });

  it("replaces every occurrence and leaves unknown placeholders alone", () => {
    expect(applyTemplateVars("[User] and [User] at [Event]", { User: "T" })).toBe(
      "T and T at [Event]",
    );
  });
});

describe("defaultFollowUpMessage", () => {
  it("gives staff a leadership-toned fallback", () => {
    const msg = defaultFollowUpMessage("leader", 1, "Thabo");
    expect(msg).toContain("Thabo");
    expect(msg).toContain("(1w)");
    expect(msg).toContain("team");
  });

  it("keeps the member fallback wording", () => {
    expect(defaultFollowUpMessage("member", 2, "Karabo")).toBe(
      "Follow-up (2w): Hi Karabo, we miss you at JG Youth!",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C artifacts/api-server test followUpStages`
Expected: FAIL — `Cannot find module './followUpStages'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

Create `artifacts/api-server/src/lib/followUpStages.ts`:

```ts
/**
 * Role-aware follow-up ladders and template plumbing.
 *
 * Members/visitors are flagged at 2/4/6/8 weeks absent. Leaders and super
 * admins are expected weekly, so they sit on a stricter 1/2/4-week ladder
 * (4 is terminal). Each audience has its own whatsapp_templates
 * `template_type` so the message tone can differ per role.
 */

export function isStaffRole(role: string): boolean {
  return role === "leader" || role === "super_admin";
}

/** Follow-up stage (in weeks) for a role + weeks absent, or null if not due. */
export function stageForRole(
  role: string,
  weeks: number | null | undefined,
): number | null {
  if (weeks == null) return null;
  if (isStaffRole(role)) {
    if (weeks >= 4) return 4;
    if (weeks >= 2) return 2;
    if (weeks >= 1) return 1;
    return null;
  }
  if (weeks >= 8) return 8;
  if (weeks >= 6) return 6;
  if (weeks >= 4) return 4;
  if (weeks >= 2) return 2;
  return null;
}

/** whatsapp_templates.template_type holding a given role's follow-up set. */
export function templateTypeForRole(role: string): string {
  if (role === "leader") return "follow_up_leader";
  if (role === "super_admin") return "follow_up_super_admin";
  return "follow_up";
}

/** All follow-up template types the generator must load. */
export const FOLLOW_UP_TEMPLATE_TYPES = [
  "follow_up",
  "follow_up_leader",
  "follow_up_super_admin",
];

/**
 * Replace template placeholders. Templates are documented with the
 * square-bracket form ([User], [Leader]); the curly form ({{User}}) is kept
 * for any live templates hand-edited to the old generator syntax.
 */
export function applyTemplateVars(
  text: string,
  vars: Record<string, string>,
): string {
  let result = text;
  for (const [k, v] of Object.entries(vars)) {
    result = result.split(`[${k}]`).join(v).split(`{{${k}}}`).join(v);
  }
  return result;
}

/** Built-in fallback when no template exists for a role + stage. */
export function defaultFollowUpMessage(
  role: string,
  stage: number,
  firstName: string,
): string {
  if (isStaffRole(role)) {
    return `Follow-up (${stage}w): Hi ${firstName}, we've missed you at JG Youth — the team isn't the same without you!`;
  }
  return `Follow-up (${stage}w): Hi ${firstName}, we miss you at JG Youth!`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C artifacts/api-server test followUpStages`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/followUpStages.ts artifacts/api-server/src/lib/followUpStages.test.ts
git commit -m "feat(follow-ups): role-aware stage ladders + placeholder fix in new lib"
```

---

### Task 2: Rewire the generator job to the new lib

**Files:**
- Modify: `artifacts/api-server/src/jobs/followUpGenerator.ts`

The job currently hard-filters `role IN ('member','visitor')` in both `generateCheckinReminders()` and `generateFollowUpQueue()`, has its own broken `applyTemplateVars` (`{{User}}` only), a member-only `stageFor()`, and a `HAVING … 2 weeks` cutoff that would hide leaders due at 1 week.

- [ ] **Step 1: Replace the local helpers with lib imports**

At the top of `followUpGenerator.ts`, delete the local `applyTemplateVars` function (lines 21–27), the `STAGES` const and `Stage` type (lines 30–31), and the local `stageFor` function (lines 33–39). Replace the import block so it reads:

```ts
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  db,
  profilesTable,
  attendanceTable,
  whatsappTemplatesTable,
  whatsappAutomationSettingsTable,
  followUpQueueTable,
  checkinWindowsTable,
} from "@workspace/db";
import {
  applyTemplateVars,
  defaultFollowUpMessage,
  FOLLOW_UP_TEMPLATE_TYPES,
  isStaffRole,
  stageForRole,
  templateTypeForRole,
} from "../lib/followUpStages";
import { logger } from "../lib/logger";
```

(Note: `count` and `notInArray` were already unused in the original import; drop them.)

Update the doc comment at the top of the file (lines 1–10) to mention all roles:

```ts
/**
 * Follow-up queue generator – background job.
 *
 * Checks the `whatsapp_automation_settings` table every 60 s and, when the
 * configured day + time matches "right now" (SAST), generates pending entries
 * in `follow_up_queue` for everyone overdue: members/visitors at 2/4/6/8
 * weeks absent, leaders/super admins on a stricter 1/2/4-week ladder.
 *
 * Messages are NOT sent automatically – leaders review & approve them in the
 * Follow-up Hub UI first.
 */
```

- [ ] **Step 2: Widen `generateCheckinReminders()` to all roles**

In `generateCheckinReminders()`, change the overdue query to select `role` and drop the member/visitor restriction. Replace the `.select({...})` and `.where(...)` so the query reads:

```ts
  const overdueMembers = await db
    .select({
      id: profilesTable.id,
      full_name: profilesTable.full_name,
      phone: profilesTable.phone,
      role: profilesTable.role,
    })
    .from(profilesTable)
    .leftJoin(
      attendanceTable,
      and(
        eq(profilesTable.id, attendanceTable.profile_id),
        eq(attendanceTable.session_date, today),
      ),
    )
    .where(
      and(
        inArray(profilesTable.role, [
          "member",
          "visitor",
          "leader",
          "super_admin",
        ]),
        eq(profilesTable.whatsapp_opt_in, true),
        sql`btrim(${profilesTable.phone}) <> ''`,
        sql`${attendanceTable.id} IS NULL`, // No check-in today
      ),
    );
```

Then give staff their own wording in the insert loop. Replace the `inserts.push({...})` body with:

```ts
    inserts.push({
      profile_id: row.id,
      stage_weeks: 0,
      weeks_absent: 0,
      message_preview: isStaffRole(row.role)
        ? `Hi ${firstName(row.full_name)}, leaders check in too — don't forget to check in for JG Youth tonight!`
        : `Hi ${firstName(row.full_name)}, don't forget to check in for JG Youth tonight!`,
      template_id: null,
      status: "pending",
    });
```

- [ ] **Step 3: Widen `generateFollowUpQueue()` to all roles with role-keyed ladders and templates**

Three changes inside `generateFollowUpQueue()`:

**(a) attended rows** — select `role`, widen the role filter, group by role, and lower the HAVING cutoff to 1 week (the role ladder decides who's actually due; members at 1 week map to `null` and are skipped):

```ts
  const attendedRows = await db
    .select({
      id: profilesTable.id,
      full_name: profilesTable.full_name,
      phone: profilesTable.phone,
      role: profilesTable.role,
      weeks_absent: sql<number>`floor((current_date - max(${attendanceTable.session_date}::date)) / 7)::int`,
    })
    .from(profilesTable)
    .innerJoin(attendanceTable, eq(profilesTable.id, attendanceTable.profile_id))
    .where(
      inArray(profilesTable.role, [
        "member",
        "visitor",
        "leader",
        "super_admin",
      ]),
    )
    .groupBy(
      profilesTable.id,
      profilesTable.full_name,
      profilesTable.phone,
      profilesTable.role,
    )
    .having(
      sql`max(${attendanceTable.session_date}::date) <= (current_date - interval '1 week')`,
    );
```

**(b) never-attended rows** — same widening (role select + filter + groupBy) and the 1-week registration cutoff:

```ts
  let neverAttendedRows: typeof attendedRows = [];
  if (includeNever) {
    neverAttendedRows = await db
      .select({
        id: profilesTable.id,
        full_name: profilesTable.full_name,
        phone: profilesTable.phone,
        role: profilesTable.role,
        weeks_absent: sql<number>`floor(EXTRACT(EPOCH FROM age(current_date, ${profilesTable.created_at}::date)) / 604800)::int`,
      })
      .from(profilesTable)
      .leftJoin(attendanceTable, eq(profilesTable.id, attendanceTable.profile_id))
      .where(
        and(
          inArray(profilesTable.role, [
            "member",
            "visitor",
            "leader",
            "super_admin",
          ]),
          sql`${profilesTable.created_at}::date <= (current_date - interval '1 week')`,
        ),
      )
      .groupBy(
        profilesTable.id,
        profilesTable.full_name,
        profilesTable.phone,
        profilesTable.role,
        profilesTable.created_at,
      )
      .having(sql`count(${attendanceTable.id}) = 0`);
  }
```

**(c) templates + entry generation** — load all three template types into a `type:stage` map, then pick ladder/template/fallback by role. Replace the template-loading block (step "3. Load follow_up templates") and the generation loop:

```ts
  // 3. Load follow-up templates for every audience (member/leader/super-admin)
  const templates = await db
    .select()
    .from(whatsappTemplatesTable)
    .where(
      inArray(whatsappTemplatesTable.template_type, FOLLOW_UP_TEMPLATE_TYPES),
    );

  const templateByKey: Record<string, (typeof templates)[0]> = {};
  for (const t of templates) {
    if (t.stage_weeks != null) {
      templateByKey[`${t.template_type}:${t.stage_weeks}`] = t;
    }
  }
```

and in the loop (step "5. Generate queue entries"), replace the stage/template/preview logic:

```ts
  for (const row of allOverdue) {
    const weeks = Number(row.weeks_absent);
    const stage = stageForRole(row.role, weeks);
    if (!stage) continue;

    // Skip if already queued at this stage
    if (existingSet.has(`${row.id}:${stage}`)) continue;

    const template = templateByKey[`${templateTypeForRole(row.role)}:${stage}`];
    const messagePreview = template
      ? applyTemplateVars(template.message_text, {
          User: firstName(row.full_name),
          Leader: "JG Youth Team",
        })
      : defaultFollowUpMessage(row.role, stage, firstName(row.full_name));

    inserts.push({
      profile_id: row.id,
      stage_weeks: stage,
      weeks_absent: weeks,
      message_preview: messagePreview,
      template_id: template?.id ?? null,
      status: "pending",
    });
  }
```

- [ ] **Step 4: Typecheck and run the full api-server test suite**

Run: `pnpm -C artifacts/api-server typecheck`
Expected: exit 0, no errors.

Run: `pnpm -C artifacts/api-server test`
Expected: PASS — all suites green (nothing else imports the removed local helpers).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/jobs/followUpGenerator.ts
git commit -m "feat(follow-ups): flag leaders & super admins on stricter 1/2/4-week ladder"
```

---

### Task 3: Seed the leader & super-admin template sets

**Files:**
- Modify: `artifacts/api-server/src/db/index.ts` (after the existing template seed block, ~line 168)

The existing seed only fires `WHERE NOT EXISTS (SELECT 1 FROM whatsapp_templates)` — i.e. on an empty table — so the live DB would never receive the new types. These statements are guarded **per type** instead.

- [ ] **Step 1: Add the two guarded seed statements**

In `artifacts/api-server/src/db/index.ts`, directly after the existing `INSERT INTO "whatsapp_templates" … WHERE NOT EXISTS (SELECT 1 FROM "whatsapp_templates");` statement (ends ~line 168), add:

```sql
-- Seed leader & super-admin follow-up templates (2026-07): stricter 1/2/4-week
-- ladder with role-appropriate tone. Guarded PER TYPE (not on an empty table)
-- so databases that already have member templates pick these up on boot.
INSERT INTO "whatsapp_templates" ("template_type", "stage_weeks", "message_text", "color_hex")
  SELECT * FROM (VALUES
    ('follow_up_leader', 1, 'Hi [User]! 👋 We missed you at JG Youth this week — the team isn''t the same without you. See you this Friday? — [Leader]', '#60A5FA'),
    ('follow_up_leader', 2, 'Hey [User], it''s been two weeks since we''ve seen you at JG Youth. The youth look up to you and we''d love to have you back leading with us. Is everything okay? — [Leader]', '#FACC15'),
    ('follow_up_leader', 4, 'Hi [User], it''s been a month since you''ve been at JG Youth. We''re thinking of you and would really value catching up — please reach out when you can. — [Leader]', '#EF4444')
  ) AS seed(template_type, stage_weeks, message_text, color_hex)
  WHERE NOT EXISTS (SELECT 1 FROM "whatsapp_templates" WHERE "template_type" = 'follow_up_leader');

INSERT INTO "whatsapp_templates" ("template_type", "stage_weeks", "message_text", "color_hex")
  SELECT * FROM (VALUES
    ('follow_up_super_admin', 1, 'Hi [User]! 👋 We missed you at JG Youth this week. Hope all is well — see you Friday? — [Leader]', '#60A5FA'),
    ('follow_up_super_admin', 2, 'Hey [User], two weeks without you at JG Youth! The team needs your leadership — anything we can help carry? — [Leader]', '#FACC15'),
    ('follow_up_super_admin', 4, 'Hi [User], it''s been a month since we''ve seen you at JG Youth. Let''s catch up soon — the ministry misses you. — [Leader]', '#EF4444')
  ) AS seed(template_type, stage_weeks, message_text, color_hex)
  WHERE NOT EXISTS (SELECT 1 FROM "whatsapp_templates" WHERE "template_type" = 'follow_up_super_admin');
```

Note: this file is a SQL string executed on boot; single quotes inside messages are escaped by doubling (`isn''t`), matching the existing seed rows.

- [ ] **Step 2: Typecheck (the file is TS containing a SQL template string)**

Run: `pnpm -C artifacts/api-server typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/db/index.ts
git commit -m "feat(follow-ups): seed leader & super-admin template sets with per-type guards"
```

---

### Task 4: Queue API returns `role`; template PATCH-sync uses shared substitution

**Files:**
- Modify: `artifacts/api-server/src/routes/whatsapp.ts:159-172` (queue GET select)
- Modify: `artifacts/api-server/src/routes/whatsappTemplates.ts:110-121` (PATCH preview sync)

- [ ] **Step 1: Add `role` to the queue GET response**

In `artifacts/api-server/src/routes/whatsapp.ts`, in the `GET /whatsapp/queue` handler's `.select({...})` (line ~160), add one line after `phone`:

```ts
          phone: profilesTable.phone,
          role: profilesTable.role,
```

- [ ] **Step 2: DRY the PATCH preview-sync onto `applyTemplateVars`**

In `artifacts/api-server/src/routes/whatsappTemplates.ts`, add the import:

```ts
import { applyTemplateVars } from "../lib/followUpStages";
```

and replace the manual substitution inside the PATCH handler (lines 110–121):

```ts
        for (const item of pendingQueue) {
          const firstName = item.full_name?.split(" ")[0] || "there";
          const newPreview = applyTemplateVars(updated.message_text, {
            User: firstName,
            Leader: "JG Youth Team",
          });

          await db
            .update(followUpQueueTable)
            .set({ message_preview: newPreview })
            .where(eq(followUpQueueTable.id, item.id));
        }
```

- [ ] **Step 3: Typecheck + tests**

Run: `pnpm -C artifacts/api-server typecheck`
Expected: exit 0.

Run: `pnpm -C artifacts/api-server test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/whatsapp.ts artifacts/api-server/src/routes/whatsappTemplates.ts
git commit -m "feat(follow-ups): expose role on queue API + share placeholder substitution"
```

---

### Task 5: Role badges in the Follow-up Hub

**Files:**
- Modify: `artifacts/jg-youth/src/pages/follow-up-hub.tsx`

- [ ] **Step 1: Extend the type, colours, and add a badge map**

In `follow-up-hub.tsx`:

**(a)** Add `role` to `QueueEntry` (after `phone`, line ~35):

```ts
  phone: string | null;
  role: string | null;
```

**(b)** Add the new stage-1 colour to `STAGE_COLORS` (line ~74):

```ts
const STAGE_COLORS: Record<number, string> = {
  1: "#60A5FA",
  2: "#FACC15",
  4: "#FB923C",
  6: "#F87171",
  8: "#EF4444",
};
```

**(c)** Below `STAGE_COLORS`, add:

```ts
const ROLE_BADGES: Record<string, { label: string; className: string }> = {
  leader: { label: "Leader", className: "bg-violet-500/15 text-violet-600" },
  super_admin: { label: "Super Admin", className: "bg-pink-500/15 text-pink-600" },
};
```

- [ ] **Step 2: Render the badge on pending cards and sent rows**

**(a)** In the pending-card badge row (the `div` with the stage dot + `{badgeText}` span, lines ~435–446), add after the stage badge `</span>`:

```tsx
                          {entry.role && ROLE_BADGES[entry.role] && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ROLE_BADGES[entry.role].className}`}
                            >
                              {ROLE_BADGES[entry.role].label}
                            </span>
                          )}
```

**(b)** In the "Recently Sent" card subtitle (line ~529–531), prefix the role:

```tsx
                        <p className="text-xs text-muted-foreground">
                          {entry.role && ROLE_BADGES[entry.role]
                            ? `${ROLE_BADGES[entry.role].label} · `
                            : ""}
                          {entry.stage_weeks === 0 ? "Check-in Reminder" : `${entry.stage_weeks}w stage`}
                        </p>
```

**(c)** Update the tab description copy (line ~263):

```tsx
                <p className="text-sm text-muted-foreground">Generated queue of members absent 2+ weeks and leaders/admins absent 1+ week, plus check-in reminders.</p>
```

- [ ] **Step 3: Typecheck the frontend**

Run: `pnpm -C artifacts/jg-youth typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add artifacts/jg-youth/src/pages/follow-up-hub.tsx
git commit -m "feat(follow-ups): role badges + 1-week stage colour in Follow-up Hub"
```

---

### Task 6: Leader & super-admin sections on the Templates page

**Files:**
- Modify: `artifacts/jg-youth/src/pages/templates.tsx`

- [ ] **Step 1: Hints, labels, imports**

**(a)** Extend `PLACEHOLDER_HINTS` (line ~23):

```ts
const PLACEHOLDER_HINTS: Record<string, string[]> = {
  follow_up: ["[User]", "[Leader]"],
  follow_up_leader: ["[User]", "[Leader]"],
  follow_up_super_admin: ["[User]", "[Leader]"],
  event_creation: ["[User]", "[Event]", "[Date]", "[Time]", "[Location]"],
};
```

**(b)** Replace `stageLabel` (line ~28) so all three follow-up types get week labels (with singular "1 week"):

```ts
const FOLLOW_UP_TYPES = ["follow_up", "follow_up_leader", "follow_up_super_admin"];

function stageLabel(t: WhatsappTemplate): string {
  if (t.template_type === "event_creation") return "Event announcement";
  if (FOLLOW_UP_TYPES.includes(t.template_type) && t.stage_weeks != null)
    return `${t.stage_weeks} week${t.stage_weeks === 1 ? "" : "s"} absent`;
  return t.template_type;
}
```

**(c)** Extend the lucide import (line 5):

```ts
import { MessageSquare, Loader2, Save, Megaphone, ShieldCheck, Crown } from "lucide-react";
```

- [ ] **Step 2: Filter the new sets and render two new sections**

**(a)** After the existing `followUps` / `eventTemplates` filters (lines ~152–157), add:

```ts
  const leaderFollowUps = (templates ?? [])
    .filter((t) => t.template_type === "follow_up_leader")
    .sort((a, b) => (a.stage_weeks ?? 0) - (b.stage_weeks ?? 0));
  const adminFollowUps = (templates ?? [])
    .filter((t) => t.template_type === "follow_up_super_admin")
    .sort((a, b) => (a.stage_weeks ?? 0) - (b.stage_weeks ?? 0));
```

**(b)** Rename the existing follow-up section heading (line ~210) to make the audience explicit:

```tsx
                  Member follow-ups (by weeks absent)
```

**(c)** After the closing `</section>` of the member follow-ups section (line ~224), add the two new sections:

```tsx
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">
                  Leader follow-ups (stricter 1/2/4-week ladder)
                </h2>
              </div>
              {leaderFollowUps.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {leaderFollowUps.map((t) => (
                    <TemplateCard key={t.id} template={t} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No leader follow-up templates configured.
                </p>
              )}
            </section>

            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Crown className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">
                  Super admin follow-ups (stricter 1/2/4-week ladder)
                </h2>
              </div>
              {adminFollowUps.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {adminFollowUps.map((t) => (
                    <TemplateCard key={t.id} template={t} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No super admin follow-up templates configured.
                </p>
              )}
            </section>
```

- [ ] **Step 3: Typecheck the frontend**

Run: `pnpm -C artifacts/jg-youth typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add artifacts/jg-youth/src/pages/templates.tsx
git commit -m "feat(follow-ups): leader & super-admin template sections on Templates page"
```

---

### Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full api-server suite + typechecks**

Run each; all must succeed:

```bash
pnpm -C artifacts/api-server test
pnpm -C artifacts/api-server typecheck
pnpm -C artifacts/jg-youth typecheck
```

Expected: all green / exit 0.

- [ ] **Step 2: Verify no stray references to the removed local helpers**

Run: `git grep -n "STAGES\b\|stageFor(" artifacts/api-server/src -- ':!*.test.ts'`
Expected: no matches (the pattern matches the old `stageFor(`/`STAGES` helpers only, not the new `stageForRole(`). Exit code 1 from git grep means "nothing found" — that's the pass condition.

- [ ] **Step 3: Commit anything outstanding (should be nothing)**

Run: `git status --short`
Expected: clean tree.

**Post-deploy manual check (not part of this plan's automated steps):** on Render after deploy, boot logs show the seed ran; in the app, Templates page shows the two new sections with 3 cards each; "Generate Now" in the Follow-up Hub flags any leader absent 1+ week with a role badge and leader-toned preview going to that leader's own number.
