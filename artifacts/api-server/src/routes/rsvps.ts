import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and } from "drizzle-orm";
import { db, rsvpsTable, eventsTable, profilesTable, pendingEmailsTable } from "@workspace/db";
import { UpsertRsvpBody } from "@workspace/api-zod";
import { requireLeaderSession } from "../middlewares/requireLeaderSession";

const router = Router();

router.get("/rsvps/event/:eventId", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
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

// GET /rsvps/my — member fetches their own RSVPs with full event details
router.get("/rsvps/my", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, auth.userId),
    });
    if (!profile) return res.status(404).json({ error: "Profile not found" });
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
    return res.json(myRsvps);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /rsvps - Retrieve all RSVPs (protected: leader only)
router.get("/rsvps", requireLeaderSession("leader"), async (req, res) => {
  try {
    const { event_id, status } = req.query;
    const rsvps = await db
      .select({
        id: rsvpsTable.id,
        event_id: rsvpsTable.event_id,
        profile_id: rsvpsTable.profile_id,
        event_name: eventsTable.title,
        status: rsvpsTable.status,
        created_at: rsvpsTable.created_at,
        profile: {
          id: profilesTable.id,
          full_name: profilesTable.full_name,
          role: profilesTable.role,
          phone: profilesTable.phone,
          email: profilesTable.email,
          age: profilesTable.age,
        },
      })
      .from(rsvpsTable)
      .leftJoin(profilesTable, eq(rsvpsTable.profile_id, profilesTable.id))
      .leftJoin(eventsTable, eq(rsvpsTable.event_id, eventsTable.id))
      .where(
        and(
          event_id ? eq(rsvpsTable.event_id, event_id as string) : undefined,
          status ? eq(rsvpsTable.status, status as "going" | "not_going") : undefined,
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
    if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
    const parsed = UpsertRsvpBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, auth.userId),
    });
    if (!profile) return res.status(404).json({ error: "Profile not found" });

    const event = await db.query.eventsTable.findFirst({
      where: eq(eventsTable.id, req.params.eventId),
    });

    const existing = await db.query.rsvpsTable.findFirst({
      where: and(
        eq(rsvpsTable.event_id, req.params.eventId),
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
          event_id: req.params.eventId,
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
        req.log.warn({ emailErr }, "RSVP confirmation email queuing failed");
      }
    }

    return res.json({ ...rsvp, event: event ?? null });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
