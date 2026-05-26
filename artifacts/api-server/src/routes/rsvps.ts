import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and } from "drizzle-orm";
import { db, rsvpsTable, eventsTable, profilesTable } from "@workspace/db";
import { UpsertRsvpBody } from "@workspace/api-zod";

const router = Router();

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
      return res.status(404).json({ error: "Profile not found" });
    }

    if (profile.role !== "leader" && profile.role !== "super_admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { event_id, status } = req.query;

    const rsvps = await db
      .select({
        member_name: profilesTable.full_name,
        member_role: profilesTable.role,
        event_name: eventsTable.title,
        status: rsvpsTable.status,
        created_at: rsvpsTable.created_at,
      })
      .from(rsvpsTable)
      .leftJoin(profilesTable, eq(rsvpsTable.profile_id, profilesTable.id))
      .leftJoin(eventsTable, eq(rsvpsTable.event_id, eventsTable.id))
      .where(
        and(
          event_id ? eq(rsvpsTable.event_id, event_id as string) : undefined,
          status
            ? eq(rsvpsTable.status, status as "going" | "not_going")
            : undefined,
        ),
      );

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
      const event = await db.query.eventsTable.findFirst({
        where: eq(eventsTable.id, req.params.eventId),
      });
      return res.json({ ...updated, event: event ?? null });
    }
    const [rsvp] = await db
      .insert(rsvpsTable)
      .values({
        event_id: req.params.eventId,
        profile_id: profile.id,
        status: parsed.data.status,
      })
      .returning();
    const event = await db.query.eventsTable.findFirst({
      where: eq(eventsTable.id, req.params.eventId),
    });
    return res.json({ ...rsvp, event: event ?? null });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
