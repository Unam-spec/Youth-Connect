// Supabase Edge Function: leaders
// Port of artifacts/api-server/src/routes/leaders.ts (every route).
//
// Mirrors the porting conventions established in profiles/index.ts:
//  - createApp() from ../_shared/router.ts; FULL paths incl /leaders segment.
//  - requireLeaderSession(...) -> requireRole(...) from ../_shared/auth.ts.
//  - req.leaderId -> c.get("leaderId"); req.log.error -> console.error.
//  - bcrypt -> npm:bcryptjs@2; zod -> npm:zod@3 (inline, mirroring api-zod).
//  - emails queued into pendingEmailsTable (never sendEmail directly).
//  - deleteProfileCascade ported inline (copied from profiles/index.ts).

import { createApp } from "../_shared/router.ts";
import { db } from "../_shared/db.ts";
import {
  profilesTable,
  leaderPermissionsTable,
  attendanceTable,
  rsvpsTable,
  checkInRequestsTable,
  membershipRequestsTable,
  eventsTable,
  pendingEmailsTable,
} from "../_shared/schema.ts";
import { requireRole } from "../_shared/auth.ts";
import { and, eq, inArray } from "npm:drizzle-orm@0.45.2";
import bcrypt from "npm:bcryptjs@2";
import { z } from "npm:zod@3";

const app = createApp();

// ── Inline zod body schemas (ported from @workspace/api-zod) ─────────────────
const AddLeaderBody = z.object({
  profile_id: z.string(),
  pin: z.string(),
  can_create_events: z.boolean().default(true),
  can_manage_members: z.boolean().default(false),
  can_view_kpis: z.boolean().default(true),
  can_approve_membership: z.boolean().default(false),
});

const UpdateLeaderPermissionsBody = z.object({
  can_create_events: z.boolean().optional(),
  can_manage_members: z.boolean().optional(),
  can_view_kpis: z.boolean().optional(),
  can_approve_membership: z.boolean().optional(),
});

const VerifyLeaderPinBody = z.object({
  phone: z.string(),
  pin: z.string(),
});

// ── Local helpers (ported from api-server/src/lib) ───────────────────────────

/** Mirrors lib/deleteProfileCascade.ts deleteProfileCascade (copied from profiles/index.ts). */
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

/** Crypto-random integer in [min, max] (replaces Node crypto.randomInt(min, max)). */
function randomInt(min: number, max: number): number {
  const range = max - min;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return min + (buf[0] % range);
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /leaders - Lists all leaders (protected: leaders and super_admins)
app.get("/leaders", requireRole("leader"), async (c) => {
  try {
    const leaderProfiles = await db
      .select({
        id: profilesTable.id,
        full_name: profilesTable.full_name,
        role: profilesTable.role,
        phone: profilesTable.phone,
        email: profilesTable.email,
        can_create_events: profilesTable.can_create_events,
        can_view_kpis: profilesTable.can_view_kpis,
        can_view_members: profilesTable.can_view_members,
        can_view_attendance: profilesTable.can_view_attendance,
        created_at: profilesTable.created_at,
      })
      .from(profilesTable)
      .where(inArray(profilesTable.role, ["leader", "super_admin"]));

    const shaped = leaderProfiles.map((p) => ({
      profile_id: p.id,
      can_create_events: p.role === "super_admin" ? true : (p.can_create_events ?? false),
      can_manage_members: p.role === "super_admin" ? true : (p.can_view_members ?? false),
      can_view_kpis: p.role === "super_admin" ? true : (p.can_view_kpis ?? false),
      can_view_members: p.role === "super_admin" ? true : (p.can_view_members ?? false),
      can_view_attendance: p.role === "super_admin" ? true : (p.can_view_attendance ?? false),
      can_approve_membership: p.role === "super_admin" ? true : false,
      profile: p,
    }));

    return c.json(shaped);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /leaders - Promotes a member to a leader (protected: super_admin only)
app.post("/leaders", requireRole("super_admin"), async (c) => {
  try {
    const body = await c.req.json();
    const parsed = AddLeaderBody.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const { profile_id, pin, ...perms } = parsed.data;

    // Hash PIN with 12 rounds
    const pinHash = await bcrypt.hash(pin, 12);

    await db
      .update(profilesTable)
      .set({ role: "leader", pin_hash: pinHash })
      .where(eq(profilesTable.id, profile_id));

    const [permissions] = await db
      .insert(leaderPermissionsTable)
      .values({ profile_id, ...perms })
      .onConflictDoUpdate({ target: leaderPermissionsTable.profile_id, set: perms })
      .returning();

    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, profile_id),
    });
    return c.json({ ...permissions, profile }, 201);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// PATCH /leaders/:profileId - Update leader permissions (protected: super_admin only)
app.patch("/leaders/:profileId", requireRole("super_admin"), async (c) => {
  try {
    const profileId = c.req.param("profileId");
    const body = await c.req.json();
    const parsed = UpdateLeaderPermissionsBody.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

    const [updated] = await db
      .update(leaderPermissionsTable)
      .set(parsed.data)
      .where(eq(leaderPermissionsTable.profile_id, profileId))
      .returning();

    if (!updated) return c.json({ error: "Leader not found" }, 404);
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, profileId),
    });
    return c.json({ ...updated, profile });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /leaders/:profileId/demote - Demote leader to member (protected: super_admin only)
app.post("/leaders/:profileId/demote", requireRole("super_admin"), async (c) => {
  try {
    const profileId = c.req.param("profileId");
    const [updated] = await db
      .update(profilesTable)
      .set({ role: "member", pin_hash: null, session_token: null })
      .where(eq(profilesTable.id, profileId))
      .returning();
    if (!updated) return c.json({ error: "Profile not found" }, 404);

    await db
      .delete(leaderPermissionsTable)
      .where(eq(leaderPermissionsTable.profile_id, profileId));

    return c.json({ success: true, profile: updated });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /leaders/:profileId/demote-to-leader - Demote super_admin to leader (protected: super_admin only)
app.post("/leaders/:profileId/demote-to-leader", requireRole("super_admin"), async (c) => {
  try {
    const profileId = c.req.param("profileId");
    const [updated] = await db
      .update(profilesTable)
      .set({ role: "leader", session_token: null })
      .where(eq(profilesTable.id, profileId))
      .returning();
    if (!updated) return c.json({ error: "Profile not found" }, 404);

    return c.json({ success: true, profile: updated });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// DELETE /leaders/:profileId/account - Delete profile entirely (protected: super_admin only)
app.delete("/leaders/:profileId/account", requireRole("super_admin"), async (c) => {
  try {
    const profileId = c.req.param("profileId");
    const target = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, profileId),
    });
    if (!target) return c.json({ error: "Profile not found" }, 404);

    await deleteProfileCascade(target.id);

    const clerkSecret = Deno.env.get("CLERK_SECRET_KEY");
    if (target.clerk_id && clerkSecret) {
      try {
        await fetch(`https://api.clerk.com/v1/users/${target.clerk_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${clerkSecret}` },
        });
      } catch (clerkErr) {
        console.error(
          "Failed to delete Clerk user — DB row already removed",
          { clerkErr, orphanedClerkId: target.clerk_id, profileId },
        );
      }
    }

    return c.body(null, 204);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// DELETE /leaders/:profileId - Remove leader permissions (protected: super_admin only)
app.delete("/leaders/:profileId", requireRole("super_admin"), async (c) => {
  try {
    const profileId = c.req.param("profileId");
    await db
      .delete(leaderPermissionsTable)
      .where(eq(leaderPermissionsTable.profile_id, profileId));
    await db
      .update(profilesTable)
      .set({ role: "member", pin_hash: null, session_token: null })
      .where(eq(profilesTable.id, profileId));
    return c.body(null, 204);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /leaders/verify-pin - Leader PIN login (Public)
app.post("/leaders/verify-pin", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = VerifyLeaderPinBody.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const { phone, pin } = parsed.data;

    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.phone, phone),
    });
    if (!profile || !profile.pin_hash) {
      return c.json({ error: "Invalid phone number or PIN" }, 401);
    }

    let valid = false;
    if (profile.pin_hash.length < 20) {
      if (pin === profile.pin_hash) {
        valid = true;
        const newHash = await bcrypt.hash(pin, 12); // Hash with strength 12
        await db
          .update(profilesTable)
          .set({ pin_hash: newHash })
          .where(eq(profilesTable.id, profile.id));
      }
    } else {
      valid = await bcrypt.compare(pin, profile.pin_hash);
    }
    if (!valid) return c.json({ error: "Invalid PIN" }, 401);

    // Generate database-backed session_token
    const sessionToken = crypto.randomUUID();
    const expiresAt = Date.now() + 8 * 60 * 60 * 1000; // 8 hours

    await db
      .update(profilesTable)
      .set({ session_token: sessionToken })
      .where(eq(profilesTable.id, profile.id));

    return c.json({
      success: true,
      profile_id: profile.id,
      session_token: sessionToken,
      expires_at: expiresAt,
      can_create_events: profile.role === "super_admin" ? true : profile.can_create_events,
      can_view_kpis: profile.role === "super_admin" ? true : profile.can_view_kpis,
      can_view_members: profile.role === "super_admin" ? true : profile.can_view_members,
      can_view_attendance: profile.role === "super_admin" ? true : profile.can_view_attendance,
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /leaders/pins - Lists leaders without PIN information (protected: super_admin only)
app.get("/leaders/pins", requireRole("super_admin"), async (c) => {
  try {
    const leaders = await db
      .select({
        id: profilesTable.id,
        full_name: profilesTable.full_name,
        phone: profilesTable.phone,
      })
      .from(profilesTable)
      .where(inArray(profilesTable.role, ["leader", "super_admin"]));
    return c.json(leaders);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /leaders/:id/set-pin - Secure manual PIN setting (protected: super_admin only)
app.post("/leaders/:id/set-pin", requireRole("super_admin"), async (c) => {
  try {
    const id = c.req.param("id");
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, id),
    });
    if (!profile) return c.json({ error: "Leader not found" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const pin = body?.pin;
    if (!pin || typeof pin !== "string" || pin.length !== 4) {
      return c.json({ error: "Invalid PIN format. Must be a 4-digit string." }, 400);
    }

    const pinHash = await bcrypt.hash(pin, 12); // Strength 12 bcrypt

    await db
      .update(profilesTable)
      .set({ pin_hash: pinHash })
      .where(eq(profilesTable.id, profile.id));

    return c.json({ success: true });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /leaders/:id/reset-pin - Secure random PIN reset (protected: super_admin only)
app.post("/leaders/:id/reset-pin", requireRole("super_admin"), async (c) => {
  try {
    const id = c.req.param("id");
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, id),
    });
    if (!profile) return c.json({ error: "Leader not found" }, 404);

    // Generate crypto-random 6 digit PIN
    const rawPin = randomInt(100000, 999999).toString();
    const pinHash = await bcrypt.hash(rawPin, 12); // Strength 12 bcrypt

    await db
      .update(profilesTable)
      .set({ pin_hash: pinHash })
      .where(eq(profilesTable.id, profile.id));

    // Send PIN via background emails queue (SendGrid)
    const emailBody = `
      <div style="font-family: 'Inter', sans-serif; background-color: #0B0F14; color: #E6E8EB; padding: 24px; border-radius: 8px;">
        <h2 style="color: #2A9D8F; font-family: 'Sora', sans-serif;">Youth Connect PIN Reset</h2>
        <p>Hi ${profile.full_name},</p>
        <p>A super administrator has reset your leader PIN. Here is your temporary PIN for accessing the leader dashboard:</p>
        <div style="background-color: rgba(255,255,255,0.05); padding: 16px; text-align: center; border-radius: 6px; margin: 20px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 0.25em; color: #3DBFB0;">${rawPin}</span>
        </div>
        <p style="font-size: 14px; color: #A0AEC0;">Please log in using this PIN and update it immediately to a personal PIN under your settings.</p>
      </div>
    `;

    await db.insert(pendingEmailsTable).values({
      to_address: profile.email || "",
      subject: "Youth Connect — Secure PIN Reset",
      body_html: emailBody,
    });

    return c.json({ success: true });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /leaders/session - Mint a PIN-equivalent session_token for a Clerk-authenticated
// leader/super_admin. This lets the x-leader-session header authenticate requests (and the
// SSE chat stream, which can't send an Authorization header) even when the Clerk Bearer
// token isn't attached. Guarded by requireRole, which accepts the Clerk JWT.
app.post("/leaders/session", requireRole("leader"), async (c) => {
  try {
    const leaderId = c.get("leaderId") as string;
    const sessionToken = crypto.randomUUID();
    const [profile] = await db
      .update(profilesTable)
      .set({ session_token: sessionToken })
      .where(eq(profilesTable.id, leaderId))
      .returning();
    if (!profile) return c.json({ error: "Profile not found" }, 404);

    const isSuperAdmin = profile.role === "super_admin";
    return c.json({
      profile_id: profile.id,
      session_token: sessionToken,
      expires_at: Date.now() + 8 * 60 * 60 * 1000, // 8 hours
      role: profile.role,
      can_create_events: isSuperAdmin ? true : profile.can_create_events,
      can_view_kpis: isSuperAdmin ? true : profile.can_view_kpis,
      can_view_members: isSuperAdmin ? true : profile.can_view_members,
      can_view_attendance: isSuperAdmin ? true : profile.can_view_attendance,
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /leaders/logout - Clear own session (protected: leader)
app.post("/leaders/logout", requireRole("leader"), async (c) => {
  try {
    const leaderId = c.get("leaderId") as string;
    await db
      .update(profilesTable)
      .set({ session_token: null })
      .where(eq(profilesTable.id, leaderId));
    return c.json({ success: true });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /leaders/:id/revoke-session - Revoke leader session (protected: super_admin only)
app.post("/leaders/:id/revoke-session", requireRole("super_admin"), async (c) => {
  try {
    const id = c.req.param("id");
    const leaderId = c.get("leaderId") as string;
    if (id === leaderId) {
      return c.json({ error: "Cannot revoke your own session" }, 403);
    }

    await db
      .update(profilesTable)
      .set({ session_token: null })
      .where(eq(profilesTable.id, id));
    return c.json({ success: true });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

Deno.serve(app.fetch);
