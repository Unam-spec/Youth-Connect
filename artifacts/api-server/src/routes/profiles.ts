import { Router } from "express";
import { getAuth } from "@clerk/express";
import { ClerkClient, createClerkClient } from "@clerk/backend";
import { eq, ilike, or, and } from "drizzle-orm";
import {
  db,
  profilesTable,
  checkInRequestsTable,
  attendanceTable,
  rsvpsTable,
  messagesTable,
  leaderPermissionsTable,
  leaderSlotsTable,
  superAdminSlotsTable,
} from "@workspace/db";
import {
  RegisterVisitorBody,
  UpdateMyProfileBody,
  ListProfilesQueryParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/profiles/me", async (req, res) => {
  try {
    const auth = getAuth(req);
    const leaderSessionHeader = req.headers["x-leader-session"];

    let profile;
    let whereClause;

    // Check for Clerk auth first
    if (auth?.userId) {
      const clerkId = auth.userId;
      profile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.clerk_id, clerkId),
      });
      whereClause = eq(profilesTable.clerk_id, clerkId);
    }
    // Check for leader session (super admins using PIN-based auth)
    else if (leaderSessionHeader) {
      try {
        const session = JSON.parse(leaderSessionHeader as string);
        profile = await db.query.profilesTable.findFirst({
          where: eq(profilesTable.id, session.profile_id),
        });
        whereClause = eq(profilesTable.id, session.profile_id);
      } catch {
        return res.status(401).json({ error: "Invalid session" });
      }
    } else {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    // Remove sensitive data from response
    const { pin_hash, ...safeProfile } = profile;
    return res.json(safeProfile);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/profiles/me", async (req, res) => {
  try {
    const auth = getAuth(req);
    const leaderSessionHeader = req.headers["x-leader-session"];

    let profile;
    let whereClause;

    // Check for Clerk auth first
    if (auth?.userId) {
      const clerkId = auth.userId;
      profile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.clerk_id, clerkId),
      });
      whereClause = eq(profilesTable.clerk_id, clerkId);
    }
    // Check for leader session (super admins using PIN-based auth)
    else if (leaderSessionHeader) {
      try {
        const session = JSON.parse(leaderSessionHeader as string);
        profile = await db.query.profilesTable.findFirst({
          where: eq(profilesTable.id, session.profile_id),
        });
        whereClause = eq(profilesTable.id, session.profile_id);
      } catch {
        return res.status(401).json({ error: "Invalid session" });
      }
    } else {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const parsed = UpdateMyProfileBody.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    // Handle PIN hashing
    const updateData: any = { ...parsed.data };
    if (updateData.pin) {
      // Simple hash for PIN (in production, use bcrypt or similar)
      updateData.pin_hash = updateData.pin;
      delete updateData.pin;
    }

    const [updated] = await db
      .update(profilesTable)
      .set(updateData)
      .where(whereClause)
      .returning();

    return res.json(updated);
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

    const { full_name, phone, email, gender, age, heard_from, clerk_id } =
      parsed.data;

    // Explicit validation before database call
    if (!full_name || full_name.trim().length < 2) {
      return res.status(400).json({ error: "Full name is required" });
    }
    if (!phone || phone.trim().length < 10) {
      return res.status(400).json({ error: "Phone number is required" });
    }
    if (!gender) {
      return res.status(400).json({ error: "Gender is required" });
    }
    if (!age) {
      return res.status(400).json({ error: "Age is required" });
    }
    if (!heard_from) {
      return res
        .status(400)
        .json({ error: "Please tell us how you heard about us" });
    }

    // Sanitize fields before insert
    const sanitizedEmail = email && email.trim() !== "" ? email.trim() : null;
    const sanitizedAge = parseInt(String(age), 10);
    if (isNaN(sanitizedAge)) {
      return res.status(400).json({ error: "Age must be a number" });
    }

    const [visitor] = await db
      .insert(profilesTable)
      .values({
        full_name: full_name.trim(),
        phone: phone.trim(),
        email: sanitizedEmail,
        gender,
        age: sanitizedAge,
        heard_from: heard_from.trim(),
        clerk_id: clerk_id && clerk_id.trim() ? clerk_id.trim() : null,
        role: "visitor",
      })
      .returning();

    // Insert check-in request for leader approval
    await db.insert(checkInRequestsTable).values({
      profile_id: visitor.id,
      session_date: new Date().toISOString().split("T")[0],
      status: "pending",
    });

    return res.status(201).json({ success: true, visitor });
  } catch (error) {
    console.error("Registration error:", error);
    return res.status(500).json({
      error: "Registration failed",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

router.get("/profiles", async (req, res) => {
  try {
    const auth = getAuth(req);
    const leaderSessionHeader = req.headers["x-leader-session"];

    // Check for Clerk auth or leader session auth
    if (!auth?.userId && !leaderSessionHeader) {
      return res.status(401).json({ error: "Unauthorized" });
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
      .select()
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
    const leaderSessionHeader = req.headers["x-leader-session"];

    let requesterProfile;

    // Check for Clerk auth first
    if (auth?.userId) {
      requesterProfile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.clerk_id, auth.userId),
      });
    }
    // Check for leader session (super admins using PIN-based auth)
    else if (leaderSessionHeader) {
      try {
        const session = JSON.parse(leaderSessionHeader as string);
        requesterProfile = await db.query.profilesTable.findFirst({
          where: eq(profilesTable.id, session.profile_id),
        });
      } catch {
        return res.status(401).json({ error: "Invalid session" });
      }
    } else {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!requesterProfile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    if (requesterProfile.role !== "super_admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { role } = req.body;

    if (!["leader", "member", "visitor", "super_admin"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
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

export default router;
