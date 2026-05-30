import { Router, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, gte, sql, count } from "drizzle-orm";
import {
  db,
  eventsTable,
  rsvpsTable,
  attendanceTable,
  profilesTable,
} from "@workspace/db";
import { CreateEventBody, UpdateEventBody } from "@workspace/api-zod";
import { sendEmail } from "../lib/twilio";

const router = Router();

router.get("/events", async (req: Request, res: Response) => {
  try {
    const publicOnly = req.query.public_only === "true";
    const upcoming = req.query.upcoming === "true";
    const today = new Date().toISOString().split("T")[0];

    const events = await db
      .select()
      .from(eventsTable)
      .where(
        publicOnly && upcoming
          ? and(eq(eventsTable.is_public, true), gte(eventsTable.date, today))
          : publicOnly
            ? eq(eventsTable.is_public, true)
            : upcoming
              ? gte(eventsTable.date, today)
              : undefined,
      )
      .orderBy(eventsTable.date);

    const eventsWithCounts = await Promise.all(
      events.map(async (event: any) => {
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
      }),
    );
    return res.json(eventsWithCounts);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/events", async (req: Request, res: Response) => {
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
    const eventDate =
      parsed.data.date instanceof Date
        ? parsed.data.date.toISOString().split("T")[0]
        : parsed.data.date;

    const [event] = await db
      .insert(eventsTable)
      .values({
        title: parsed.data.title,
        description: parsed.data.description,
        date: eventDate,
        time: parsed.data.time,
        location: parsed.data.location,
        age_min: parsed.data.age_min ?? null,
        age_max: parsed.data.age_max ?? null,
        custom_requirements: parsed.data.custom_requirements ?? null,
        is_public: parsed.data.is_public ?? true,
        created_by: creatorProfile?.id ?? null,
      })
      .returning();
    // Notify all members & leaders with emails about the new event (public events only)
    if (event.is_public) {
      const { inArray } = await import("drizzle-orm");
      const recipients = await db
        .select({ email: profilesTable.email, full_name: profilesTable.full_name })
        .from(profilesTable)
        .where(inArray(profilesTable.role, ["member", "leader", "super_admin"]));

      const eventDate = new Date(event.date).toLocaleDateString("en-ZA", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      });

      await Promise.allSettled(
        recipients
          .filter((r: any) => !!r.email)
          .map((r: any) =>
            sendEmail({
              to: r.email!,
              subject: `New event: ${event.title} — Jeremiah Generation Youth`,
              text: `Hi ${r.full_name},\n\nA new event has been published.\n\n${event.title}\nDate: ${eventDate}\nTime: ${event.time}\nLocation: ${event.location}\n${event.description ? "\n" + event.description + "\n" : ""}\nLog in to RSVP.\n\nJeremiah Generation Youth`,
              html: `<p>Hi <strong>${r.full_name}</strong>,</p><p>A new event has been published:</p><table style="border-collapse:collapse;margin:8px 0"><tr><td style="padding:4px 12px 4px 0;color:#888">Event</td><td><strong>${event.title}</strong></td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Date</td><td>${eventDate}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Time</td><td>${event.time}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Location</td><td>${event.location}</td></tr></table>${event.description ? `<p>${event.description}</p>` : ""}<p>Log in to RSVP.<br/>Jeremiah Generation Youth</p>`,
            })
          )
      );

      // 24h reminder: if the event is exactly tomorrow, send reminder emails now.
      // (For a proper scheduler this would run as a cron job — this covers the case
      //  where an event is created the day before.)
      const eventDateObj = new Date(event.date);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const isTomorrow =
        eventDateObj.getFullYear() === tomorrow.getFullYear() &&
        eventDateObj.getMonth() === tomorrow.getMonth() &&
        eventDateObj.getDate() === tomorrow.getDate();

      if (isTomorrow) {
        await Promise.allSettled(
          recipients
            .filter((r: any) => !!r.email)
            .map((r: any) =>
              sendEmail({
                to: r.email!,
                subject: `Reminder: ${event.title} is tomorrow — Jeremiah Generation Youth`,
                text: `Hi ${r.full_name},\n\nJust a reminder that "${event.title}" is tomorrow.\n\nDate: ${eventDate}\nTime: ${event.time}\nLocation: ${event.location}\n\nSee you there,\nJeremiah Generation Youth`,
                html: `<p>Hi <strong>${r.full_name}</strong>,</p><p>Just a reminder that <strong>${event.title}</strong> is tomorrow.</p><table style="border-collapse:collapse;margin:8px 0"><tr><td style="padding:4px 12px 4px 0;color:#888">Time</td><td>${event.time}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Location</td><td>${event.location}</td></tr></table><p>See you there,<br/>Jeremiah Generation Youth</p>`,
              })
            )
        );
      }
    }

    return res
      .status(201)
      .json({ ...event, rsvp_count: 0, attendance_count: 0 });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/events/:id", async (req: Request, res: Response) => {
  try {
    const event = await db.query.eventsTable.findFirst({
      where: eq(eventsTable.id, req.params.id as string),
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

router.patch("/events/:id", async (req: Request, res: Response) => {
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
    if (parsed.data.date instanceof Date) {
      updateData.date = parsed.data.date.toISOString().split("T")[0];
    }
    if (parsed.data.custom_requirements !== undefined) {
      updateData.custom_requirements = parsed.data.custom_requirements;
    }
    const [updated] = await db
      .update(eventsTable)
      .set(updateData as any)
      .where(eq(eventsTable.id, req.params.id as string))
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

router.delete("/events/:id", async (req: Request, res: Response) => {
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

    const eventId = req.params.id as string;

    await db.transaction(async (tx: any) => {
      // Delete associated RSVPs
      await tx.delete(rsvpsTable).where(eq(rsvpsTable.event_id, eventId));
      // Delete associated attendance
      await tx.delete(attendanceTable).where(eq(attendanceTable.event_id, eventId));
      // Delete the event
      await tx.delete(eventsTable).where(eq(eventsTable.id, eventId));
    });

    return res.status(200).json({ success: true, deletedId: eventId });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/events/:id/stats", async (req: Request, res: Response) => {
  try {
    const [rsvpCounts] = await db
      .select({
        total: count(),
        going: sql<number>`count(*) filter (where status = 'going')`,
        not_going: sql<number>`count(*) filter (where status = 'not_going')`,
        maybe: sql<number>`count(*) filter (where status = 'maybe')`,
      })
      .from(rsvpsTable)
      .where(eq(rsvpsTable.event_id, req.params.id as string));
    const [attendResult] = await db
      .select({ count: count() })
      .from(attendanceTable)
      .where(eq(attendanceTable.event_id, req.params.id as string));
    return res.json({
      event_id: req.params.id as string,
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
