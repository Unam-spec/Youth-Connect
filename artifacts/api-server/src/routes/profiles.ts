import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, ilike, or, and } from "drizzle-orm";
import { db, profilesTable } from "@workspace/db";
import {
  RegisterVisitorBody,
  UpdateMyProfileBody,
  ListProfilesQueryParams,
} from "@workspace/api-zod";

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

    if (!auth?.userId) {
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

export default router;
