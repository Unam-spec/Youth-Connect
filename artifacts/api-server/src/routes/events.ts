import { Router, Request, Response } from "express";
import { eq, and, or, gte, sql, count, inArray } from "drizzle-orm";
import {
  db,
  eventsTable,
  rsvpsTable,
  attendanceTable,
  profilesTable,
  pendingEmailsTable,
} from "@workspace/db";
import { CreateEventBody, UpdateEventBody } from "@workspace/api-zod";
import { requireLeaderSession } from "../middlewares/requireLeaderSession";

const router = Router();

// GET /events - Retrieve list of events
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

// POST /events - Create a new event (protected: leader)
router.post("/events", requireLeaderSession("leader"), async (req: Request, res: Response) => {
  try {
    const parsed = CreateEventBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    
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
        poster_url: parsed.data.poster_url ?? null,
        age_min: parsed.data.age_min ?? null,
        age_max: parsed.data.age_max ?? null,
        custom_requirements: parsed.data.custom_requirements ?? null,
        is_public: parsed.data.is_public ?? true,
        target_gender: parsed.data.target_gender ?? null,
        created_by: req.leaderId ?? null,
      })
      .returning();

    // (WhatsApp broadcast removed: now handled manually via the frontend Messaging Hub)

    // Queue email notifications for new public events
    if (event.is_public) {
      // Gender-targeted events only email the matching members; leaders and
      // super-admins are always notified so they stay aware of every event.
      const audienceFilter = event.target_gender
        ? or(
            inArray(profilesTable.role, ["leader", "super_admin"]),
            and(
              eq(profilesTable.role, "member"),
              eq(profilesTable.gender, event.target_gender),
            ),
          )
        : inArray(profilesTable.role, ["member", "leader", "super_admin"]);
      const recipients = await db
        .select({ email: profilesTable.email, full_name: profilesTable.full_name })
        .from(profilesTable)
        .where(audienceFilter);

      let SouthAfricaDate = "";
      try {
        SouthAfricaDate = new Date(event.date).toLocaleDateString("en-ZA", {
          weekday: "long", year: "numeric", month: "long", day: "numeric",
        });
      } catch {
        SouthAfricaDate = String(event.date);
      }

      if (recipients.length > 0) {
        const emailInserts = recipients
          .filter((r: any) => !!r.email)
          .map((r: any) => ({
            to_address: r.email!,
            subject: `New event: ${event.title} — Jeremiah Generation Youth`,
            body_html: `
              <div style="font-family: 'Inter', sans-serif; background-color: #0B0F14; color: #E6E8EB; padding: 24px; border-radius: 8px;">
                <h2 style="color: #2A9D8F; font-family: 'Sora', sans-serif;">New Event Published!</h2>
                <p>Hi <strong>${r.full_name}</strong>,</p>
                <p>A new event has been published on the calendar:</p>
                <table style="border-collapse: collapse; margin: 16px 0; background-color: rgba(255,255,255,0.02); border-radius: 6px; width: 100%;">
                  <tr><td style="padding: 8px 12px; color: #A0AEC0; width: 100px;">Event:</td><td style="padding: 8px 12px; font-weight: bold; color: #3DBFB0;">${event.title}</td></tr>
                  <tr><td style="padding: 8px 12px; color: #A0AEC0;">Date:</td><td style="padding: 8px 12px;">${SouthAfricaDate}</td></tr>
                  <tr><td style="padding: 8px 12px; color: #A0AEC0;">Time:</td><td style="padding: 8px 12px;">${event.time}</td></tr>
                  <tr><td style="padding: 8px 12px; color: #A0AEC0;">Location:</td><td style="padding: 8px 12px;">${event.location}</td></tr>
                </table>
                ${event.description ? `<p style="margin-top: 16px; color: #CBD5E0;">${event.description}</p>` : ""}
                <p style="margin-top: 24px;">Please log in to your dashboard to RSVP.</p>
                <p style="margin-top: 16px; font-weight: bold; color: #2A9D8F;">Jeremiah Generation Youth Team</p>
              </div>
            `,
          }));

        if (emailInserts.length > 0) {
          await db.insert(pendingEmailsTable).values(emailInserts);
        }

        // 24h tomorrow reminder email check
        const eventDateObj = new Date(event.date);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const isTomorrow =
          eventDateObj.getFullYear() === tomorrow.getFullYear() &&
          eventDateObj.getMonth() === tomorrow.getMonth() &&
          eventDateObj.getDate() === tomorrow.getDate();

        if (isTomorrow) {
          const reminderInserts = recipients
            .filter((r: any) => !!r.email)
            .map((r: any) => ({
              to_address: r.email!,
              subject: `Reminder: ${event.title} is tomorrow — Jeremiah Generation Youth`,
              body_html: `
                <div style="font-family: 'Inter', sans-serif; background-color: #0B0F14; color: #E6E8EB; padding: 24px; border-radius: 8px;">
                  <h2 style="color: #2A9D8F; font-family: 'Sora', sans-serif;">Event Reminder</h2>
                  <p>Hi <strong>${r.full_name}</strong>,</p>
                  <p>Just a quick reminder that <strong>${event.title}</strong> is happening tomorrow!</p>
                  <table style="border-collapse: collapse; margin: 16px 0; background-color: rgba(255,255,255,0.02); border-radius: 6px; width: 100%;">
                    <tr><td style="padding: 8px 12px; color: #A0AEC0; width: 100px;">Time:</td><td style="padding: 8px 12px;">${event.time}</td></tr>
                    <tr><td style="padding: 8px 12px; color: #A0AEC0;">Location:</td><td style="padding: 8px 12px;">${event.location}</td></tr>
                  </table>
                  <p>We look forward to seeing you there!</p>
                  <p style="margin-top: 24px; font-weight: bold; color: #2A9D8F;">Jeremiah Generation Youth Team</p>
                </div>
              `,
            }));

          if (reminderInserts.length > 0) {
            await db.insert(pendingEmailsTable).values(reminderInserts);
          }
        }
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

// GET /events/:id - View single event details
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

// PATCH /events/:id - Update event (protected: leader)
router.patch("/events/:id", requireLeaderSession("leader"), async (req: Request, res: Response) => {
  try {
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

// DELETE /events/:id - Delete event (protected: leader)
router.delete("/events/:id", requireLeaderSession("leader"), async (req: Request, res: Response) => {
  try {
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

// GET /events/:id/stats - Event RSVP and attendance statistics
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
