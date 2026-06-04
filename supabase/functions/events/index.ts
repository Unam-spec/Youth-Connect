// Supabase Edge Function: events
// Port of artifacts/api-server/src/routes/events.ts (every route).
//
// Mirrors the porting conventions established in profiles/index.ts and leaders/index.ts:
//  - createApp() from ../_shared/router.ts; FULL paths incl /events segment.
//  - requireLeaderSession(...) -> requireRole(...) from ../_shared/auth.ts.
//  - req.leaderId -> c.get("leaderId"); req.log.error -> console.error.
//  - zod -> npm:zod@3 (inline, mirroring api-zod CreateEventBody/UpdateEventBody).
//  - emails queued into pendingEmailsTable (never sendEmail directly).
//  - process.env -> Deno.env.get; exact response shapes/status codes preserved.

import { createApp } from "../_shared/router.ts";
import { db } from "../_shared/db.ts";
import {
  eventsTable,
  rsvpsTable,
  attendanceTable,
  profilesTable,
  pendingEmailsTable,
} from "../_shared/schema.ts";
import { requireRole } from "../_shared/auth.ts";
import { and, count, eq, gte, inArray, sql } from "npm:drizzle-orm@0.45.2";
import { z } from "npm:zod@3";

const app = createApp();

// ── Inline zod body schemas (ported from @workspace/api-zod) ─────────────────
const EventRequirementBody = z.object({
  label: z.string(),
  required: z.boolean(),
});

// Mirrors api-zod CreateEventBody.
const CreateEventBody = z.object({
  title: z.string(),
  description: z.string().optional(),
  date: z.coerce.date(),
  time: z.string(),
  location: z.string(),
  age_min: z.number().nullish(),
  age_max: z.number().nullish(),
  custom_requirements: z.array(EventRequirementBody).optional(),
  is_public: z.boolean().default(true),
});

// Mirrors api-zod UpdateEventBody.
const UpdateEventBody = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  date: z.coerce.date().optional(),
  time: z.string().optional(),
  location: z.string().optional(),
  age_min: z.number().nullish(),
  age_max: z.number().nullish(),
  custom_requirements: z.array(EventRequirementBody).optional(),
  is_public: z.boolean().optional(),
});

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /events - Retrieve list of events
app.get("/events", async (c) => {
  try {
    const query = c.req.query();
    const publicOnly = query.public_only === "true";
    const upcoming = query.upcoming === "true";
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
      }),
    );
    return c.json(eventsWithCounts);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /events - Create a new event (protected: leader)
app.post("/events", requireRole("leader"), async (c) => {
  try {
    const body = await c.req.json();
    const parsed = CreateEventBody.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
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
        age_min: parsed.data.age_min ?? null,
        age_max: parsed.data.age_max ?? null,
        custom_requirements: parsed.data.custom_requirements ?? null,
        is_public: parsed.data.is_public ?? true,
        created_by: (c.get("leaderId") as string | undefined) ?? null,
      })
      .returning();

    // Queue email notifications for new public events
    if (event.is_public) {
      const recipients = await db
        .select({ email: profilesTable.email, full_name: profilesTable.full_name })
        .from(profilesTable)
        .where(inArray(profilesTable.role, ["member", "leader", "super_admin"]));

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
          .filter((r) => !!r.email)
          .map((r) => ({
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
            .filter((r) => !!r.email)
            .map((r) => ({
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

    return c.json({ ...event, rsvp_count: 0, attendance_count: 0 }, 201);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /events/:id - View single event details
app.get("/events/:id", async (c) => {
  try {
    const event = await db.query.eventsTable.findFirst({
      where: eq(eventsTable.id, c.req.param("id")),
    });
    if (!event) {
      return c.json({ error: "Event not found" }, 404);
    }
    const [rsvpResult] = await db
      .select({ count: count() })
      .from(rsvpsTable)
      .where(eq(rsvpsTable.event_id, event.id));
    const [attendResult] = await db
      .select({ count: count() })
      .from(attendanceTable)
      .where(eq(attendanceTable.event_id, event.id));
    return c.json({
      ...event,
      rsvp_count: rsvpResult?.count ?? 0,
      attendance_count: attendResult?.count ?? 0,
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// PATCH /events/:id - Update event (protected: leader)
app.patch("/events/:id", requireRole("leader"), async (c) => {
  try {
    const body = await c.req.json();
    const parsed = UpdateEventBody.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
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
      .set(updateData)
      .where(eq(eventsTable.id, c.req.param("id")))
      .returning();
    if (!updated) {
      return c.json({ error: "Event not found" }, 404);
    }
    return c.json({ ...updated, rsvp_count: 0, attendance_count: 0 });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// DELETE /events/:id - Delete event (protected: leader)
app.delete("/events/:id", requireRole("leader"), async (c) => {
  try {
    const eventId = c.req.param("id");

    await db.transaction(async (tx) => {
      // Delete associated RSVPs
      await tx.delete(rsvpsTable).where(eq(rsvpsTable.event_id, eventId));
      // Delete associated attendance
      await tx.delete(attendanceTable).where(eq(attendanceTable.event_id, eventId));
      // Delete the event
      await tx.delete(eventsTable).where(eq(eventsTable.id, eventId));
    });

    return c.json({ success: true, deletedId: eventId }, 200);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /events/:id/stats - Event RSVP and attendance statistics
app.get("/events/:id/stats", async (c) => {
  try {
    const id = c.req.param("id");
    const [rsvpCounts] = await db
      .select({
        total: count(),
        going: sql<number>`count(*) filter (where status = 'going')`,
        not_going: sql<number>`count(*) filter (where status = 'not_going')`,
        maybe: sql<number>`count(*) filter (where status = 'maybe')`,
      })
      .from(rsvpsTable)
      .where(eq(rsvpsTable.event_id, id));
    const [attendResult] = await db
      .select({ count: count() })
      .from(attendanceTable)
      .where(eq(attendanceTable.event_id, id));
    return c.json({
      event_id: id,
      rsvp_count: Number(rsvpCounts?.total ?? 0),
      going_count: Number(rsvpCounts?.going ?? 0),
      not_going_count: Number(rsvpCounts?.not_going ?? 0),
      maybe_count: Number(rsvpCounts?.maybe ?? 0),
      attendance_count: Number(attendResult?.count ?? 0),
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

Deno.serve(app.fetch);
