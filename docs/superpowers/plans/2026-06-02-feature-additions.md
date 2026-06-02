# Feature Additions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. UI work should follow the frontend-design craft principles WITHIN the existing iOS-dark-glass system (glass cards, rounded-2xl, teal/blue accents, Inter/Sora, staggered reveals) — do NOT introduce a new aesthetic.

**Goal:** Add member attendance history, a duplicate-profile merge tool, pending-approval + Friday banners, and an Incomplete-Profile badge — cohesive with the existing dashboard.

**Architecture:** Two new backend endpoints (`GET /attendance/my`, `POST /profiles/merge`) added to the OpenAPI spec and consumed via the regenerated orval client. Frontend adds a "My Check-ins" section + Friday banner to `/my`, and badges + merge/attendance dialogs to the leader dashboard panels.

**Tech Stack:** Express + Drizzle (Postgres/Supabase), React 19 + wouter + TanStack Query, orval-generated client, Vitest (backend).

**Spec:** `docs/superpowers/specs/2026-06-02-feature-additions-design.md`
**Branch:** `feature-additions` (checked out; spec committed).

## Conventions

- Backend build: `pnpm --filter=@workspace/api-server run build`; types: `pnpm -w run typecheck:libs`; tests: `pnpm --filter=@workspace/api-server test`.
- Frontend build: `pnpm --filter=@workspace/jg-youth run build`.
- Regenerate API client: `pnpm --filter=@workspace/api-spec run codegen` (NEVER hand-edit generated files in `lib/api-client-react` / `lib/api-zod`).
- No `any` in new backend code. No silent error swallowing.
- Task 7 (live-DB merge verification) is performed by the human CONTROLLER, not a subagent.

## File map

- Modify: `lib/api-spec/openapi.yaml` — add 2 paths + 2 schemas.
- Modify: `artifacts/api-server/src/routes/attendance.ts` — `/attendance/my` + role-gate.
- Create: `artifacts/api-server/src/lib/mergeProfiles.ts` — merge transaction helper.
- Create: `artifacts/api-server/src/lib/mergeProfiles.test.ts` — unit test for rsvp-conflict planning.
- Modify: `artifacts/api-server/src/routes/profiles.ts` — `POST /profiles/merge`.
- Create: `artifacts/jg-youth/src/lib/serviceBanner.ts` — pure SAST Friday-banner check.
- Modify: `artifacts/jg-youth/src/pages/my.tsx` — My Check-ins section + Friday banner.
- Modify: `artifacts/jg-youth/src/components/panels/MemberDirectoryPanel.tsx` — Incomplete badge + View check-ins + Merge dialogs.
- Modify: `artifacts/jg-youth/src/pages/dashboard.tsx` — pending-approval count badge on Requests tab.

---

### Task 1: Add the two endpoints to the OpenAPI spec and regenerate the client

**Files:** Modify `lib/api-spec/openapi.yaml`; regenerate `lib/api-client-react` + `lib/api-zod`.

- [ ] **Step 1: Add the two paths**

In `lib/api-spec/openapi.yaml`, under `paths:`, add (place near the other `/attendance` and `/profiles` paths; indentation must match the existing 2-space path indentation):
```yaml
  /attendance/my:
    get:
      operationId: getMyAttendance
      tags: [attendance]
      summary: Current user's own attendance history
      responses:
        "200":
          description: Attendance rows for the authenticated member
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/MyAttendanceRecord"
        "401":
          description: Unauthorized
  /profiles/merge:
    post:
      operationId: mergeProfiles
      tags: [profiles]
      summary: Merge a duplicate profile into another (super admin)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/MergeProfilesBody"
      responses:
        "200":
          description: Merged
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SuccessMessage"
        "400":
          description: Invalid request
        "404":
          description: Profile not found
```

- [ ] **Step 2: Add the two schemas**

Under `components: schemas:`, add:
```yaml
    MyAttendanceRecord:
      type: object
      required: [id, session_date, check_in_method]
      properties:
        id:
          type: string
        session_date:
          type: string
        check_in_method:
          type: string
        checked_in_at:
          type: string
        event_title:
          type: string
          nullable: true
    MergeProfilesBody:
      type: object
      required: [keepId, mergeId]
      properties:
        keepId:
          type: string
        mergeId:
          type: string
```
(If `SuccessMessage` is not already a defined schema, add `SuccessMessage: { type: object, properties: { success: { type: boolean }, message: { type: string } } }`.)

- [ ] **Step 3: Regenerate**

Run: `pnpm --filter=@workspace/api-spec run codegen`
Expected: "ready to use orval" success for both `api-client-react` and `zod`.

- [ ] **Step 4: Confirm hooks exist + typecheck**

Run: `grep -rn "useGetMyAttendance\|useMergeProfiles" lib/api-client-react/src/generated/api.ts`
Expected: both appear. Then `pnpm -w run typecheck:libs` → success.

- [ ] **Step 5: Commit**
```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src lib/api-zod/src
git commit -m "feat(api-spec): add /attendance/my and /profiles/merge; regenerate client"
```

---

### Task 2: `GET /attendance/my` + role-gate the profile_id query

**Files:** Modify `artifacts/api-server/src/routes/attendance.ts`.

- [ ] **Step 1: Add the `/attendance/my` route**

In `artifacts/api-server/src/routes/attendance.ts`, add imports at the top if missing: `eventsTable` is needed —
change `import { db, attendanceTable, profilesTable } from "@workspace/db";` to
`import { db, attendanceTable, profilesTable, eventsTable } from "@workspace/db";`
and add `import { desc } from "drizzle-orm";` (merge into the existing `drizzle-orm` import line: `import { eq, and, ilike, or, desc } from "drizzle-orm";`).

Add this route immediately AFTER the existing `router.get("/attendance/today", ...)` handler:
```ts
// GET /attendance/my - the authenticated member's own attendance history
router.get("/attendance/my", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });

    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, auth.userId),
    });
    if (!profile) return res.status(404).json({ error: "Profile not found" });

    const rows = await db
      .select({
        id: attendanceTable.id,
        session_date: attendanceTable.session_date,
        check_in_method: attendanceTable.check_in_method,
        checked_in_at: attendanceTable.checked_in_at,
        event_title: eventsTable.title,
      })
      .from(attendanceTable)
      .leftJoin(eventsTable, eq(attendanceTable.event_id, eventsTable.id))
      .where(eq(attendanceTable.profile_id, profile.id))
      .orderBy(desc(attendanceTable.session_date), desc(attendanceTable.checked_in_at));

    return res.json(rows);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
```

- [ ] **Step 2: Role-gate `GET /attendance` when querying another profile**

In the existing `router.get("/attendance", ...)` handler, replace the auth block at the top
(`const auth = getAuth(req); if (!auth?.userId) { return res.status(401)... }`) with a check
that only privileged users may read an arbitrary `profile_id`:
```ts
    const auth = getAuth(req);
    if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
    const requester = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, auth.userId),
    });
    const isPrivileged = requester?.role === "leader" || requester?.role === "super_admin";
    const requestedProfileId = req.query.profile_id ? String(req.query.profile_id) : undefined;
    if (requestedProfileId && !isPrivileged && requestedProfileId !== requester?.id) {
      return res.status(403).json({ error: "Forbidden" });
    }
```
(Keep the rest of the handler — the `conditions` building and select — unchanged.)

- [ ] **Step 3: Build + typecheck**

Run: `pnpm -w run typecheck:libs && pnpm --filter=@workspace/api-server run build`
Expected: success.

- [ ] **Step 4: Commit**
```bash
git add artifacts/api-server/src/routes/attendance.ts
git commit -m "feat(api): GET /attendance/my and role-gate arbitrary profile_id reads"
```

---

### Task 3: `POST /profiles/merge` + rsvp-conflict unit test

**Files:** Create `artifacts/api-server/src/lib/mergeProfiles.ts` + `.test.ts`; modify `artifacts/api-server/src/routes/profiles.ts`.

- [ ] **Step 1: Write the failing unit test for the rsvp-conflict planner**

Create `artifacts/api-server/src/lib/mergeProfiles.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { planRsvpMerge } from "./mergeProfiles";

describe("planRsvpMerge", () => {
  it("reassigns merge rsvps for events the keep profile has no rsvp for", () => {
    const keep = [{ id: "k1", event_id: "e1" }];
    const merge = [{ id: "m1", event_id: "e2" }];
    expect(planRsvpMerge(keep, merge)).toEqual({ reassignIds: ["m1"], deleteIds: [] });
  });

  it("deletes merge rsvps that collide with an existing keep rsvp on the same event", () => {
    const keep = [{ id: "k1", event_id: "e1" }];
    const merge = [{ id: "m1", event_id: "e1" }, { id: "m2", event_id: "e3" }];
    expect(planRsvpMerge(keep, merge)).toEqual({ reassignIds: ["m2"], deleteIds: ["m1"] });
  });

  it("handles empty inputs", () => {
    expect(planRsvpMerge([], [])).toEqual({ reassignIds: [], deleteIds: [] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter=@workspace/api-server test`
Expected: FAIL — cannot find `./mergeProfiles`.

- [ ] **Step 3: Implement the helper + merge transaction**

Create `artifacts/api-server/src/lib/mergeProfiles.ts`:
```ts
import {
  db,
  profilesTable,
  attendanceTable,
  rsvpsTable,
  membershipRequestsTable,
  checkInRequestsTable,
  leaderPermissionsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

interface RsvpRef {
  id: string;
  event_id: string;
}

/**
 * Decides which of the merge profile's rsvps can be reassigned to the keep
 * profile and which must be deleted (because the keep profile already has an
 * rsvp for that event — the (event_id, profile_id) pair must stay unique).
 */
export function planRsvpMerge(
  keepRsvps: RsvpRef[],
  mergeRsvps: RsvpRef[],
): { reassignIds: string[]; deleteIds: string[] } {
  const keepEventIds = new Set(keepRsvps.map((r) => r.event_id));
  const reassignIds: string[] = [];
  const deleteIds: string[] = [];
  for (const r of mergeRsvps) {
    if (keepEventIds.has(r.event_id)) deleteIds.push(r.id);
    else reassignIds.push(r.id);
  }
  return { reassignIds, deleteIds };
}

/** Backfill keep's null/blank fields from merge. */
function pickBackfill(keep: typeof profilesTable.$inferSelect, merge: typeof profilesTable.$inferSelect) {
  const out: Record<string, unknown> = {};
  const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  const fields = ["phone", "email", "school", "parent_phone", "parent_name", "avatar_url", "gender", "age"] as const;
  for (const f of fields) {
    if (isBlank(keep[f]) && !isBlank(merge[f])) out[f] = merge[f];
  }
  return out;
}

/**
 * Merges `mergeId` into `keepId` inside one transaction: moves attendance,
 * rsvps (conflict-safe), membership_requests, check_in_requests, leader_permissions,
 * backfills missing fields on keep, then deletes the merge profile row.
 * Returns the merge profile's clerk_id (if any) so the caller can delete the Clerk user.
 */
export async function mergeProfiles(keepId: string, mergeId: string): Promise<{ mergeClerkId: string | null }> {
  return db.transaction(async (tx) => {
    const keep = await tx.query.profilesTable.findFirst({ where: eq(profilesTable.id, keepId) });
    const merge = await tx.query.profilesTable.findFirst({ where: eq(profilesTable.id, mergeId) });
    if (!keep || !merge) throw new Error("PROFILE_NOT_FOUND");

    // attendance → reassign all
    await tx.update(attendanceTable).set({ profile_id: keepId }).where(eq(attendanceTable.profile_id, mergeId));

    // rsvps → conflict-safe
    const keepRsvps = await tx.select({ id: rsvpsTable.id, event_id: rsvpsTable.event_id }).from(rsvpsTable).where(eq(rsvpsTable.profile_id, keepId));
    const mergeRsvps = await tx.select({ id: rsvpsTable.id, event_id: rsvpsTable.event_id }).from(rsvpsTable).where(eq(rsvpsTable.profile_id, mergeId));
    const { reassignIds, deleteIds } = planRsvpMerge(keepRsvps, mergeRsvps);
    if (deleteIds.length) await tx.delete(rsvpsTable).where(inArray(rsvpsTable.id, deleteIds));
    if (reassignIds.length) await tx.update(rsvpsTable).set({ profile_id: keepId }).where(inArray(rsvpsTable.id, reassignIds));

    // membership_requests → reassign profile_id + reviewed_by
    await tx.update(membershipRequestsTable).set({ profile_id: keepId }).where(eq(membershipRequestsTable.profile_id, mergeId));
    await tx.update(membershipRequestsTable).set({ reviewed_by: keepId }).where(eq(membershipRequestsTable.reviewed_by, mergeId));

    // check_in_requests → reassign profile_id + reviewed_by
    await tx.update(checkInRequestsTable).set({ profile_id: keepId }).where(eq(checkInRequestsTable.profile_id, mergeId));
    await tx.update(checkInRequestsTable).set({ reviewed_by: keepId }).where(eq(checkInRequestsTable.reviewed_by, mergeId));

    // leader_permissions (unique per profile) → keep wins; drop merge's
    const keepPerm = await tx.select({ id: leaderPermissionsTable.id }).from(leaderPermissionsTable).where(eq(leaderPermissionsTable.profile_id, keepId));
    if (keepPerm.length) await tx.delete(leaderPermissionsTable).where(eq(leaderPermissionsTable.profile_id, mergeId));
    else await tx.update(leaderPermissionsTable).set({ profile_id: keepId }).where(eq(leaderPermissionsTable.profile_id, mergeId));

    // backfill missing fields on keep
    const backfill = pickBackfill(keep, merge);
    if (Object.keys(backfill).length) await tx.update(profilesTable).set(backfill).where(eq(profilesTable.id, keepId));

    // delete the merge profile
    await tx.delete(profilesTable).where(eq(profilesTable.id, mergeId));

    return { mergeClerkId: merge.clerk_id ?? null };
  });
}
```

- [ ] **Step 4: Run to verify the unit test passes**

Run: `pnpm --filter=@workspace/api-server test`
Expected: `planRsvpMerge` tests pass.

- [ ] **Step 5: Add the route**

In `artifacts/api-server/src/routes/profiles.ts`, add the import:
```ts
import { mergeProfiles } from "../lib/mergeProfiles";
```
Add this route just before `export default router;`:
```ts
// POST /profiles/merge - merge a duplicate profile into another (super admin only)
router.post("/profiles/merge", requireLeaderSession("super_admin"), async (req: Request, res: Response) => {
  try {
    const { keepId, mergeId } = req.body ?? {};
    if (typeof keepId !== "string" || typeof mergeId !== "string") {
      return res.status(400).json({ error: "keepId and mergeId are required" });
    }
    if (keepId === mergeId) {
      return res.status(400).json({ error: "Cannot merge a profile into itself" });
    }

    let mergeClerkId: string | null = null;
    try {
      ({ mergeClerkId } = await mergeProfiles(keepId, mergeId));
    } catch (err) {
      if (err instanceof Error && err.message === "PROFILE_NOT_FOUND") {
        return res.status(404).json({ error: "Profile not found" });
      }
      throw err;
    }

    if (mergeClerkId && process.env.CLERK_SECRET_KEY) {
      try {
        await fetch(`https://api.clerk.com/v1/users/${mergeClerkId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
        });
      } catch (clerkErr) {
        req.log.warn({ clerkErr }, "Failed to delete merged Clerk user — DB merge already done");
      }
    }

    return res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
```

- [ ] **Step 6: Build + test**

Run: `pnpm -w run typecheck:libs && pnpm --filter=@workspace/api-server run build && pnpm --filter=@workspace/api-server test`
Expected: all pass.

- [ ] **Step 7: Commit**
```bash
git add artifacts/api-server/src/lib/mergeProfiles.ts artifacts/api-server/src/lib/mergeProfiles.test.ts artifacts/api-server/src/routes/profiles.ts
git commit -m "feat(api): POST /profiles/merge with conflict-safe rsvp/leader-perm handling"
```

---

### Task 4: Friday banner helper + My Check-ins section + banner on `/my`

**Files:** Create `artifacts/jg-youth/src/lib/serviceBanner.ts`; modify `artifacts/jg-youth/src/pages/my.tsx`.

- [ ] **Step 1: Create the pure SAST Friday-banner helper**

Create `artifacts/jg-youth/src/lib/serviceBanner.ts`:
```ts
/**
 * Returns true if `now` falls in the post-service "thanks for coming" window:
 * Friday 22:00–23:59:59 in SAST (Africa/Johannesburg = UTC+2, no DST).
 * Pure and deterministic for a given Date.
 */
export function isPostServiceWindow(now: Date): boolean {
  // Shift to SAST by adding 2 hours, then read UTC parts.
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const day = sast.getUTCDay(); // 0=Sun … 5=Fri
  const hour = sast.getUTCHours();
  return day === 5 && hour >= 22 && hour <= 23;
}

/** localStorage key for dismissing the banner for one SAST night. */
export function serviceBannerKey(now: Date): string {
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  return `service_banner_dismissed_${sast.getUTCFullYear()}-${sast.getUTCMonth() + 1}-${sast.getUTCDate()}`;
}
```
(Manual verification examples — confirm by reasoning, no frontend test runner: a Friday 22:30 SAST = Friday 20:30 UTC → `isPostServiceWindow(new Date("2026-06-05T20:30:00Z"))` is true; Friday 21:30 SAST = 19:30 UTC → false; Saturday 22:30 SAST → false.)

- [ ] **Step 2: Wire the My Check-ins data + banner state into `my.tsx`**

In `artifacts/jg-youth/src/pages/my.tsx`:
- Add to the imports from `@workspace/api-client-react`: `useGetMyAttendance, getGetMyAttendanceQueryKey`.
- Add import: `import { isPostServiceWindow, serviceBannerKey } from "@/lib/serviceBanner";`
- Add the query near the other queries (after `useListMyRsvps`):
```ts
  const { data: myAttendance, isLoading: isAttendanceLoading } = useGetMyAttendance({
    query: { enabled: !!profile, queryKey: getGetMyAttendanceQueryKey() },
  });
```
- Add banner state near the other `useState`s:
```ts
  const now = new Date();
  const [bannerDismissed, setBannerDismissed] = useState(
    () => typeof localStorage !== "undefined" && !!localStorage.getItem(serviceBannerKey(now)),
  );
  const showServiceBanner = isPostServiceWindow(now) && !bannerDismissed;
```

- [ ] **Step 3: Render the banner + My Check-ins section**

In `my.tsx`, immediately inside the top container (just after `<div className="max-w-4xl mx-auto space-y-10 py-6 px-4">`), add the banner:
```tsx
        {showServiceBanner && (
          <div className="rounded-2xl border border-[#30D158]/30 bg-gradient-to-br from-[#30D158]/15 to-[#0A84FF]/10 p-4 flex items-center justify-between gap-3 animate-fade-in">
            <p className="text-sm font-semibold">Thanks for coming tonight! 🙌</p>
            <button
              onClick={() => {
                localStorage.setItem(serviceBannerKey(now), "1");
                setBannerDismissed(true);
              }}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg"
            >
              Dismiss
            </button>
          </div>
        )}
```
Then add a "My Check-ins" `<section>` immediately AFTER the Check-In section's closing `</section>` (the section that contains the QR/Self check-in cards):
```tsx
        {/* My Check-ins */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold tracking-tight">My Check-ins</h2>
            {myAttendance && myAttendance.length > 0 && (
              <span className="text-xs text-muted-foreground">{myAttendance.length} total</span>
            )}
          </div>
          {isAttendanceLoading ? (
            <Skeleton className="h-16 w-full rounded-2xl" />
          ) : myAttendance && myAttendance.length > 0 ? (
            <div className="space-y-2.5">
              {myAttendance.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-2xl border border-border/60 bg-card/40 px-4 py-3">
                  <div>
                    <p className="font-semibold text-sm">
                      {a.session_date ? format(new Date(a.session_date), "EEEE, MMM d, yyyy") : "Session"}
                    </p>
                    {a.event_title && <p className="text-xs text-muted-foreground mt-0.5">{a.event_title}</p>}
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                    a.check_in_method === "qr" ? "bg-[#0A84FF]/10 text-[#0A84FF]" :
                    a.check_in_method === "self" ? "bg-[#30D158]/10 text-[#30D158]" :
                    "bg-[#FF9F0A]/10 text-[#FF9F0A]"
                  }`}>
                    {a.check_in_method}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-6">No check-ins yet. See you on Friday! 🙌</p>
          )}
        </section>
```

- [ ] **Step 4: Build**

Run: `pnpm --filter=@workspace/jg-youth run build`
Expected: success. (`format` and `Skeleton` are already imported in `my.tsx`.)

- [ ] **Step 5: Commit**
```bash
git add artifacts/jg-youth/src/lib/serviceBanner.ts artifacts/jg-youth/src/pages/my.tsx
git commit -m "feat(web): my check-ins history + post-service Friday banner"
```

---

### Task 5: Incomplete badge + View check-ins + Merge dialogs in the directory

**Files:** Modify `artifacts/jg-youth/src/components/panels/MemberDirectoryPanel.tsx`.

- [ ] **Step 1: Add the Incomplete badge next to the member name**

In `MemberDirectoryPanel.tsx`, the name row is:
```tsx
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-base leading-tight">{profile.full_name}</p>
                      <RoleBadge role={targetRole} />
                    </div>
```
Replace it with (adds the badge when name is "New Member"/blank or phone missing):
```tsx
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-base leading-tight">{profile.full_name}</p>
                      <RoleBadge role={targetRole} />
                      {(!profile.full_name || profile.full_name === "New Member" || !profile.phone) && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-amber-500/15 text-amber-500 border border-amber-500/25">
                          Incomplete
                        </span>
                      )}
                    </div>
```

- [ ] **Step 2: Add view-attendance + merge state and dialogs**

Add imports at the top of the file:
```ts
import { useMergeProfiles, getListProfilesQueryKey as _glpk } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
```
(`getListProfilesQueryKey` is already imported — do not import it twice; remove the `_glpk` alias and just reuse the existing import. Only add `useMergeProfiles` and `useToast`.)

Inside the component, add state + hooks near the existing `useState`s:
```ts
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mergeMutation = useMergeProfiles();
  const [viewAttendanceFor, setViewAttendanceFor] = useState<any | null>(null);
  const [attendanceRows, setAttendanceRows] = useState<any[]>([]);
  const [mergeKeep, setMergeKeep] = useState<any | null>(null);
  const [mergeFromId, setMergeFromId] = useState<string>("");
```

- [ ] **Step 3: Add the dropdown actions (super admin only)**

In the dropdown for `sessionRole === 'super_admin'`, after the `View Profile` item, add:
```tsx
                      <DropdownMenuItem
                        onClick={async () => {
                          setViewAttendanceFor(profile);
                          setAttendanceRows([]);
                          const sessionStr = localStorage.getItem("jg_leader_session") ?? "";
                          const r = await fetch(`/api/attendance?profile_id=${profile.id}`, {
                            headers: { "x-leader-session": sessionStr },
                          });
                          if (r.ok) setAttendanceRows(await r.json());
                        }}
                      >
                        View Check-ins
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setMergeKeep(profile); setMergeFromId(""); }}>
                        Merge Duplicate Into This
                      </DropdownMenuItem>
```

- [ ] **Step 4: Add the View-attendance dialog**

Before the final closing `</DashCard>`, add:
```tsx
      <Dialog open={!!viewAttendanceFor} onOpenChange={(o) => !o && setViewAttendanceFor(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <h3 className="font-bold text-lg mb-1">{viewAttendanceFor?.full_name}</h3>
          <p className="text-xs text-muted-foreground mb-4">Check-in history</p>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {attendanceRows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No check-ins recorded.</p>
            ) : (
              attendanceRows.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-xl border border-border/50 px-3 py-2">
                  <span className="text-sm">{a.session_date ? format(new Date(a.session_date), "MMM d, yyyy") : "Session"}</span>
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground">{a.check_in_method}</span>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 5: Add the Merge dialog**

Also before the final `</DashCard>`:
```tsx
      <Dialog open={!!mergeKeep} onOpenChange={(o) => !o && setMergeKeep(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <h3 className="font-bold text-lg mb-1">Merge duplicate</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Keep <strong>{mergeKeep?.full_name}</strong> and merge another profile's history into it. The other profile is deleted. This cannot be undone.
          </p>
          <select
            value={mergeFromId}
            onChange={(e) => setMergeFromId(e.target.value)}
            className="w-full bg-card/50 border border-border/60 rounded-xl h-10 px-3 text-sm mb-4"
          >
            <option value="">Select profile to merge from…</option>
            {(profiles ?? []).filter((p: any) => p.id !== mergeKeep?.id).map((p: any) => (
              <option key={p.id} value={p.id}>{p.full_name} {p.phone ? `(${p.phone})` : ""}</option>
            ))}
          </select>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setMergeKeep(null)}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white border-0"
              disabled={!mergeFromId || mergeMutation.isPending}
              onClick={() => {
                if (!mergeKeep || !mergeFromId) return;
                mergeMutation.mutate(
                  { data: { keepId: mergeKeep.id, mergeId: mergeFromId } },
                  {
                    onSuccess: () => {
                      toast({ title: "Profiles merged" });
                      queryClient.invalidateQueries({ queryKey: getListProfilesQueryKey() });
                      setMergeKeep(null);
                    },
                    onError: () => toast({ title: "Merge failed", variant: "destructive" }),
                  },
                );
              }}
            >
              {mergeMutation.isPending ? "Merging…" : "Merge"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 6: Build**

Run: `pnpm --filter=@workspace/jg-youth run build`
Expected: success. Resolve any unused-import or type errors (e.g. ensure `useQueryClient` is imported — it already is at the top).

- [ ] **Step 7: Commit**
```bash
git add artifacts/jg-youth/src/components/panels/MemberDirectoryPanel.tsx
git commit -m "feat(web): incomplete badge, view check-ins, and merge tool in directory"
```

---

### Task 6: Pending-approval count badge on the Requests tab

**Files:** Modify `artifacts/jg-youth/src/pages/dashboard.tsx`.

- [ ] **Step 1: Find the Requests tab trigger and the membership-requests data**

Open `artifacts/jg-youth/src/pages/dashboard.tsx` and locate (a) the membership-requests query/hook (it powers `RequestsPanel`; search for `membership` or `useListMembershipRequests`) and (b) the `TabsTrigger` whose value is the requests tab (search for `Requests`). Note the variable holding the requests array (e.g. `membershipRequests`).

- [ ] **Step 2: Add the count badge to the Requests tab trigger**

Compute the pending count near the other derived values:
```ts
  const pendingRequestCount = Array.isArray(membershipRequests)
    ? membershipRequests.filter((r: any) => r.status === "pending").length
    : 0;
```
(Use the actual variable name found in Step 1 in place of `membershipRequests`.)
Then inside the Requests `TabsTrigger`, after its label text, add:
```tsx
            {pendingRequestCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[#FF9F0A] text-white text-[10px] font-bold">
                {pendingRequestCount}
              </span>
            )}
```

- [ ] **Step 3: Build**

Run: `pnpm --filter=@workspace/jg-youth run build`
Expected: success.

- [ ] **Step 4: Commit**
```bash
git add artifacts/jg-youth/src/pages/dashboard.tsx
git commit -m "feat(web): pending-approval count badge on Requests tab"
```

---

### Task 7: Controller-run live-DB merge verification (CONTROLLER ONLY)

Performed by the human controller via the Supabase tool — touches the live DB; rolls back.

- [ ] **Step 1: Seed two profiles + children, merge, assert, ROLLBACK** (single `execute_sql`):
```sql
DO $$
DECLARE keepid uuid; mergeid uuid; att int; prof int;
BEGIN
  INSERT INTO profiles (full_name, phone, role) VALUES ('MERGE_KEEP_DELETE_ME','+000keep','member') RETURNING id INTO keepid;
  INSERT INTO profiles (full_name, phone, role) VALUES ('MERGE_DUP_DELETE_ME','+000dup','member') RETURNING id INTO mergeid;
  INSERT INTO attendance (profile_id, session_date) VALUES (mergeid, CURRENT_DATE);
  -- mirror mergeProfiles for attendance + profile delete
  UPDATE attendance SET profile_id = keepid WHERE profile_id = mergeid;
  DELETE FROM profiles WHERE id = mergeid;
  SELECT count(*) INTO att FROM attendance WHERE profile_id = keepid;
  SELECT count(*) INTO prof FROM profiles WHERE id = mergeid;
  RAISE EXCEPTION 'MERGE_VERIFY moved_attendance=% dup_remaining=% (expect 1 and 0)', att, prof;
END $$;
```
Expected: error text `MERGE_VERIFY moved_attendance=1 dup_remaining=0`. The `RAISE EXCEPTION` rolls everything back.

- [ ] **Step 2: Confirm no leak**
```sql
SELECT count(*) FROM profiles WHERE full_name IN ('MERGE_KEEP_DELETE_ME','MERGE_DUP_DELETE_ME');
```
Expected: `0`.

---

### Task 8: Full verification gate

- [ ] **Step 1: Typecheck + both builds + backend tests**

Run: `pnpm -w run typecheck:libs && pnpm --filter=@workspace/api-server run build && pnpm --filter=@workspace/jg-youth run build && pnpm --filter=@workspace/api-server test`
Expected: all succeed; tests include `planRsvpMerge`.

- [ ] **Step 2: Clean working tree check**

Run: `git status --porcelain`
Expected: only regenerable build output under `public/` (ignored/regenerable).
