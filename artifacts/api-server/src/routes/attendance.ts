import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, ilike, or, desc } from "drizzle-orm";
import { db, attendanceTable, profilesTable, eventsTable } from "@workspace/db";
import {
  CheckInBody,
  CheckInByNameBody,
} from "@workspace/api-zod";

const router = Router();

router.get("/attendance", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
    const requester = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, auth.userId),
    });
    const isPrivileged = requester?.role === "leader" || requester?.role === "super_admin";
    const requestedProfileId = req.query.profile_id ? String(req.query.profile_id) : undefined;
    if (requestedProfileId && !isPrivileged && requestedProfileId !== requester?.id) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { session_date, event_id, profile_id } = req.query;
    const conditions: any[] = [];
    if (session_date) conditions.push(eq(attendanceTable.session_date, String(session_date)));
    if (event_id) conditions.push(eq(attendanceTable.event_id, String(event_id)));
    if (profile_id) conditions.push(eq(attendanceTable.profile_id, String(profile_id)));

    const records = await db
      .select({
        id: attendanceTable.id,
        profile_id: attendanceTable.profile_id,
        event_id: attendanceTable.event_id,
        checked_in_at: attendanceTable.checked_in_at,
        session_date: attendanceTable.session_date,
        check_in_method: attendanceTable.check_in_method,
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
      .from(attendanceTable)
      .leftJoin(profilesTable, eq(attendanceTable.profile_id, profilesTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return res.json(records);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/attendance", async (req, res) => {
  try {
    const parsed = CheckInBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const today = new Date().toISOString().split("T")[0];
    const [record] = await db
      .insert(attendanceTable)
      .values({
        profile_id: parsed.data.profile_id,
        event_id: parsed.data.event_id ?? null,
        session_date: today,
        check_in_method: parsed.data.check_in_method,
      })
      .returning();
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, parsed.data.profile_id),
    });
    return res.status(201).json({ ...record, profile });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/attendance/today", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const records = await db
      .select({
        id: attendanceTable.id,
        profile_id: attendanceTable.profile_id,
        event_id: attendanceTable.event_id,
        checked_in_at: attendanceTable.checked_in_at,
        session_date: attendanceTable.session_date,
        check_in_method: attendanceTable.check_in_method,
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
      .from(attendanceTable)
      .leftJoin(profilesTable, eq(attendanceTable.profile_id, profilesTable.id))
      .where(eq(attendanceTable.session_date, today));
    return res.json(records);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /attendance/my - the authenticated member's own attendance history
router.get("/attendance/my", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });

    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, auth.userId),
    });
    if (!profile) return res.status(404).json({ error: "Profile not found" });

    const rows = await db
      .select({
        id: attendanceTable.id,
        session_date: attendanceTable.session_date,
        check_in_method: attendanceTable.check_in_method,
        checked_in_at: attendanceTable.checked_in_at,
        event_title: eventsTable.title,
      })
      .from(attendanceTable)
      .leftJoin(eventsTable, eq(attendanceTable.event_id, eventsTable.id))
      .where(eq(attendanceTable.profile_id, profile.id))
      .orderBy(desc(attendanceTable.session_date), desc(attendanceTable.checked_in_at));

    return res.json(rows);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/attendance/checkin-by-name", async (req, res) => {
  try {
    const parsed = CheckInByNameBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { name, phone } = parsed.data;
    let profile = null;
    if (phone) {
      profile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.phone, phone),
      });
    } else if (name) {
      profile = await db.query.profilesTable.findFirst({
        where: ilike(profilesTable.full_name, `%${name}%`),
      });
    }
    if (!profile) {
      return res.status(404).json({ error: "Person not found" });
    }
    const today = new Date().toISOString().split("T")[0];
    const [record] = await db
      .insert(attendanceTable)
      .values({
        profile_id: profile.id,
        session_date: today,
        check_in_method: "self",
      })
      .returning();
    return res.status(201).json({ ...record, profile });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
