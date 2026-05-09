import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, count, sql, desc, gte } from "drizzle-orm";
import {
  db,
  profilesTable,
  attendanceTable,
  eventsTable,
  membershipRequestsTable,
  rsvpsTable,
} from "@workspace/db";

const router = Router();

router.get("/dashboard/kpis", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const today = new Date().toISOString().split("T")[0];

    const [memberCount] = await db
      .select({ count: count() })
      .from(profilesTable)
      .where(eq(profilesTable.role, "member"));

    const [visitorCount] = await db
      .select({ count: count() })
      .from(profilesTable)
      .where(eq(profilesTable.role, "visitor"));

    const [todayAttendance] = await db
      .select({ count: count() })
      .from(attendanceTable)
      .where(eq(attendanceTable.session_date, today));

    const [todayNewVisitors] = await db
      .select({ count: count() })
      .from(profilesTable)
      .where(sql`date(${profilesTable.created_at}) = ${today}::date`);

    const [upcomingEvents] = await db
      .select({ count: count() })
      .from(eventsTable)
      .where(gte(eventsTable.date, today));

    return res.json({
      total_members: Number(memberCount?.count ?? 0),
      total_visitors: Number(visitorCount?.count ?? 0),
      today_attendance: Number(todayAttendance?.count ?? 0),
      today_new_visitors: Number(todayNewVisitors?.count ?? 0),
      upcoming_events_count: Number(upcomingEvents?.count ?? 0),
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/recent-activity", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const limit = parseInt(String(req.query.limit ?? "20"));

    const checkIns = await db
      .select({
        id: attendanceTable.id,
        name: profilesTable.full_name,
        timestamp: attendanceTable.checked_in_at,
        method: attendanceTable.check_in_method,
      })
      .from(attendanceTable)
      .leftJoin(profilesTable, eq(attendanceTable.profile_id, profilesTable.id))
      .orderBy(desc(attendanceTable.checked_in_at))
      .limit(Math.ceil(limit / 3));

    const registrations = await db
      .select({
        id: profilesTable.id,
        name: profilesTable.full_name,
        timestamp: profilesTable.created_at,
        role: profilesTable.role,
      })
      .from(profilesTable)
      .orderBy(desc(profilesTable.created_at))
      .limit(Math.ceil(limit / 3));

    const memberRequests = await db
      .select({
        id: membershipRequestsTable.id,
        name: profilesTable.full_name,
        timestamp: membershipRequestsTable.created_at,
        status: membershipRequestsTable.status,
      })
      .from(membershipRequestsTable)
      .leftJoin(profilesTable, eq(membershipRequestsTable.profile_id, profilesTable.id))
      .orderBy(desc(membershipRequestsTable.created_at))
      .limit(Math.ceil(limit / 3));

    const activity = [
      ...checkIns.map((r) => ({
        type: "check_in" as const,
        description: `${r.name ?? "Unknown"} checked in`,
        profile_name: r.name,
        timestamp: r.timestamp.toISOString(),
      })),
      ...registrations.map((r) => ({
        type: "registration" as const,
        description: `${r.name ?? "Unknown"} registered as ${r.role}`,
        profile_name: r.name,
        timestamp: r.timestamp.toISOString(),
      })),
      ...memberRequests.map((r) => ({
        type: "membership_request" as const,
        description: `${r.name ?? "Unknown"} requested membership`,
        profile_name: r.name,
        timestamp: r.timestamp.toISOString(),
      })),
    ]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);

    return res.json(activity);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/attendance-history", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const limit = parseInt(String(req.query.limit ?? "30"));

    const history = await db
      .select({
        session_date: attendanceTable.session_date,
        total_count: count(),
        member_count: sql<number>`count(*) filter (where ${profilesTable.role} = 'member')`,
        visitor_count: sql<number>`count(*) filter (where ${profilesTable.role} = 'visitor')`,
      })
      .from(attendanceTable)
      .leftJoin(profilesTable, eq(attendanceTable.profile_id, profilesTable.id))
      .groupBy(attendanceTable.session_date)
      .orderBy(desc(attendanceTable.session_date))
      .limit(limit);

    return res.json(
      history.map((h) => ({
        session_date: h.session_date,
        total_count: Number(h.total_count),
        member_count: Number(h.member_count),
        visitor_count: Number(h.visitor_count),
        event_title: null,
      })),
    );
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
