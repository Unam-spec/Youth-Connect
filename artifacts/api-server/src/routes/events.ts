import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, gte, sql, count } from "drizzle-orm";
import { db, eventsTable, rsvpsTable, attendanceTable, profilesTable } from "@workspace/db";
import {
  CreateEventBody,
  UpdateEventBody,
} from "@workspace/api-zod";

const router = Router();

router.get("/events", async (req, res) => {
  try {
    const publicOnly = req.query.public_only === "true";
    const upcoming = req.query.upcoming === "true";
    const today = new Date().toISOString().split("T")[0];

    const events = await db.select().from(eventsTable)
      .where(
        publicOnly && upcoming
          ? and(eq(eventsTable.is_public, true), gte(eventsTable.date, today))
          : publicOnly
          ? eq(eventsTable.is_public, true)
          : upcoming
          ? gte(eventsTable.date, today)
          : undefined
      )
      .orderBy(eventsTable.date);

    const eventsWithCounts = await Promise.all(
      events.map(async (event) => {
        const [rsvpResult] = await db
          .select({ count: count() })
          .from(rsvpsTable)
          .where(eq(rsvpsTable.event_id, event.id));
        const [attendResult] = await db
          .select({ count: count() })
          .from(attendanceTable)
          .where(eq(attendanceTable.event_id, event.id));
        return {
          ...event,
          rsvp_count: rsvpResult?.count ?? 0,
          attendance_count: attendResult?.count ?? 0,
        };
      })
    );
    return res.json(eventsWithCounts);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/events", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const parsed = CreateEventBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const creatorProfile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, auth.userId),
    });
    const [event] = await db
      .insert(eventsTable)
      .values({
        title: parsed.data.title,
        description: parsed.data.description,
        date: String(parsed.data.date),
        time: parsed.data.time,
        location: parsed.data.location,
        age_min: parsed.data.age_min ?? null,
        age_max: parsed.data.age_max ?? null,
        custom_requirements: parsed.data.custom_requirements ?? null,
        is_public: parsed.data.is_public ?? true,
        created_by: creatorProfile?.id ?? null,
      })
      .returning();
    return res.status(201).json({ ...event, rsvp_count: 0, attendance_count: 0 });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/events/:id", async (req, res) => {
  try {
    const event = await db.query.eventsTable.findFirst({
      where: eq(eventsTable.id, req.params.id),
    });
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    const [rsvpResult] = await db
      .select({ count: count() })
      .from(rsvpsTable)
      .where(eq(rsvpsTable.event_id, event.id));
    const [attendResult] = await db
      .select({ count: count() })
      .from(attendanceTable)
      .where(eq(attendanceTable.event_id, event.id));
    return res.json({
      ...event,
      rsvp_count: rsvpResult?.count ?? 0,
      attendance_count: attendResult?.count ?? 0,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/events/:id", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const parsed = UpdateEventBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const updateData: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.custom_requirements !== undefined) {
      updateData.custom_requirements = parsed.data.custom_requirements;
    }
    const [updated] = await db
      .update(eventsTable)
      .set(updateData as any)
      .where(eq(eventsTable.id, req.params.id))
      .returning();
    if (!updated) {
      return res.status(404).json({ error: "Event not found" });
    }
    return res.json({ ...updated, rsvp_count: 0, attendance_count: 0 });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/events/:id", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    await db.delete(eventsTable).where(eq(eventsTable.id, req.params.id));
    return res.status(204).send();
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/events/:id/stats", async (req, res) => {
  try {
    const [rsvpCounts] = await db
      .select({
        total: count(),
        going: sql<number>`count(*) filter (where status = 'going')`,
        not_going: sql<number>`count(*) filter (where status = 'not_going')`,
        maybe: sql<number>`count(*) filter (where status = 'maybe')`,
      })
      .from(rsvpsTable)
      .where(eq(rsvpsTable.event_id, req.params.id));
    const [attendResult] = await db
      .select({ count: count() })
      .from(attendanceTable)
      .where(eq(attendanceTable.event_id, req.params.id));
    return res.json({
      event_id: req.params.id,
      rsvp_count: Number(rsvpCounts?.total ?? 0),
      going_count: Number(rsvpCounts?.going ?? 0),
      not_going_count: Number(rsvpCounts?.not_going ?? 0),
      maybe_count: Number(rsvpCounts?.maybe ?? 0),
      attendance_count: Number(attendResult?.count ?? 0),
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
