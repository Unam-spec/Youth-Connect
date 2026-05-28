import { Router } from "express";
import { resolveAuth, isPrivilegedAuth } from "../lib/permissions";
import { getAuth } from "@clerk/express";
import { eq, ilike, or, and } from "drizzle-orm";
import bcrypt from "bcrypt";
import { db, profilesTable } from "@workspace/db";
import {
  RegisterVisitorBody,
  UpdateMyProfileBody,
  ListProfilesQueryParams,
} from "@workspace/api-zod";
import { z } from "zod"; // Import z for schema definition

const router = Router();

router.get("/profiles/me", async (req, res) => {
  try {
    const auth = getAuth(req);
    const clerkId = auth?.userId;

    if (!clerkId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, clerkId),
    });

    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    return res.json(profile);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/profiles/me", async (req, res) => {
  try {
    const auth = getAuth(req);
    const clerkId = auth?.userId;

    if (!clerkId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = UpdateMyProfileBody.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const existing = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, clerkId),
    });

    if (!existing) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const [updated] = await db
      .update(profilesTable)
      .set(parsed.data)
      .where(eq(profilesTable.clerk_id, clerkId))
      .returning();

    return res.json(updated);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/profiles/me/pin", async (req, res) => {
  try {
    const auth = getAuth(req);
    const clerkId = auth?.userId;

    if (!clerkId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, clerkId),
    });

    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    return res.json({ hasPIN: !!profile.pin_hash });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/profiles/me/pin", async (req, res) => {
  try {
    const auth = getAuth(req);
    const clerkId = auth?.userId;

    if (!clerkId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { pin } = req.body;

    if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: "PIN must be exactly 4 digits" });
    }

    const pinHash = await bcrypt.hash(pin, 10);

    const [updated] = await db
      .update(profilesTable)
      .set({ pin_hash: pinHash, pin_plain: pin })
      .where(eq(profilesTable.clerk_id, clerkId))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Profile not found" });
    }

    return res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/profiles/register", async (req, res) => {
  try {
    const parsed = RegisterVisitorBody.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const auth = getAuth(req);
    const { clerk_id, ...rest } = parsed.data;
    const linkedClerkId = auth?.userId ?? clerk_id ?? null;

    const [profile] = await db
      .insert(profilesTable)
      .values({
        ...rest,
        clerk_id: linkedClerkId && linkedClerkId.trim() ? linkedClerkId : null,
        role: "visitor",
      })
      .returning();

    return res.status(201).json(profile);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/profiles", async (req, res) => {
  try {
    const auth = getAuth(req);
    const hasLeaderSession = (() => {
      try {
        const h = req.headers["x-leader-session"];
        if (!h) return false;
        const s = JSON.parse(h as string);
        return typeof s?.expires_at === "number" && Date.now() < s.expires_at;
      } catch { return false; }
    })();

    if (!auth?.userId && !hasLeaderSession) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // For Clerk-authenticated users, verify they are a leader/super_admin
    if (auth?.userId) {
      const requester = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.clerk_id, auth.userId),
      });
      if (!requester || (requester.role !== "leader" && requester.role !== "super_admin")) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }
    // For leader-session users, the session itself proves authorization
    if (false) { // dummy block to maintain structure
      return res.status(403).json({ error: "Forbidden" });
    }

    const search =
      typeof req.query.search === "string" ? req.query.search : undefined;
    const role =
      typeof req.query.role === "string" ? req.query.role : undefined;
    const limit = parseInt(String(req.query.limit ?? "50"));
    const offset = parseInt(String(req.query.offset ?? "0"));

    let whereClause;

    if (role && search) {
      // Both role filter AND search term: profile must match role AND contain search term
      whereClause = and(
        eq(profilesTable.role, role as any),
        or(
          ilike(profilesTable.full_name, `%${search}%`),
          ilike(profilesTable.phone, `%${search}%`),
        ),
      );
    } else if (role) {
      // Role filter only
      whereClause = eq(profilesTable.role, role as any);
    } else if (search) {
      // Search only: match across name fields using OR
      whereClause = or(
        ilike(profilesTable.full_name, `%${search}%`),
        ilike(profilesTable.phone, `%${search}%`),
      );
    }

    const profiles = await db
      .select({
        id: profilesTable.id,
        full_name: profilesTable.full_name,
        role: profilesTable.role,
        phone: profilesTable.phone,
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

    return res.json(profiles);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/profiles/:id", async (req, res) => {
  try {
    const auth = getAuth(req);

    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, req.params.id),
    });

    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    return res.json(profile);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/profiles/:id/promote", async (req, res) => {
  try {
    const auth = getAuth(req);

    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const [updated] = await db
      .update(profilesTable)
      .set({ role: "member" })
      .where(eq(profilesTable.id, req.params.id))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Profile not found" });
    }

    return res.json(updated);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/profiles/:id/revoke-membership", async (req, res) => {
  try {
    const auth = getAuth(req);

    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const [updated] = await db
      .update(profilesTable)
      .set({ role: "visitor" })
      .where(eq(profilesTable.id, req.params.id))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Profile not found" });
    }

    return res.json(updated);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/profiles/:id/role", async (req, res) => {
  try {
    const auth = getAuth(req);

    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const requesterProfile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, auth.userId),
    });

    if (!requesterProfile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    if (requesterProfile.role !== "super_admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { role } = req.body;

    if (!["leader", "super_admin"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const profileToUpdate = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, req.params.id),
    });

    if (!profileToUpdate) {
      return res.status(404).json({ error: "Profile not found" });
    }

    if (role === "super_admin" && profileToUpdate.role !== "super_admin") {
      const superAdmins = await db.query.profilesTable.findMany({
        where: eq(profilesTable.role, "super_admin"),
      });

      if (superAdmins.length >= 4) {
        return res.status(400).json({ error: "All super admin slots filled" });
      }
    }

    const [updated] = await db
      .update(profilesTable)
      .set({ role })
      .where(eq(profilesTable.id, req.params.id))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Profile not found" });
    }

    return res.json(updated);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/profiles/:id/permissions", async (req, res) => {
  try {
    const auth = getAuth(req);

    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Check if requester is super_admin
    const requesterProfile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, auth.userId),
    });

    if (!requesterProfile || requesterProfile.role !== "super_admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Zod schema for permission update
    const PermissionUpdateBody = z.object({
      can_create_events: z.boolean().optional(),
      can_view_kpis: z.boolean().optional(),
      can_view_members: z.boolean().optional(),
      can_view_attendance: z.boolean().optional(),
    });

    const parsed = PermissionUpdateBody.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const { id } = req.params;
    const {
      can_create_events,
      can_view_kpis,
      can_view_members,
      can_view_attendance,
    } = parsed.data;

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

    if (!updated) {
      return res.status(404).json({ error: "Profile not found" });
    }

    return res.json(updated);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
