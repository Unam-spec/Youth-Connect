import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and } from "drizzle-orm";
import { db, rsvpsTable, eventsTable, profilesTable } from "@workspace/db";
import { UpsertRsvpBody } from "@workspace/api-zod";

const router = Router();

router.get("/rsvps", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, auth.userId),
    });
    if (!profile) {
      return res.json([]);
    }
    const rsvps = await db
      .select({
        id: rsvpsTable.id,
        event_id: rsvpsTable.event_id,
        profile_id: rsvpsTable.profile_id,
        status: rsvpsTable.status,
        created_at: rsvpsTable.created_at,
        event: {
          id: eventsTable.id,
          title: eventsTable.title,
          description: eventsTable.description,
          date: eventsTable.date,
          time: eventsTable.time,
          location: eventsTable.location,
          is_public: eventsTable.is_public,
          created_at: eventsTable.created_at,
          created_by: eventsTable.created_by,
          age_min: eventsTable.age_min,
          age_max: eventsTable.age_max,
          custom_requirements: eventsTable.custom_requirements,
        },
      })
      .from(rsvpsTable)
      .leftJoin(eventsTable, eq(rsvpsTable.event_id, eventsTable.id))
      .where(eq(rsvpsTable.profile_id, profile.id));
    return res.json(rsvps);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/rsvps/event/:eventId", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const rsvps = await db
      .select({
        id: rsvpsTable.id,
        event_id: rsvpsTable.event_id,
        profile_id: rsvpsTable.profile_id,
        status: rsvpsTable.status,
        created_at: rsvpsTable.created_at,
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
      .from(rsvpsTable)
      .leftJoin(profilesTable, eq(rsvpsTable.profile_id, profilesTable.id))
      .where(eq(rsvpsTable.event_id, req.params.eventId));
    return res.json(rsvps);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/rsvps/:eventId", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const parsed = UpsertRsvpBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, auth.userId),
    });
    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }
    const existing = await db.query.rsvpsTable.findFirst({
      where: and(
        eq(rsvpsTable.event_id, req.params.eventId),
        eq(rsvpsTable.profile_id, profile.id),
      ),
    });
    if (existing) {
      const [updated] = await db
        .update(rsvpsTable)
        .set({ status: parsed.data.status })
        .where(eq(rsvpsTable.id, existing.id))
        .returning();
      return res.json({ ...updated, event: null });
    }
    const [rsvp] = await db
      .insert(rsvpsTable)
      .values({
        event_id: req.params.eventId,
        profile_id: profile.id,
        status: parsed.data.status,
      })
      .returning();
    return res.json({ ...rsvp, event: null });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
