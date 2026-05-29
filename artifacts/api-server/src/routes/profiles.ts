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
import { z } from "zod";
import { sendEmail } from "../lib/twilio";

function hasLeaderSession(req: any): boolean {
  try {
    const h = req.headers["x-leader-session"];
    if (!h) return false;
    const s = JSON.parse(h as string);
    return typeof s?.expires_at === "number" && Date.now() < s.expires_at;
  } catch {
    return false;
  }
}

const router = Router();

router.get("/profiles/me", async (req, res) => {
  try {
    const auth = getAuth(req);
    const clerkId = auth?.userId;

    if (!clerkId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    let profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, clerkId),
    });

    if (!profile) {
      // Extract name, email, phone from Clerk session claims
      const claims = (req as any).auth?.sessionClaims ?? {};
      const firstName = claims?.given_name ?? claims?.first_name ?? "";
      const lastName = claims?.family_name ?? claims?.last_name ?? "";
      const fullName =
        [firstName, lastName].filter(Boolean).join(" ").trim() || "New Member";
      const email: string | null = claims?.email ?? null;
      const phone: string | null = claims?.phone_number ?? null;

      // Try matching existing profile by email first, then phone
      // This auto-links manually-created profiles (leaders, first-timers) when they sign up on Clerk
      if (email) {
        const existing = await db.query.profilesTable.findFirst({
          where: eq(profilesTable.email, email),
        });
        if (existing) {
          const [linked] = await db
            .update(profilesTable)
            .set({ clerk_id: clerkId, email })
            .where(eq(profilesTable.id, existing.id))
            .returning();
          return res.json(linked);
        }
      }

      if (phone) {
        const existingByPhone = await db.query.profilesTable.findFirst({
          where: eq(profilesTable.phone, phone),
        });
        if (existingByPhone) {
          const [linked] = await db
            .update(profilesTable)
            .set({ clerk_id: clerkId })
            .where(eq(profilesTable.id, existingByPhone.id))
            .returning();
          return res.json(linked);
        }
      }

      // No existing profile — create a fresh visitor profile
      const [created] = await db
        .insert(profilesTable)
        .values({
          clerk_id: clerkId,
          full_name: fullName,
          email,
          role: "visitor",
          gender: "other",
          age: 0,
          heard_from: "clerk_signup",
        })
        .returning();
      profile = created;
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
    if (!clerkId) return res.status(401).json({ error: "Unauthorized" });
    const parsed = UpdateMyProfileBody.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });
    const existing = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, clerkId),
    });
    if (!existing) return res.status(404).json({ error: "Profile not found" });
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
    if (!clerkId && !hasLeaderSession(req))
      return res.status(401).json({ error: "Unauthorized" });
    if (!clerkId && hasLeaderSession(req)) {
      const session = JSON.parse(req.headers["x-leader-session"] as string);
      const profile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.id, session.profile_id),
      });
      if (!profile) return res.status(404).json({ error: "Profile not found" });
      return res.json({ hasPIN: !!profile.pin_hash });
    }
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, clerkId),
    });
    if (!profile) return res.status(404).json({ error: "Profile not found" });
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
    if (!clerkId && !hasLeaderSession(req))
      return res.status(401).json({ error: "Unauthorized" });
    const { pin } = req.body;
    if (typeof pin !== "string" || !/^\d{4}$/.test(pin))
      return res.status(400).json({ error: "PIN must be exactly 4 digits" });
    const pinHash = await bcrypt.hash(pin, 10);
    if (!clerkId && hasLeaderSession(req)) {
      const session = JSON.parse(req.headers["x-leader-session"] as string);
      const [updated] = await db
        .update(profilesTable)
        .set({ pin_hash: pinHash, pin_plain: pin })
        .where(eq(profilesTable.id, session.profile_id))
        .returning();
      if (!updated) return res.status(404).json({ error: "Profile not found" });
      return res.json({ success: true });
    }
    const [updated] = await db
      .update(profilesTable)
      .set({ pin_hash: pinHash, pin_plain: pin })
      .where(eq(profilesTable.clerk_id, clerkId))
      .returning();
    if (!updated) return res.status(404).json({ error: "Profile not found" });
    return res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/profiles/register", async (req, res) => {
  try {
    const parsed = RegisterVisitorBody.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });
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
    const isLeaderSess = hasLeaderSession(req);
    if (!auth?.userId && !isLeaderSess)
      return res.status(401).json({ error: "Unauthorized" });
    if (auth?.userId) {
      const requester = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.clerk_id, auth.userId),
      });
      if (
        !requester ||
        (requester.role !== "leader" && requester.role !== "super_admin")
      )
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
      whereClause = and(
        eq(profilesTable.role, role as any),
        or(
          ilike(profilesTable.full_name, `%${search}%`),
          ilike(profilesTable.phone, `%${search}%`),
        ),
      );
    } else if (role) {
      whereClause = eq(profilesTable.role, role as any);
    } else if (search) {
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

// Allow leader session to access /profiles/:id (for my.tsx PIN-auth path)
router.get("/profiles/:id", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId && !hasLeaderSession(req))
      return res.status(401).json({ error: "Unauthorized" });
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, req.params.id),
    });
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    return res.json(profile);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/profiles/:id/promote", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
    const [updated] = await db
      .update(profilesTable)
      .set({ role: "member" })
      .where(eq(profilesTable.id, req.params.id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Profile not found" });
    if (updated.email) {
      await sendEmail({
        to: updated.email,
        subject: "Welcome — you are now a member of Jeremiah Generation Youth",
        text: `Hi ${updated.full_name},\n\nYou have been approved as a full member of Jeremiah Generation Youth.\n\nLog in to see upcoming events, RSVP, and check in on Fridays.\n\nSee you on Friday,\nJeremiah Generation Youth`,
        html: `<p>Hi <strong>${updated.full_name}</strong>,</p><p>You have been approved as a full member of Jeremiah Generation Youth.</p><p>Log in to see upcoming events, RSVP, and check in on Fridays.</p><p>Jeremiah Generation Youth</p>`,
      });
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
    if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
    const [updated] = await db
      .update(profilesTable)
      .set({ role: "visitor" })
      .where(eq(profilesTable.id, req.params.id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Profile not found" });
    return res.json(updated);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/profiles/:id/role", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
    const requesterProfile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, auth.userId),
    });
    if (!requesterProfile || requesterProfile.role !== "super_admin")
      return res.status(403).json({ error: "Forbidden" });
    const { role } = req.body;
    if (!["leader", "super_admin"].includes(role))
      return res.status(400).json({ error: "Invalid role" });
    const profileToUpdate = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, req.params.id),
    });
    if (!profileToUpdate)
      return res.status(404).json({ error: "Profile not found" });
    if (role === "super_admin" && profileToUpdate.role !== "super_admin") {
      const superAdmins = await db.query.profilesTable.findMany({
        where: eq(profilesTable.role, "super_admin"),
      });
      if (superAdmins.length >= 4)
        return res.status(400).json({ error: "All super admin slots filled" });
    }
    const [updated] = await db
      .update(profilesTable)
      .set({ role })
      .where(eq(profilesTable.id, req.params.id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Profile not found" });
    if (role === "leader") {
      const { leaderPermissionsTable } = await import("@workspace/db");
      await db
        .insert(leaderPermissionsTable)
        .values({
          profile_id: req.params.id,
          can_create_events: false,
          can_manage_members: false,
          can_view_kpis: false,
          can_approve_membership: false,
        })
        .onConflictDoNothing();
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
    const isLeaderSess = hasLeaderSession(req);
    if (!auth?.userId && !isLeaderSess)
      return res.status(401).json({ error: "Unauthorized" });
    let requesterProfile: any = null;
    if (auth?.userId) {
      requesterProfile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.clerk_id, auth.userId),
      });
    } else {
      const session = JSON.parse(req.headers["x-leader-session"] as string);
      requesterProfile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.id, session.profile_id),
      });
    }
    if (!requesterProfile || requesterProfile.role !== "super_admin")
      return res.status(403).json({ error: "Forbidden" });
    const PermissionUpdateBody = z.object({
      can_create_events: z.boolean().optional(),
      can_view_kpis: z.boolean().optional(),
      can_view_members: z.boolean().optional(),
      can_view_attendance: z.boolean().optional(),
    });
    const parsed = PermissionUpdateBody.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });
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
      .where(eq(profilesTable.id, req.params.id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Profile not found" });
    return res.json(updated);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/profiles/:id", async (req, res) => {
  try {
    const auth = getAuth(req);
    const isLeaderSess = hasLeaderSession(req);
    if (!auth?.userId && !isLeaderSess)
      return res.status(401).json({ error: "Unauthorized" });
    let requesterProfile: any = null;
    if (auth?.userId) {
      requesterProfile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.clerk_id, auth.userId),
      });
    } else {
      const session = JSON.parse(req.headers["x-leader-session"] as string);
      requesterProfile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.id, session.profile_id),
      });
    }
    if (!requesterProfile || requesterProfile.role !== "super_admin")
      return res.status(403).json({ error: "Forbidden. Super admins only." });

    const profileToDelete = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, req.params.id),
    });
    if (!profileToDelete)
      return res.status(404).json({ error: "Profile not found" });

    if (profileToDelete.role === "super_admin") {
      return res
        .status(400)
        .json({
          error: "Cannot delete super admins. Revoke their role first.",
        });
    }

    await db.delete(profilesTable).where(eq(profilesTable.id, req.params.id));
    return res.json({ message: "Profile deleted successfully" });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
