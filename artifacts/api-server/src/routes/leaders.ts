import { Router } from "express";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { db, leaderPermissionsTable, profilesTable, pendingEmailsTable } from "@workspace/db";
import {
  AddLeaderBody,
  UpdateLeaderPermissionsBody,
  VerifyLeaderPinBody,
} from "@workspace/api-zod";
import { requireLeaderSession } from "../middlewares/requireLeaderSession";

const router = Router();

// GET /leaders - Lists all leaders (protected: leaders and super_admins)
router.get("/leaders", requireLeaderSession("leader"), async (req, res) => {
  try {
    const { inArray } = await import("drizzle-orm");
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

    const shaped = leaderProfiles.map(p => ({
      profile_id: p.id,
      can_create_events: p.role === "super_admin" ? true : (p.can_create_events ?? false),
      can_manage_members: p.role === "super_admin" ? true : (p.can_view_members ?? false),
      can_view_kpis: p.role === "super_admin" ? true : (p.can_view_kpis ?? false),
      can_view_members: p.role === "super_admin" ? true : (p.can_view_members ?? false),
      can_view_attendance: p.role === "super_admin" ? true : (p.can_view_attendance ?? false),
      can_approve_membership: p.role === "super_admin" ? true : false,
      profile: p,
    }));

    return res.json(shaped);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /leaders - Promotes a member to a leader (protected: super_admin only)
router.post("/leaders", requireLeaderSession("super_admin"), async (req, res) => {
  try {
    const parsed = AddLeaderBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { profile_id, pin, ...perms } = parsed.data;
    
    // Hash PIN with 12 rounds
    const pinHash = await bcrypt.hash(pin, 12);
    
    await db.update(profilesTable)
      .set({ role: "leader", pin_hash: pinHash })
      .where(eq(profilesTable.id, profile_id));
      
    const [permissions] = await db.insert(leaderPermissionsTable)
      .values({ profile_id, ...perms })
      .onConflictDoUpdate({ target: leaderPermissionsTable.profile_id, set: perms })
      .returning();
      
    const profile = await db.query.profilesTable.findFirst({ where: eq(profilesTable.id, profile_id) });
    return res.status(201).json({ ...permissions, profile });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /leaders/:profileId - Update leader permissions (protected: super_admin only)
router.patch("/leaders/:profileId", requireLeaderSession("super_admin"), async (req, res) => {
  try {
    const parsed = UpdateLeaderPermissionsBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    
    const [updated] = await db.update(leaderPermissionsTable)
      .set(parsed.data)
      .where(eq(leaderPermissionsTable.profile_id, req.params.profileId))
      .returning();
      
    if (!updated) return res.status(404).json({ error: "Leader not found" });
    const profile = await db.query.profilesTable.findFirst({ where: eq(profilesTable.id, req.params.profileId) });
    return res.json({ ...updated, profile });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /leaders/:profileId/demote - Demote leader to member (protected: super_admin only)
router.post("/leaders/:profileId/demote", requireLeaderSession("super_admin"), async (req, res) => {
  try {
    const [updated] = await db
      .update(profilesTable)
      .set({ role: "member", pin_hash: null, session_token: null })
      .where(eq(profilesTable.id, req.params.profileId))
      .returning();
    if (!updated) return res.status(404).json({ error: "Profile not found" });

    await db.delete(leaderPermissionsTable)
      .where(eq(leaderPermissionsTable.profile_id, req.params.profileId));

    return res.json({ success: true, profile: updated });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /leaders/:profileId/demote-to-leader - Demote super_admin to leader (protected: super_admin only)
router.post("/leaders/:profileId/demote-to-leader", requireLeaderSession("super_admin"), async (req, res) => {
  try {
    const [updated] = await db
      .update(profilesTable)
      .set({ role: "leader", session_token: null })
      .where(eq(profilesTable.id, req.params.profileId))
      .returning();
    if (!updated) return res.status(404).json({ error: "Profile not found" });

    return res.json({ success: true, profile: updated });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /leaders/:profileId/account - Delete profile entirely (protected: super_admin only)
router.delete("/leaders/:profileId/account", requireLeaderSession("super_admin"), async (req, res) => {
  try {
    const target = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, req.params.profileId),
    });
    if (!target) return res.status(404).json({ error: "Profile not found" });

    // Delete from Clerk if they have a clerk_id
    if (target.clerk_id && process.env.CLERK_SECRET_KEY) {
      try {
        await fetch(`https://api.clerk.com/v1/users/${target.clerk_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
        });
      } catch (clerkErr) {
        req.log.warn({ clerkErr }, "Failed to delete Clerk user — continuing with DB delete");
      }
    }

    await db.delete(leaderPermissionsTable).where(eq(leaderPermissionsTable.profile_id, req.params.profileId));
    await db.delete(profilesTable).where(eq(profilesTable.id, req.params.profileId));

    return res.status(204).send();
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /leaders/:profileId - Remove leader permissions (protected: super_admin only)
router.delete("/leaders/:profileId", requireLeaderSession("super_admin"), async (req, res) => {
  try {
    await db.delete(leaderPermissionsTable).where(eq(leaderPermissionsTable.profile_id, req.params.profileId));
    await db.update(profilesTable)
      .set({ role: "member", pin_hash: null, session_token: null })
      .where(eq(profilesTable.id, req.params.profileId));
    return res.status(204).send();
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /leaders/verify-pin - Leader PIN login (Public)
router.post("/leaders/verify-pin", async (req, res) => {
  try {
    const parsed = VerifyLeaderPinBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { phone, pin } = parsed.data;
    
    const profile = await db.query.profilesTable.findFirst({ where: eq(profilesTable.phone, phone) });
    if (!profile || !profile.pin_hash) return res.status(401).json({ error: "Invalid phone number or PIN" });
    
    let valid = false;
    if (profile.pin_hash.length < 20) {
      if (pin === profile.pin_hash) {
        valid = true;
        const newHash = await bcrypt.hash(pin, 12); // Hash with strength 12
        await db.update(profilesTable).set({ pin_hash: newHash }).where(eq(profilesTable.id, profile.id));
      }
    } else {
      valid = await bcrypt.compare(pin, profile.pin_hash);
    }
    if (!valid) return res.status(401).json({ error: "Invalid PIN" });

    // Generate database-backed session_token
    const sessionToken = crypto.randomUUID();
    const expiresAt = Date.now() + 8 * 60 * 60 * 1000; // 8 hours

    await db.update(profilesTable)
      .set({ session_token: sessionToken })
      .where(eq(profilesTable.id, profile.id));

    return res.json({
      success: true,
      profile_id: profile.id,
      session_token: sessionToken,
      expires_at: expiresAt,
      role: profile.role,
      can_create_events: profile.role === "super_admin" ? true : profile.can_create_events,
      can_view_kpis: profile.role === "super_admin" ? true : profile.can_view_kpis,
      can_view_members: profile.role === "super_admin" ? true : profile.can_view_members,
      can_view_attendance: profile.role === "super_admin" ? true : profile.can_view_attendance,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /leaders/pins - Lists leaders without PIN information (protected: super_admin only)
router.get("/leaders/pins", requireLeaderSession("super_admin"), async (req, res) => {
  try {
    const { inArray } = await import("drizzle-orm");
    const leaders = await db
      .select({
        id: profilesTable.id,
        full_name: profilesTable.full_name,
        phone: profilesTable.phone,
      })
      .from(profilesTable)
      .where(inArray(profilesTable.role, ["leader", "super_admin"]));
    return res.json(leaders);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /leaders/:id/reset-pin - Secure random PIN reset (protected: super_admin only)
router.post("/leaders/:id/reset-pin", requireLeaderSession("super_admin"), async (req, res) => {
  try {
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, req.params.id),
    });
    if (!profile) return res.status(404).json({ error: "Leader not found" });

    // Generate crypto-random 6 digit PIN
    const rawPin = crypto.randomInt(100000, 999999).toString();
    const pinHash = await bcrypt.hash(rawPin, 12); // Strength 12 bcrypt

    await db.update(profilesTable)
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

    return res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /leaders/logout - Clear own session (protected: leader)
router.post("/leaders/logout", requireLeaderSession("leader"), async (req, res) => {
  try {
    await db.update(profilesTable)
      .set({ session_token: null })
      .where(eq(profilesTable.id, req.leaderId!));
    return res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /leaders/:id/revoke-session - Revoke leader session (protected: super_admin only)
router.post("/leaders/:id/revoke-session", requireLeaderSession("super_admin"), async (req, res) => {
  try {
    await db.update(profilesTable)
      .set({ session_token: null })
      .where(eq(profilesTable.id, req.params.id));
    return res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
