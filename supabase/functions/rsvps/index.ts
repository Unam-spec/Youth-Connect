// Supabase Edge Function: rsvps
// Port of artifacts/api-server/src/routes/rsvps.ts (every route).
//
// Mirrors the porting conventions established in profiles/index.ts and leaders/index.ts:
//  - createApp() from ../_shared/router.ts; FULL paths incl /rsvps segment.
//  - requireLeaderSession(...) -> requireRole(...) from ../_shared/auth.ts.
//  - getAuth(req).userId -> await getClerkUserId(c.req.raw).
//  - req.log.error / req.log.warn -> console.error / console.warn.
//  - zod -> npm:zod@3 (inline, mirroring api-zod UpsertRsvpBody).
//  - the "going" confirmation email is queued into pendingEmailsTable (never sendEmail).
//  - exact response shapes/status codes preserved.

import { createApp } from "../_shared/router.ts";
import { db } from "../_shared/db.ts";
import {
  rsvpsTable,
  eventsTable,
  profilesTable,
  pendingEmailsTable,
} from "../_shared/schema.ts";
import { getClerkUserId, requireRole } from "../_shared/auth.ts";
import { and, eq } from "npm:drizzle-orm@0.45.2";
import { z } from "npm:zod@3";

const app = createApp();

// ── Inline zod body schemas (ported from @workspace/api-zod) ─────────────────
const UpsertRsvpBody = z.object({
  status: z.enum(["going", "not_going", "maybe"]),
});

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /rsvps/event/:eventId - RSVPs for an event with member profile (Clerk-auth)
app.get("/rsvps/event/:eventId", async (c) => {
  try {
    const userId = await getClerkUserId(c.req.raw);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
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
      .where(eq(rsvpsTable.event_id, c.req.param("eventId")));
    return c.json(rsvps);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /rsvps/my — member fetches their own RSVPs with full event details
app.get("/rsvps/my", async (c) => {
  try {
    const userId = await getClerkUserId(c.req.raw);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, userId),
    });
    if (!profile) return c.json({ error: "Profile not found" }, 404);
    const myRsvps = await db
      .select({
        id: rsvpsTable.id,
        event_id: rsvpsTable.event_id,
        status: rsvpsTable.status,
        created_at: rsvpsTable.created_at,
        event: {
          id: eventsTable.id,
          title: eventsTable.title,
          date: eventsTable.date,
          time: eventsTable.time,
          location: eventsTable.location,
        },
      })
      .from(rsvpsTable)
      .leftJoin(eventsTable, eq(rsvpsTable.event_id, eventsTable.id))
      .where(eq(rsvpsTable.profile_id, profile.id));
    return c.json(myRsvps);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /rsvps - Retrieve all RSVPs (protected: leader only)
app.get("/rsvps", requireRole("leader"), async (c) => {
  try {
    const query = c.req.query();
    const event_id = query.event_id;
    const status = query.status;
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
          event_id ? eq(rsvpsTable.event_id, event_id) : undefined,
          status ? eq(rsvpsTable.status, status as "going" | "not_going") : undefined,
        ),
      );
    return c.json(rsvps);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /rsvps/:eventId - Upsert the caller's RSVP for an event (Clerk-auth)
app.post("/rsvps/:eventId", async (c) => {
  try {
    const userId = await getClerkUserId(c.req.raw);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const body = await c.req.json();
    const parsed = UpsertRsvpBody.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, userId),
    });
    if (!profile) return c.json({ error: "Profile not found" }, 404);

    const eventId = c.req.param("eventId");

    const event = await db.query.eventsTable.findFirst({
      where: eq(eventsTable.id, eventId),
    });

    const existing = await db.query.rsvpsTable.findFirst({
      where: and(
        eq(rsvpsTable.event_id, eventId),
        eq(rsvpsTable.profile_id, profile.id),
      ),
    });

    let rsvp: typeof rsvpsTable.$inferSelect;

    if (existing) {
      const [updated] = await db
        .update(rsvpsTable)
        .set({ status: parsed.data.status })
        .where(eq(rsvpsTable.id, existing.id))
        .returning();
      rsvp = updated;
    } else {
      const [inserted] = await db
        .insert(rsvpsTable)
        .values({
          event_id: eventId,
          profile_id: profile.id,
          status: parsed.data.status,
        })
        .returning();
      rsvp = inserted;
    }

    if (parsed.data.status === "going" && profile.email && event) {
      try {
        const emailBody = `
          <div style="font-family: 'Inter', sans-serif; background-color: #0B0F14; color: #E6E8EB; padding: 24px; border-radius: 8px;">
            <h2 style="color: #2A9D8F; font-family: 'Sora', sans-serif;">You're going to ${event.title}!</h2>
            <p>Hi ${profile.full_name},</p>
            <p>You've successfully confirmed attendance for <strong>${event.title}</strong>.</p>
            <div style="background-color: rgba(255,255,255,0.05); padding: 16px; border-radius: 6px; margin: 20px 0;">
              <p style="margin: 4px 0;"><strong>Date:</strong> ${event.date}</p>
              <p style="margin: 4px 0;"><strong>Time:</strong> ${event.time}</p>
              <p style="margin: 4px 0;"><strong>Location:</strong> ${event.location}</p>
            </div>
            <p>See you there!</p>
            <p style="margin-top: 24px; font-weight: bold; color: #2A9D8F;">Jeremiah Generation AFM Team</p>
          </div>
        `;

        await db.insert(pendingEmailsTable).values({
          to_address: profile.email,
          subject: `You're going to ${event.title}!`,
          body_html: emailBody,
        });
      } catch (emailErr) {
        console.warn("RSVP confirmation email queuing failed", emailErr);
      }
    }

    return c.json({ ...rsvp, event: event ?? null });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

Deno.serve(app.fetch);
