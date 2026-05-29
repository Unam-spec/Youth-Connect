import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import { db, leaderPermissionsTable, profilesTable } from "@workspace/db";
import {
  AddLeaderBody,
  UpdateLeaderPermissionsBody,
  VerifyLeaderPinBody,
  UpdateLeaderPinBody,
} from "@workspace/api-zod";

const router = Router();

function isAuthorized(req: any): boolean {
  const clerkAuth = getAuth(req);
  if (clerkAuth?.userId) return true;
  try {
    const h = req.headers["x-leader-session"];
    if (!h) return false;
    const s = JSON.parse(h as string);
    return typeof s?.expires_at === "number" && Date.now() < s.expires_at;
  } catch { return false; }
}

async function getRequesterProfile(req: any) {
  const clerkAuth = getAuth(req);
  if (clerkAuth?.userId) {
    return db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, clerkAuth.userId),
    });
  }
  try {
    const h = req.headers["x-leader-session"];
    if (h) {
      const s = JSON.parse(h as string);
      return db.query.profilesTable.findFirst({
        where: eq(profilesTable.id, s.profile_id),
      });
    }
  } catch { /* ignore */ }
  return null;
}

router.get("/leaders", async (req, res) => {
  try {
    if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });
    const { inArray } = await import("drizzle-orm");
    const leaderProfiles = await db
      .select({
<<<<<<< HEAD
        profile_id: profilesTable.id,
=======
        id: profilesTable.id,
        full_name: profilesTable.full_name,
        role: profilesTable.role,
        phone: profilesTable.phone,
        email: profilesTable.email,
        pin_plain: profilesTable.pin_plain,
>>>>>>> 52162a5949a949c576f91a9d8e39deb1277f2ea5
        can_create_events: profilesTable.can_create_events,
        can_view_kpis: profilesTable.can_view_kpis,
        can_view_members: profilesTable.can_view_members,
        can_view_attendance: profilesTable.can_view_attendance,
<<<<<<< HEAD
        profile: {
          id: profilesTable.id,
          full_name: profilesTable.full_name,
          role: profilesTable.role,
          phone: profilesTable.phone,
          email: profilesTable.email,
          gender: profilesTable.gender,
          age: profilesTable.age,
          heard_from: profilesTable.heard_from,
          clerk_id: profilesTable.clerk_id,
          created_at: profilesTable.created_at,
        },
      })
      .from(profilesTable)
      .where(eq(profilesTable.role, "leader"));
    return res.json(leaders);
=======
        created_at: profilesTable.created_at,
      })
      .from(profilesTable)
      .where(inArray(profilesTable.role, ["leader", "super_admin"]));

    const shaped = leaderProfiles.map(p => ({
      profile_id: p.id,
      // super_admins always have all permissions checked
      can_create_events: p.role === "super_admin" ? true : (p.can_create_events ?? false),
      can_manage_members: p.role === "super_admin" ? true : (p.can_view_members ?? false),
      can_view_kpis: p.role === "super_admin" ? true : (p.can_view_kpis ?? false),
      can_view_members: p.role === "super_admin" ? true : (p.can_view_members ?? false),
      can_view_attendance: p.role === "super_admin" ? true : (p.can_view_attendance ?? false),
      can_approve_membership: p.role === "super_admin" ? true : false,
      profile: p,
    }));

    return res.json(shaped);
>>>>>>> 52162a5949a949c576f91a9d8e39deb1277f2ea5
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/leaders", async (req, res) => {
  try {
    if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });
    const parsed = AddLeaderBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { profile_id, pin, ...perms } = parsed.data;
    const pinHash = await bcrypt.hash(pin, 10);
    await db.update(profilesTable)
      .set({ role: "leader", pin_hash: pinHash, pin_plain: pin })
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

router.patch("/leaders/:profileId", async (req, res) => {
  try {
    if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });
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

// Demote leader → member (super admin only)
router.post("/leaders/:profileId/demote", async (req, res) => {
  try {
    const requester = await getRequesterProfile(req);
    if (!requester || requester.role !== "super_admin")
      return res.status(403).json({ error: "Super admin only" });

    const [updated] = await db
      .update(profilesTable)
      .set({ role: "member", pin_hash: null, pin_plain: null })
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

// Demote super_admin → leader (super admin only)
router.post("/leaders/:profileId/demote-to-leader", async (req, res) => {
  try {
    const requester = await getRequesterProfile(req);
    if (!requester || requester.role !== "super_admin")
      return res.status(403).json({ error: "Super admin only" });

    const [updated] = await db
      .update(profilesTable)
      .set({ role: "leader" })
      .where(eq(profilesTable.id, req.params.profileId))
      .returning();
    if (!updated) return res.status(404).json({ error: "Profile not found" });

    return res.json({ success: true, profile: updated });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Delete account from DB entirely (super admin only)
// Also attempts to delete from Clerk if CLERK_SECRET_KEY is set
router.delete("/leaders/:profileId/account", async (req, res) => {
  try {
    const requester = await getRequesterProfile(req);
    if (!requester || requester.role !== "super_admin")
      return res.status(403).json({ error: "Super admin only" });

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

router.delete("/leaders/:profileId", async (req, res) => {
  try {
    if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });
    await db.delete(leaderPermissionsTable).where(eq(leaderPermissionsTable.profile_id, req.params.profileId));
    await db.update(profilesTable)
      .set({ role: "member", pin_hash: null, pin_plain: null })
      .where(eq(profilesTable.id, req.params.profileId));
    return res.status(204).send();
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

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
        const newHash = await bcrypt.hash(pin, 10);
        await db.update(profilesTable).set({ pin_hash: newHash, pin_plain: pin }).where(eq(profilesTable.id, profile.id));
      }
    } else {
      valid = await bcrypt.compare(pin, profile.pin_hash);
    }
    if (!valid) return res.status(401).json({ error: "Invalid PIN" });
    return res.json({
      success: true,
      profile_id: profile.id,
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

router.get("/leaders/pins", async (req, res) => {
  try {
    if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });
    const { inArray } = await import("drizzle-orm");
    const leaders = await db
      .select({
        id: profilesTable.id,
        full_name: profilesTable.full_name,
        phone: profilesTable.phone,
        pin_plain: profilesTable.pin_plain,
      })
      .from(profilesTable)
      .where(inArray(profilesTable.role, ["leader", "super_admin"]));
    return res.json(leaders);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/leaders/update-pin", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
    const parsed = UpdateLeaderPinBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const profile = await db.query.profilesTable.findFirst({ where: eq(profilesTable.clerk_id, auth.userId) });
    if (!profile || !profile.pin_hash) return res.status(401).json({ error: "No PIN set" });
    const valid = await bcrypt.compare(parsed.data.current_pin, profile.pin_hash);
    if (!valid) return res.status(401).json({ error: "Current PIN is incorrect" });
    const newHash = await bcrypt.hash(parsed.data.new_pin, 10);
    await db.update(profilesTable)
      .set({ pin_hash: newHash, pin_plain: parsed.data.new_pin })
      .where(eq(profilesTable.id, profile.id));
    return res.json({ message: "PIN updated successfully" });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/leaders/:profileId/set-pin", async (req, res) => {
  try {
    const requester = await getRequesterProfile(req);
    const isSuperAdmin = requester?.role === "super_admin";
    if (!isSuperAdmin) return res.status(403).json({ error: "Super admin only" });

    const { pin } = req.body;
    if (typeof pin !== "string" || !/^\d{4}$/.test(pin))
      return res.status(400).json({ error: "PIN must be exactly 4 digits" });

    const pinHash = await bcrypt.hash(pin, 10);
    const [updated] = await db
      .update(profilesTable)
      .set({ pin_hash: pinHash, pin_plain: pin })
      .where(eq(profilesTable.id, req.params.profileId))
      .returning({ id: profilesTable.id, full_name: profilesTable.full_name, pin_plain: profilesTable.pin_plain });

    if (!updated) return res.status(404).json({ error: "Leader not found" });
    return res.json({ success: true, ...updated });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
