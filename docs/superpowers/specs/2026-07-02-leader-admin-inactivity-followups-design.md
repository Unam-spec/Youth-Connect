# Leader & Super Admin Inactivity Follow-ups — Design

**Date:** 2026-07-02
**Status:** Approved design, pending implementation plan
**Target:** Express api-server (live Render backend) + jg-youth React frontend, on `main`

## Problem

The inactivity system only watches members and visitors. Both background jobs in
`artifacts/api-server/src/jobs/followUpGenerator.ts` hard-filter
`role IN ('member', 'visitor')`, so a leader or super admin who stops checking in
is never flagged, never appears in the Follow-up Hub, and never receives a
re-engagement message. Leaders and super admins also need their own message
templates — the member-facing "we miss you at JG Youth" tone is wrong for someone
who carries responsibility for the group.

## Goal

1. Leaders and super admins who haven't checked in get flagged into the existing
   `follow_up_queue`, on a **stricter ladder** than members (they're expected weekly).
2. They can be sent messages through the existing hub → approve → wa.me flow,
   delivered to the phone number on **their own profile** (name and number resolved
   from their account, same as members today).
3. Each role gets **its own template set** with role-appropriate wording, editable
   on the Templates page.
4. The day-of "don't forget to check in tonight" reminder also covers leaders and
   super admins.

## Decisions made (with user)

| Decision | Choice |
|---|---|
| Who sees flagged leaders/admins | Everyone with hub access — same queue, role-badged (no role-gating, per project preference) |
| Cadence | Stricter for leaders/admins: **1 / 2 / 4 weeks** (4 = terminal stage); members stay on 2/4/6/8 |
| Scope | Both weekly follow-ups **and** day-of check-in reminders |
| Template modelling | **Option A**: new `template_type` values, no schema change (rejected Option B: `audience_role` column — needs a live-DB migration and client type regen for no extra behavior) |

## Design

### 1. Role-aware flagging (`followUpGenerator.ts`)

- `stageFor()` becomes role-aware:
  - `member` / `visitor`: unchanged — 2/4/6/8, `weeks >= 8 → 8`.
  - `leader` / `super_admin`: 1/2/4 — `weeks >= 4 → 4`, `weeks >= 2 → 2`, `weeks >= 1 → 1`.
- `generateFollowUpQueue()` widens its role filter to all four roles and picks the
  ladder + template set by the row's role. The `include_never_attended` setting
  applies to all roles the same way (weeks since registration).
- `generateCheckinReminders()` drops the member/visitor filter. Requirements stay:
  `whatsapp_opt_in = true` and non-empty phone. Leaders/admins get role-appropriate
  wording (e.g. "Hi {name}, leaders check in too — don't forget tonight!").
- Queue rows are unchanged in shape: `profile_id`, `stage_weeks`, `weeks_absent`,
  `message_preview`, `template_id`, `status: pending`. The `stage_weeks` integer
  column already accommodates the new value `1`.

### 2. Role-specific templates (Option A)

- New `template_type` values in `whatsapp_templates` (no schema change):
  - `follow_up_leader` — used for role `leader`, stages 1, 2, 4.
  - `follow_up_super_admin` — used for role `super_admin`, stages 1, 2, 4.
- Existing `follow_up` remains the member/visitor set (2/4/6/8), untouched.
- Same placeholder convention as the rest of the app: `[User]` (recipient first
  name, from their profile) and `[Leader]` (sender sign-off). The recipient's
  phone number comes from their profile row via `profile_id` at send time —
  this is the "wired to their accounts and numbers" requirement; nothing is
  hardcoded per person.
- Fallback: if no template exists for a role+stage, the generator uses a built-in
  default message for that role (same pattern as members today).
- **Seeding:** the current seed block in `artifacts/api-server/src/db/index.ts`
  (~line 160) only inserts `WHERE NOT EXISTS (SELECT 1 FROM whatsapp_templates)`,
  i.e. only on an empty table — the live DB already has rows, so new types would
  never seed. Add a **separate seed statement per new type** guarded by
  `WHERE NOT EXISTS (SELECT 1 FROM whatsapp_templates WHERE template_type = '<type>')`
  so existing databases pick them up on next boot. Six seed rows total
  (2 roles × 3 stages), with escalating colour coding like the member set.

### 3. Targeted fix: placeholder substitution mismatch

`applyTemplateVars()` in `followUpGenerator.ts` substitutes `{{User}}` /
`{{Leader}}`, but the seeded templates, the Templates page hints
(`artifacts/jg-youth/src/pages/templates.tsx` `PLACEHOLDER_HINTS`), and the
template-update sync (`artifacts/api-server/src/routes/whatsappTemplates.ts:113`)
all use square brackets `[User]` / `[Leader]`. Result: generator-produced previews
can carry a literal `[User]` into the hub and the sent message. Fix the generator
to substitute the square-bracket forms (keep the `{{ }}` forms too, in case live
templates were hand-edited to that syntax). This fix benefits the existing member
flow and is required for the new leader templates to render correctly.

### 4. API changes

- `GET /whatsapp/queue` (`artifacts/api-server/src/routes/whatsapp.ts:159`): add
  `role: profilesTable.role` to the selected columns so the hub can badge entries.
- `whatsapp-templates` CRUD routes: no changes — `template_type` is free text and
  the PATCH preview-sync is keyed by `template_id`, which works for the new types
  as-is.
- No client regeneration needed: the queue endpoint is not in
  `lib/api-spec/openapi.yaml`; the frontend consumes it via plain `apiFetch` with
  a local type, which gains the `role` field.

### 5. Frontend changes (jg-youth)

- **Follow-up Hub** (`src/pages/follow-up-hub.tsx`): render a role badge
  ("Leader" / "Super Admin") on queue entries whose `role` is `leader` or
  `super_admin`. Members/visitors render unchanged. Approval/send flow unchanged.
- **Templates page** (`src/pages/templates.tsx`):
  - Two new sections (matching the existing section pattern): "Leader follow-ups"
    (`follow_up_leader`) and "Super admin follow-ups" (`follow_up_super_admin`),
    each sorted by `stage_weeks`.
  - `PLACEHOLDER_HINTS` entries for both new types: `["[User]", "[Leader]"]`.
  - Stage label helper covers the new types (e.g. "Leader — 1 week absent").
- Per project preference, no role-gating on visibility: all hub/template users see
  the new sections and badges.

### 6. Edge cases

- **Self-approval:** a flagged leader can see and approve their own follow-up.
  Allowed — harmless, and the nudge still lands.
- **Dedup:** existing key `profile_id:stage_weeks` over statuses
  pending/approved/sent still holds; a profile has exactly one role, so ladder
  overlap at stages 2 and 4 can't collide across roles.
- **Role promotion:** someone promoted member → leader who already had a sent
  stage-2 entry won't be re-flagged at leader stage 2. Accepted — rare, and the
  1-week stage still fires fresh.
- **Missing phone:** parity with members — follow-up flags are created regardless
  of phone (the hub shows them; wa.me send needs a number), day-of reminders
  require a phone + opt-in, as today.

### 7. Deployment notes

- Live backend is the Express api-server on Render; seeds apply on boot via
  `db/index.ts`. No manual SQL needed if the per-type seed guards are right.
- The in-progress Supabase Edge Functions port (`backend-to-supabase` branch) does
  not cover background jobs — no parallel change now; carry this design over when
  that port reaches jobs.

### 8. Testing

- Unit: role-aware `stageFor()` — leader at 1/2/4 with 4 terminal; member ladder
  unchanged; sub-threshold weeks return null for both.
- Unit: placeholder substitution handles `[User]`/`[Leader]` and `{{User}}`/`{{Leader}}`.
- Integration (generator against test DB, following existing job-test patterns if
  present): a leader absent 1 week is flagged with a `follow_up_leader` template;
  a member absent 1 week is not flagged; a super admin absent 5 weeks lands on
  terminal stage 4 with the `follow_up_super_admin` template; fallback message
  used when a role+stage template is missing.
- API: `GET /whatsapp/queue` response includes `role`.

## Out of scope

- Changing the send mechanism (stays hub-approve → wa.me).
- Per-person custom templates (personalisation is via placeholders + profile data).
- Different automation schedules per role (one automation window fires all ladders).
- The Supabase port of these jobs.
