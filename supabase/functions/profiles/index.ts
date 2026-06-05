// Supabase Edge Function: profiles
// Port of artifacts/api-server/src/routes/profiles.ts (every route) plus the
// /profiles-prefixed routes of artifacts/api-server/src/routes/register.ts.
//
// NOTE: register.ts's only route is POST /register, whose path does NOT start
// with /profiles. It belongs to another function — left as a TODO below.
// TODO(register function): POST /register (public first-timer visitor + check-in
//   request) lives in register.ts and does not start with /profiles — port it in
//   the dedicated register/check-in function, not here.

import { createApp } from "../_shared/router.ts";
import { db } from "../_shared/db.ts";
import {
  profilesTable,
  leaderPermissionsTable,
  rsvpsTable,
  attendanceTable,
  membershipRequestsTable,
  checkInRequestsTable,
  eventsTable,
  pendingEmailsTable,
  type Profile,
} from "../_shared/schema.ts";
import { getClerkUserId, requireRole, resolveAuth } from "../_shared/auth.ts";
import {
  and,
  count,
  eq,
  ilike,
  inArray,
  ne,
  or,
  sql,
} from "npm:drizzle-orm@0.45.2";
import bcrypt from "npm:bcryptjs@2";
import { z } from "npm:zod@3";
import { createClerkClient } from "npm:@clerk/backend@1";

const clerk = createClerkClient({ secretKey: Deno.env.get("CLERK_SECRET_KEY")! });

const app = createApp();

// ── Inline zod body schemas (ported from @workspace/api-zod) ─────────────────
const UpdateMyProfileBody = z.object({
  full_name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  gender: z.enum(["male", "female"]).optional(),
  age: z.number().optional(),
  heard_from: z.string().optional(),
  school: z.string().optional(),
  parent_phone: z.string().optional(),
  parent_name: z.string().optional(),
  whatsapp_opt_in: z.boolean().optional(),
  avatar_url: z.string().optional(),
});

const RegisterVisitorBody = z.object({
  full_name: z.string(),
  phone: z.string(),
  email: z.string().nullish(),
  gender: z.enum(["male", "female"]),
  age: z.number(),
  heard_from: z.string(),
  school: z.string().optional(),
  parent_phone: z.string().optional(),
  parent_name: z.string().optional(),
  whatsapp_opt_in: z.boolean().optional(),
  clerk_id: z.string().nullish(),
});

// ── Local helpers (ported from api-server/src/lib) ───────────────────────────

/** Mirrors lib/phone.ts normalizePhone — must mirror DB index `lower(btrim(phone))`. */
function normalizePhone(phone: unknown): string | null {
  if (typeof phone !== "string") return null;
  const trimmed = phone.trim();
  if (trimmed.length === 0) return null;
  return trimmed.toLowerCase();
}

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
        ? and(
            sql`lower(btrim(${profilesTable.phone})) = ${norm}`,
            ne(profilesTable.id, excludeId),
          )
        : sql`lower(btrim(${profilesTable.phone})) = ${norm}`,
    )
    .limit(1);
  return rows.length > 0;
}

/** Mirrors lib/membersDirectoryQuery.ts parseMembersDirectoryQuery. */
type DirectoryRole = "member" | "leader" | "super_admin";
const ALLOWED_DIRECTORY_ROLES: DirectoryRole[] = ["member", "leader", "super_admin"];

function parseMembersDirectoryQuery(q: Record<string, unknown>): {
  search: string | undefined;
  role: DirectoryRole | undefined;
  page: number;
  limit: number;
  offset: number;
} {
  const rawSearch = typeof q.search === "string" ? q.search.trim() : "";
  const search = rawSearch.length > 0 ? rawSearch : undefined;

  const roleStr = typeof q.role === "string" ? q.role : "";
  const role = (ALLOWED_DIRECTORY_ROLES as string[]).includes(roleStr)
    ? (roleStr as DirectoryRole)
    : undefined;

  const page = Math.max(1, parseInt(String(q.page ?? "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(q.limit ?? "50"), 10) || 50));
  const offset = (page - 1) * limit;

  return { search, role, page, limit, offset };
}

/** Mirrors lib/notifyLeadersOfMembershipRequest.ts — queues into pending_emails. */
async function notifyLeadersOfMembershipRequest(
  requesterName: string,
  reason: string,
): Promise<void> {
  const recipients = await db
    .select({ email: profilesTable.email })
    .from(profilesTable)
    .where(inArray(profilesTable.role, ["leader", "super_admin"]));

  const dashboardUrl =
    (Deno.env.get("FRONTEND_URL") ?? "https://youth-connect-tau.vercel.app") +
    "/dashboard";

  const rows = recipients
    .map((r) => r.email)
    .filter((email): email is string => !!email && email.trim().length > 0)
    .map((email) => ({
      to_address: email,
      subject: "New membership request — Jeremiah Generation Youth",
      body_html: `
        <div style="font-family: 'Inter', sans-serif; background-color: #0B0F14; color: #E6E8EB; padding: 24px; border-radius: 8px;">
          <h2 style="color: #2A9D8F; font-family: 'Sora', sans-serif;">New Membership Request</h2>
          <p><strong>${requesterName}</strong> has requested to become a member.</p>
          <p style="background-color: rgba(255,255,255,0.05); padding: 12px; border-radius: 6px;"><em>${reason}</em></p>
          <p>Review and approve or decline it in the leader dashboard.</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${dashboardUrl}" style="background-color:#2A9D8F;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">Open Dashboard</a>
          </div>
        </div>
      `,
    }));

  if (rows.length > 0) {
    await db.insert(pendingEmailsTable).values(rows);
  }
}

/** Mirrors lib/mergeProfiles.ts planRsvpMerge. */
interface RsvpRef {
  id: string;
  event_id: string;
}
function planRsvpMerge(
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
function pickBackfill(keep: Profile, merge: Profile): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const isBlank = (v: unknown) =>
    v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  const fields = [
    "phone",
    "email",
    "school",
    "parent_phone",
    "parent_name",
    "avatar_url",
    "gender",
    "age",
  ] as const;
  for (const f of fields) {
    if (isBlank(keep[f]) && !isBlank(merge[f])) out[f] = merge[f];
  }
  return out;
}

/** Mirrors lib/mergeProfiles.ts mergeProfiles. */
async function mergeProfiles(
  keepId: string,
  mergeId: string,
): Promise<{ mergeClerkId: string | null }> {
  return db.transaction(async (tx) => {
    const keep = await tx.query.profilesTable.findFirst({ where: eq(profilesTable.id, keepId) });
    const merge = await tx.query.profilesTable.findFirst({ where: eq(profilesTable.id, mergeId) });
    if (!keep || !merge) throw new Error("PROFILE_NOT_FOUND");

    // attendance → reassign all
    await tx.update(attendanceTable).set({ profile_id: keepId }).where(eq(attendanceTable.profile_id, mergeId));

    // rsvps → conflict-safe
    const keepRsvps = await tx
      .select({ id: rsvpsTable.id, event_id: rsvpsTable.event_id })
      .from(rsvpsTable)
      .where(eq(rsvpsTable.profile_id, keepId));
    const mergeRsvps = await tx
      .select({ id: rsvpsTable.id, event_id: rsvpsTable.event_id })
      .from(rsvpsTable)
      .where(eq(rsvpsTable.profile_id, mergeId));
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
    const keepPerm = await tx
      .select({ id: leaderPermissionsTable.id })
      .from(leaderPermissionsTable)
      .where(eq(leaderPermissionsTable.profile_id, keepId));
    if (keepPerm.length) {
      await tx.delete(leaderPermissionsTable).where(eq(leaderPermissionsTable.profile_id, mergeId));
    } else {
      await tx.update(leaderPermissionsTable).set({ profile_id: keepId }).where(eq(leaderPermissionsTable.profile_id, mergeId));
    }

    // events.created_by → reassign authorship to keep (FK would otherwise block the delete)
    await tx.update(eventsTable).set({ created_by: keepId }).where(eq(eventsTable.created_by, mergeId));

    // backfill missing fields on keep
    const backfill = pickBackfill(keep, merge);
    if (Object.keys(backfill).length) {
      await tx.update(profilesTable).set(backfill).where(eq(profilesTable.id, keepId));
    }

    // delete the merge profile
    await tx.delete(profilesTable).where(eq(profilesTable.id, mergeId));

    return { mergeClerkId: merge.clerk_id ?? null };
  });
}

/** Mirrors lib/deleteProfileCascade.ts deleteProfileCascade. */
async function deleteProfileCascade(profileId: string): Promise<void> {
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

/** Build a hex token from N random bytes (replaces Node crypto.randomBytes(n).toString("hex")). */
function randomHexToken(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /profiles/me - Retrieve current logged in Clerk user's profile
app.get("/profiles/me", async (c) => {
  try {
    const clerkId = await getClerkUserId(c.req.raw);
    if (!clerkId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    let profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, clerkId),
    });

    if (!profile) {
      // Fetch live user data directly from Clerk to prevent session claim drift
      const clerkUser = await clerk.users.getUser(clerkId);
      const email = clerkUser.emailAddresses?.[0]?.emailAddress ?? null;
      const firstName = clerkUser.firstName ?? "";
      const lastName = clerkUser.lastName ?? "";
      const fullName =
        [firstName, lastName].filter(Boolean).join(" ").trim() || "New Member";

      const phone = clerkUser.phoneNumbers?.[0]?.phoneNumber ?? null;

      // Fallback: look up by email
      if (email) {
        const existingByEmail = await db.query.profilesTable.findFirst({
          where: ilike(profilesTable.email, email.trim()),
        });

        if (existingByEmail) {
          // Update that row with the new clerk_id to preserve existing role
          const [updatedProfile] = await db
            .update(profilesTable)
            .set({ clerk_id: clerkId })
            .where(eq(profilesTable.id, existingByEmail.id))
            .returning();

          return c.json(updatedProfile);
        }
      }

      // Unsafe Clerk auto-linking stripped completely.
      // Fresh visitor profile is generated directly for new Clerk signups without verified links.
      const [created] = await db
        .insert(profilesTable)
        .values({
          clerk_id: clerkId,
          full_name: fullName,
          email,
          phone,
          role: "visitor",
          gender: "other",
          age: 0,
          heard_from: "clerk_signup",
        })
        .returning();
      profile = created;

      // Create automatic pending membership request for direct Clerk signups
      await db.insert(membershipRequestsTable).values({
        profile_id: profile.id,
        reason: "Direct Clerk signup",
        status: "pending",
      });
      await notifyLeadersOfMembershipRequest(profile.full_name, "Direct Clerk signup");
    }

    return c.json(profile);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// PATCH /profiles/me - Self-update profile (Clerk-auth)
app.patch("/profiles/me", async (c) => {
  try {
    const clerkId = await getClerkUserId(c.req.raw);
    if (!clerkId) return c.json({ error: "Unauthorized" }, 401);
    const body = await c.req.json();
    const parsed = UpdateMyProfileBody.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const existing = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, clerkId),
    });
    if (!existing) return c.json({ error: "Profile not found" }, 404);
    if (
      parsed.data.phone !== undefined &&
      (await phoneInUse(parsed.data.phone, existing.id))
    ) {
      return c.json({ error: "This number is already registered", duplicate: true }, 409);
    }
    const [updated] = await db
      .update(profilesTable)
      .set(parsed.data)
      .where(eq(profilesTable.clerk_id, clerkId))
      .returning();
    return c.json(updated);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /profiles/me/pin - Check if current leader profile has a PIN set
app.get("/profiles/me/pin", requireRole("leader"), async (c) => {
  try {
    const leaderId = c.get("leaderId") as string;
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, leaderId),
    });
    if (!profile) return c.json({ error: "Profile not found" }, 404);
    return c.json({ hasPIN: !!profile.pin_hash });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// PATCH /profiles/me/pin - Self-change secure PIN with 12-round bcrypt hash
app.patch("/profiles/me/pin", requireRole("leader"), async (c) => {
  try {
    const leaderId = c.get("leaderId") as string;
    const body = await c.req.json();
    const { current_pin, new_pin } = body ?? {};
    if (typeof new_pin !== "string" || !/^\d{4,6}$/.test(new_pin)) {
      return c.json({ error: "New PIN must be 4 to 6 digits" }, 400);
    }

    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, leaderId),
    });

    if (!profile) return c.json({ error: "Profile not found" }, 404);

    // Validate current PIN if exists
    if (profile.pin_hash) {
      if (!current_pin) {
        return c.json({ error: "Current PIN is required to change it" }, 400);
      }
      const valid = await bcrypt.compare(current_pin, profile.pin_hash);
      if (!valid) {
        return c.json({ error: "Current PIN is incorrect" }, 401);
      }
    }

    // Atomic update with 12-round bcrypt hashing
    const pinHash = await bcrypt.hash(new_pin, 12);
    await db
      .update(profilesTable)
      .set({ pin_hash: pinHash })
      .where(eq(profilesTable.id, leaderId));

    return c.json({ success: true, message: "PIN updated successfully" });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /profiles/register/first-timer - Creates unlinked profile & sends verification email
app.post("/profiles/register/first-timer", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = RegisterVisitorBody.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

    const { clerk_id: _clerk_id, ...rest } = parsed.data;

    if (await phoneInUse(parsed.data.phone)) {
      return c.json({ error: "This number is already registered", duplicate: true }, 409);
    }

    // Generate secure 32-byte hexadecimal link verification token
    const token = randomHexToken(32);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 72); // 72-hour expiry

    const [profile] = await db
      .insert(profilesTable)
      .values({
        ...rest,
        clerk_id: null,
        role: "visitor",
        link_token: token,
        link_token_expires_at: expiresAt,
        link_token_used: false,
      })
      .returning();

    // Verification link routed through Frontend URL
    const verificationLink = `${
      Deno.env.get("FRONTEND_URL") || "http://localhost:5173"
    }/verify?token=${token}`;
    const emailBody = `
      <div style="font-family: 'Inter', sans-serif; background-color: #0B0F14; color: #E6E8EB; padding: 24px; border-radius: 8px;">
        <h2 style="color: #2A9D8F; font-family: 'Sora', sans-serif;">Verify Your Youth Connect Profile</h2>
        <p>Hi ${profile.full_name},</p>
        <p>Thank you for registering at Youth Connect! To complete your membership and link your login credentials, please click the verification button below:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationLink}" style="background-color: #2A9D8F; color: #E6E8EB; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">Verify Account</a>
        </div>
        <p style="font-size: 14px; color: #A0AEC0;">This verification link will expire in 72 hours. If you did not sign up, you can safely ignore this email.</p>
        <p style="font-size: 12px; color: #718096; margin-top: 20px;">Or copy this link: <a href="${verificationLink}" style="color: #2A9D8F;">${verificationLink}</a></p>
      </div>
    `;

    await db.insert(pendingEmailsTable).values({
      to_address: profile.email || "",
      subject: "Verify Your Youth Connect Profile",
      body_html: emailBody,
    });

    return c.json({ success: true }, 201);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /profiles/verify-link - Verifies token and binds clerk_id to profile (Clerk-auth)
app.post("/profiles/verify-link", async (c) => {
  try {
    const clerkId = await getClerkUserId(c.req.raw);
    if (!clerkId) {
      return c.json(
        { error: "Unauthorized: Please log in first to verify your profile link" },
        401,
      );
    }

    const body = await c.req.json();
    const { token } = body ?? {};
    if (typeof token !== "string" || !token) {
      return c.json({ error: "Token is required" }, 400);
    }

    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.link_token, token),
    });

    if (!profile) {
      return c.json({ error: "Invalid verification link token" }, 400);
    }

    if (profile.link_token_used) {
      return c.json({ error: "This verification link has already been used" }, 400);
    }

    if (
      profile.link_token_expires_at &&
      new Date() > new Date(profile.link_token_expires_at)
    ) {
      return c.json({ error: "This verification link has expired (72h limit)" }, 400);
    }

    // Link clerk_id, mark token as used, and reset token fields
    await db
      .update(profilesTable)
      .set({
        clerk_id: clerkId,
        link_token_used: true,
        link_token: null,
        link_token_expires_at: null,
      })
      .where(eq(profilesTable.id, profile.id))
      .returning();

    // Create automatic pending membership request if not already present
    const existingReq = await db.query.membershipRequestsTable.findFirst({
      where: eq(membershipRequestsTable.profile_id, profile.id),
    });

    if (!existingReq) {
      await db.insert(membershipRequestsTable).values({
        profile_id: profile.id,
        reason: "First-timer link verification profile matching",
        status: "pending",
      });
      await notifyLeadersOfMembershipRequest(
        profile.full_name,
        "First-timer link verification profile matching",
      );
    }

    return c.json({ success: true }, 200);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /profiles/register - Standard immediate Clerk registration (kept for compatibility)
app.post("/profiles/register", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = RegisterVisitorBody.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const clerkId = await getClerkUserId(c.req.raw);
    const { clerk_id, ...rest } = parsed.data;
    if (await phoneInUse(parsed.data.phone)) {
      return c.json({ error: "This number is already registered", duplicate: true }, 409);
    }
    const linkedClerkId = clerkId ?? clerk_id ?? null;
    const [profile] = await db
      .insert(profilesTable)
      .values({
        ...rest,
        clerk_id: linkedClerkId && linkedClerkId.trim() ? linkedClerkId : null,
        role: "visitor",
      })
      .returning();
    return c.json(profile, 201);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /profiles/members-directory - member|leader|super_admin only (protected: leaders)
app.get("/profiles/members-directory", requireRole("leader"), async (c) => {
  try {
    const q = c.req.query();
    const { search, role, page, limit, offset } = parseMembersDirectoryQuery(q);

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

    return c.json({ data, total, page, limit });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /profiles - Enforced paginated profiles listing (protected: leaders)
app.get("/profiles", requireRole("leader"), async (c) => {
  try {
    const query = c.req.query();
    const search = typeof query.search === "string" ? query.search : undefined;
    const role = typeof query.role === "string" ? query.role : undefined;

    // Enforce pagination boundaries (default page: 1, pageSize: 50, max limit: 100)
    const page = Math.max(1, parseInt(String(query.page ?? "1"), 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(String(query.pageSize ?? "50"), 10)));
    const offset = (page - 1) * pageSize;

    let whereClause;
    if (role && search) {
      whereClause = and(
        eq(profilesTable.role, role as Profile["role"]),
        or(
          ilike(profilesTable.full_name, `%${search}%`),
          ilike(profilesTable.phone, `%${search}%`),
        ),
      );
    } else if (role) {
      whereClause = eq(profilesTable.role, role as Profile["role"]);
    } else if (search) {
      whereClause = or(
        ilike(profilesTable.full_name, `%${search}%`),
        ilike(profilesTable.phone, `%${search}%`),
      );
    }

    // 1. Fetch total count
    const [countResult] = await db
      .select({ value: count() })
      .from(profilesTable)
      .where(whereClause);
    const total = countResult?.value ? Number(countResult.value) : 0;

    // 2. Fetch paginated records
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
        created_at: profilesTable.created_at,
        can_create_events: profilesTable.can_create_events,
        can_view_kpis: profilesTable.can_view_kpis,
        can_view_members: profilesTable.can_view_members,
        can_view_attendance: profilesTable.can_view_attendance,
      })
      .from(profilesTable)
      .where(whereClause)
      .limit(pageSize)
      .offset(offset);

    return c.json(profiles);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /profiles/:id - View profile by ID (protected: leaders)
app.get("/profiles/:id", requireRole("leader"), async (c) => {
  try {
    const id = c.req.param("id");
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, id),
    });
    if (!profile) return c.json({ error: "Profile not found" }, 404);
    return c.json(profile);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /profiles/:id/promote - Promote profile to full member, queues email (protected: leaders)
app.post("/profiles/:id/promote", requireRole("leader"), async (c) => {
  try {
    const id = c.req.param("id");
    const [updated] = await db
      .update(profilesTable)
      .set({ role: "member" })
      .where(eq(profilesTable.id, id))
      .returning();
    if (!updated) return c.json({ error: "Profile not found" }, 404);

    if (updated.email) {
      const hasClerkAccount = !!updated.clerk_id;
      const signUpUrl = `${
        Deno.env.get("FRONTEND_URL") ?? "https://youth-connect-tau.vercel.app"
      }/sign-up`;
      const ctaHtml = hasClerkAccount
        ? `<p>Log in to see upcoming events, RSVP, and check in on Fridays.</p>`
        : `<p><a href="${signUpUrl}" style="background:#2A9D8F;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;margin-top:8px">Create Your Login</a></p><p style="font-size:12px;color:#888;margin-top:4px">Or copy this link: ${signUpUrl}</p>`;

      const emailBody = `
        <div style="font-family: 'Inter', sans-serif; background-color: #0B0F14; color: #E6E8EB; padding: 24px; border-radius: 8px;">
          <h2 style="color: #2A9D8F; font-family: 'Sora', sans-serif;">Welcome to Jeremiah Generation Youth!</h2>
          <p>Hi <strong>${updated.full_name}</strong>,</p>
          <p>You have been approved as a full member of Jeremiah Generation Youth.</p>
          ${ctaHtml}
          <p style="margin-top: 24px; font-weight: bold;">See you on Friday,</p>
          <p style="color: #2A9D8F; font-weight: bold;">Jeremiah Generation Youth Team</p>
        </div>
      `;

      await db.insert(pendingEmailsTable).values({
        to_address: updated.email,
        subject: "Welcome — you are now a member of Jeremiah Generation Youth",
        body_html: emailBody,
      });
    }
    return c.json(updated);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /profiles/:id/revoke-membership - Demotes member back to visitor (protected: leaders)
app.post("/profiles/:id/revoke-membership", requireRole("leader"), async (c) => {
  try {
    const id = c.req.param("id");
    const [updated] = await db
      .update(profilesTable)
      .set({ role: "visitor" })
      .where(eq(profilesTable.id, id))
      .returning();
    if (!updated) return c.json({ error: "Profile not found" }, 404);
    return c.json(updated);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// PATCH /profiles/:id/role - Promote/demote leaders & super admins (protected: super_admin)
app.patch("/profiles/:id/role", requireRole("super_admin"), async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const { role } = body ?? {};
    if (!["leader", "super_admin"].includes(role)) {
      return c.json({ error: "Invalid role" }, 400);
    }

    const profileToUpdate = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, id),
    });
    if (!profileToUpdate) return c.json({ error: "Profile not found" }, 404);

    if (role === "super_admin" && profileToUpdate.role !== "super_admin") {
      const superAdmins = await db.query.profilesTable.findMany({
        where: eq(profilesTable.role, "super_admin"),
      });
      if (superAdmins.length >= 4) {
        return c.json({ error: "All super admin slots filled" }, 400);
      }
    }

    const [updated] = await db
      .update(profilesTable)
      .set({ role })
      .where(eq(profilesTable.id, id))
      .returning();

    if (!updated) return c.json({ error: "Profile not found" }, 404);

    if (role === "leader") {
      await db
        .insert(leaderPermissionsTable)
        .values({
          profile_id: id,
          can_create_events: false,
          can_manage_members: false,
          can_view_kpis: false,
          can_approve_membership: false,
        })
        .onConflictDoNothing();
    }

    return c.json(updated);
  } catch (err) {
    console.error(err);
    // Surface a Postgres unique-violation (e.g. a super-admin limit index) as a
    // clean client error instead of a blank 500.
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      return c.json({ error: "Super admin limit reached" }, 409);
    }
    return c.json({ error: "Internal server error" }, 500);
  }
});

// PATCH /profiles/:id/permissions - Modify leader permissions directly (protected: super_admin)
app.patch("/profiles/:id/permissions", requireRole("super_admin"), async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const PermissionUpdateBody = z.object({
      can_create_events: z.boolean().optional(),
      can_view_kpis: z.boolean().optional(),
      can_view_members: z.boolean().optional(),
      can_view_attendance: z.boolean().optional(),
    });
    const parsed = PermissionUpdateBody.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

    const { can_create_events, can_view_kpis, can_view_members, can_view_attendance } =
      parsed.data;

    const [updated] = await db
      .update(profilesTable)
      .set({
        ...(can_create_events !== undefined && { can_create_events }),
        ...(can_view_kpis !== undefined && { can_view_kpis }),
        ...(can_view_members !== undefined && { can_view_members }),
        ...(can_view_attendance !== undefined && { can_view_attendance }),
      })
      .where(eq(profilesTable.id, id))
      .returning();

    if (!updated) return c.json({ error: "Profile not found" }, 404);
    return c.json(updated);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// PATCH /profiles/:id - Update member profile info (protected: leaders)
app.patch("/profiles/:id", requireRole("leader"), async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const {
      full_name,
      phone,
      email,
      gender,
      age,
      school,
      parent_phone,
      parent_name,
      whatsapp_opt_in,
      avatar_url,
    } = body ?? {};
    const updateData: Record<string, unknown> = {};
    if (full_name !== undefined) updateData.full_name = full_name;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (gender !== undefined) updateData.gender = gender;
    if (age !== undefined) updateData.age = age === null ? null : parseInt(String(age), 10);
    if (school !== undefined) updateData.school = school;
    if (parent_phone !== undefined) updateData.parent_phone = parent_phone;
    if (parent_name !== undefined) updateData.parent_name = parent_name;
    if (whatsapp_opt_in !== undefined) updateData.whatsapp_opt_in = whatsapp_opt_in;
    if (avatar_url !== undefined) updateData.avatar_url = avatar_url;

    if (
      updateData.phone !== undefined &&
      (await phoneInUse(updateData.phone, id))
    ) {
      return c.json({ error: "This number is already registered", duplicate: true }, 409);
    }

    const [updated] = await db
      .update(profilesTable)
      .set(updateData)
      .where(eq(profilesTable.id, id))
      .returning();

    if (!updated) return c.json({ error: "Profile not found" }, 404);
    return c.json(updated);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// DELETE /profiles/:id - Hard deletes profile (protected: super_admin)
app.delete("/profiles/:id", requireRole("super_admin"), async (c) => {
  try {
    const id = c.req.param("id");
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, id),
    });

    if (!profile) {
      return c.json({ error: "Profile not found" }, 404);
    }

    await deleteProfileCascade(profile.id);

    const clerkSecret = Deno.env.get("CLERK_SECRET_KEY");
    if (profile.clerk_id && clerkSecret) {
      try {
        await fetch(`https://api.clerk.com/v1/users/${profile.clerk_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${clerkSecret}` },
        });
      } catch (clerkErr) {
        console.error(
          "Failed to delete Clerk user after profile cascade",
          { clerkErr, orphanedClerkId: profile.clerk_id, profileId: id },
        );
      }
    }

    return c.json({ success: true }, 200);
  } catch (err) {
    console.error(err, "Delete failed");
    return c.json({ error: "Delete failed" }, 500);
  }
});

// POST /profiles/avatar/upload - avatar upload (Supabase Storage wiring is a later phase)
// TODO(P3 storage): wire to Supabase Storage. For now read formData and return 501.
app.post("/profiles/avatar/upload", async (c) => {
  const auth = await resolveAuth(c.req.raw);
  const profileId = auth?.profileId ?? null;
  if (!profileId) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  // Consume the multipart body so the request is fully read.
  await c.req.formData().catch(() => null);
  return c.json(
    { error: "Avatar upload moves to Supabase Storage in a later phase" },
    501,
  );
});

// POST /profiles/merge - merge a duplicate profile into another (super_admin only)
app.post("/profiles/merge", requireRole("super_admin"), async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { keepId, mergeId } = body ?? {};
    if (typeof keepId !== "string" || typeof mergeId !== "string") {
      return c.json({ error: "keepId and mergeId are required" }, 400);
    }
    if (keepId === mergeId) {
      return c.json({ error: "Cannot merge a profile into itself" }, 400);
    }

    let mergeClerkId: string | null = null;
    try {
      ({ mergeClerkId } = await mergeProfiles(keepId, mergeId));
    } catch (err) {
      if (err instanceof Error && err.message === "PROFILE_NOT_FOUND") {
        return c.json({ error: "Profile not found" }, 404);
      }
      throw err;
    }

    const clerkSecret = Deno.env.get("CLERK_SECRET_KEY");
    if (mergeClerkId && clerkSecret) {
      try {
        await fetch(`https://api.clerk.com/v1/users/${mergeClerkId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${clerkSecret}` },
        });
      } catch (clerkErr) {
        console.warn("Failed to delete merged Clerk user — DB merge already done", clerkErr);
      }
    }

    return c.json({ success: true });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

Deno.serve(app.fetch);
