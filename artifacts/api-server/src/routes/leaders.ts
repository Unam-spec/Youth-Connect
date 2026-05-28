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

router.get("/leaders", async (req, res) => {
  try {
    if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });
    const leaders = await db
      .select({
        profile_id: leaderPermissionsTable.profile_id,
        can_create_events: leaderPermissionsTable.can_create_events,
        can_manage_members: leaderPermissionsTable.can_manage_members,
        can_view_kpis: leaderPermissionsTable.can_view_kpis,
        can_approve_membership: leaderPermissionsTable.can_approve_membership,
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
      .from(leaderPermissionsTable)
      .leftJoin(profilesTable, eq(leaderPermissionsTable.profile_id, profilesTable.id));
    return res.json(leaders);
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
      can_create_events: profile.can_create_events,
      can_view_kpis: profile.can_view_kpis,
      can_view_members: profile.can_view_members,
      can_view_attendance: profile.can_view_attendance,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/leaders/pins", async (req, res) => {
  try {
    if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });
    const leaders = await db
      .select({
        id: profilesTable.id,
        full_name: profilesTable.full_name,
        phone: profilesTable.phone,
        pin_plain: profilesTable.pin_plain,
      })
      .from(profilesTable)
      .where(eq(profilesTable.role, "leader"));
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

export default router;
