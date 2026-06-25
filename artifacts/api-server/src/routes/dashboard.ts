import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, count, sql, desc, gte, inArray, and, lte } from "drizzle-orm";
import {
  db,
  profilesTable,
  attendanceTable,
  eventsTable,
  membershipRequestsTable,
  rsvpsTable,
  feedbacksTable,
  whatsappTemplatesTable,
} from "@workspace/db";
import { requireLeaderSession } from "../middlewares/requireLeaderSession";

const router = Router();

function getSastParts(): {
  dayOfWeek: number;
  hours: number;
  minutes: number;
  dateString: string;
} {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });

  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }

  const year = parts["year"];
  const month = parts["month"];
  const day = parts["day"];
  const hours = parseInt(parts["hour"], 10);
  const minutes = parseInt(parts["minute"], 10);

  const weekdayShort = parts["weekday"];
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dayOfWeek = weekdayMap[weekdayShort] ?? new Date().getDay();

  return {
    dayOfWeek,
    hours,
    minutes,
    dateString: `${year}-${month}-${day}`,
  };
}

function isInsideFridayWindow(): boolean {
  const { dayOfWeek, hours, minutes } = getSastParts();
  if (dayOfWeek !== 5) return false;
  const totalMinutes = hours * 60 + minutes;
  const start = 18 * 60 + 30;
  const end = 22 * 60;
  return totalMinutes >= start && totalMinutes < end;
}

router.get("/dashboard/kpis", async (req, res) => {
  try {
    const { dateString: today } = getSastParts();
    const inWindow = isInsideFridayWindow();

    // Count ALL roles — members + leaders + super_admins
    const [totalMembersRow] = await db
      .select({ count: count() })
      .from(profilesTable)
      .where(inArray(profilesTable.role, ["member", "leader", "super_admin"]));

    const [upcomingEvents] = await db
      .select({ count: count() })
      .from(eventsTable)
      .where(gte(eventsTable.date, today));

    let todayAttendanceCount = 0;
    let todayNewVisitorsCount = 0;

    if (inWindow) {
      const [todayAttendance] = await db
        .select({ count: count() })
        .from(attendanceTable)
        .where(eq(attendanceTable.session_date, today));

      const [todayNewVisitors] = await db
        .select({ count: count() })
        .from(profilesTable)
        .where(sql`date(${profilesTable.created_at} AT TIME ZONE 'Africa/Johannesburg') = ${today}::date`);

      todayAttendanceCount = Number(todayAttendance?.count ?? 0);
      todayNewVisitorsCount = Number(todayNewVisitors?.count ?? 0);
    }

    return res.json({
      total_members: Number(totalMembersRow?.count ?? 0),
      today_attendance: todayAttendanceCount,
      today_new_visitors: todayNewVisitorsCount,
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
        member_count: sql<number>`count(*) filter (where ${profilesTable.role} IN ('member', 'leader', 'super_admin'))`,
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

// ── Analytics Data Endpoint ────────────────────────────────────────────────────
// Returns all metrics for the custom Recharts analytics dashboard.
router.get("/dashboard/analytics-data", requireLeaderSession("leader"), async (req, res) => {
  try {
    const { dateString: today } = getSastParts();
    const now = new Date();

    // ── 1. Check-in trends (last 12 weeks, grouped by week) ──────────────
    const checkinTrends = await db
      .select({
        week: sql<string>`to_char(date_trunc('week', ${attendanceTable.session_date}::date), 'YYYY-MM-DD')`,
        total: count(),
      })
      .from(attendanceTable)
      .where(sql`${attendanceTable.session_date}::date >= (current_date - interval '12 weeks')`)
      .groupBy(sql`date_trunc('week', ${attendanceTable.session_date}::date)`)
      .orderBy(sql`date_trunc('week', ${attendanceTable.session_date}::date)`);

    // ── 2. Check-in trends (last 6 months, grouped by month) ─────────────
    const checkinMonthly = await db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${attendanceTable.session_date}::date), 'YYYY-MM')`,
        total: count(),
      })
      .from(attendanceTable)
      .where(sql`${attendanceTable.session_date}::date >= (current_date - interval '6 months')`)
      .groupBy(sql`date_trunc('month', ${attendanceTable.session_date}::date)`)
      .orderBy(sql`date_trunc('month', ${attendanceTable.session_date}::date)`);

    // ── 3. New sign-ups over time (last 12 weeks) ────────────────────────
    const signupTrends = await db
      .select({
        week: sql<string>`to_char(date_trunc('week', ${profilesTable.created_at}), 'YYYY-MM-DD')`,
        total: count(),
      })
      .from(profilesTable)
      .where(sql`${profilesTable.created_at} >= (current_date - interval '12 weeks')`)
      .groupBy(sql`date_trunc('week', ${profilesTable.created_at})`)
      .orderBy(sql`date_trunc('week', ${profilesTable.created_at})`);

    // ── 4. Active vs dormant members ─────────────────────────────────────
    // Active = checked in within 2 weeks; dormant = not checked in within 2 weeks
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const [totalMembersRow] = await db
      .select({ count: count() })
      .from(profilesTable)
      .where(inArray(profilesTable.role, ["member", "leader", "super_admin"]));

    const [activeMembersRow] = await db
      .select({
        count: sql<number>`count(distinct ${attendanceTable.profile_id})`,
      })
      .from(attendanceTable)
      .where(sql`${attendanceTable.session_date}::date >= ${twoWeeksAgo}::date`);

    const totalMembers = Number(totalMembersRow?.count ?? 0);
    const activeMembers = Number(activeMembersRow?.count ?? 0);
    const dormantMembers = Math.max(0, totalMembers - activeMembers);

    // ── 5. At-risk members (haven't checked in for 2+ weeks) ─────────────
    const atRiskMembers = await db
      .select({
        id: profilesTable.id,
        full_name: profilesTable.full_name,
        phone: profilesTable.phone,
        last_checkin: sql<string>`max(${attendanceTable.session_date})`,
        weeks_absent: sql<number>`
          GREATEST(1, (current_date - max(${attendanceTable.session_date}::date)) / 7)
        `,
      })
      .from(profilesTable)
      .leftJoin(attendanceTable, eq(profilesTable.id, attendanceTable.profile_id))
      .where(inArray(profilesTable.role, ["member", "leader", "super_admin"]))
      .groupBy(profilesTable.id, profilesTable.full_name, profilesTable.phone)
      .having(sql`max(${attendanceTable.session_date}) IS NULL OR max(${attendanceTable.session_date}::date) < (current_date - interval '2 weeks')`)
      .orderBy(sql`max(${attendanceTable.session_date}) ASC NULLS FIRST`)
      .limit(20);

    // ── 6. Event attendance (per event, last 10 events) ──────────────────
    const eventAttendance = await db
      .select({
        event_id: eventsTable.id,
        title: eventsTable.title,
        date: eventsTable.date,
        attendance_count: sql<number>`count(${attendanceTable.id})`,
        rsvp_count: sql<number>`(
          SELECT count(*) FROM rsvps WHERE rsvps.event_id = ${eventsTable.id} AND rsvps.status = 'going'
        )`,
      })
      .from(eventsTable)
      .leftJoin(attendanceTable, eq(eventsTable.id, attendanceTable.event_id))
      .groupBy(eventsTable.id, eventsTable.title, eventsTable.date)
      .orderBy(desc(eventsTable.date))
      .limit(10);

    // Calculate attendance rate per event (attendance / total members)
    const eventAttendanceWithRate = eventAttendance.map((e) => ({
      event_id: e.event_id,
      title: e.title,
      date: e.date,
      attendance_count: Number(e.attendance_count),
      rsvp_count: Number(e.rsvp_count),
      attendance_rate:
        totalMembers > 0
          ? Math.round((Number(e.attendance_count) / totalMembers) * 100)
          : 0,
    }));

    // ── 7. Upcoming events count ─────────────────────────────────────────
    const [upcomingEventsRow] = await db
      .select({ count: count() })
      .from(eventsTable)
      .where(gte(eventsTable.date, today));

    // ── 8. Feedback summary ──────────────────────────────────────────────
    const [feedbackTotal] = await db
      .select({ count: count() })
      .from(feedbacksTable);

    const [feedbackThisWeek] = await db
      .select({ count: count() })
      .from(feedbacksTable)
      .where(sql`${feedbacksTable.created_at} >= (current_date - interval '7 days')`);

    // ── 9. Streak leaderboard (top 5) ────────────────────────────────────
    // Calculate streaks: consecutive session_dates per profile
    const streakLeaders = await db
      .select({
        profile_id: attendanceTable.profile_id,
        full_name: profilesTable.full_name,
        total_checkins: count(),
        last_checkin: sql<string>`max(${attendanceTable.session_date})`,
      })
      .from(attendanceTable)
      .leftJoin(profilesTable, eq(attendanceTable.profile_id, profilesTable.id))
      .where(inArray(profilesTable.role, ["member", "leader", "super_admin"]))
      .groupBy(attendanceTable.profile_id, profilesTable.full_name)
      .orderBy(sql`count(*) DESC`)
      .limit(5);

    // ── 10. This week & this month check-in totals ───────────────────────
    const [weekCheckins] = await db
      .select({ count: count() })
      .from(attendanceTable)
      .where(sql`${attendanceTable.session_date}::date >= date_trunc('week', current_date)`);

    const [monthCheckins] = await db
      .select({ count: count() })
      .from(attendanceTable)
      .where(sql`${attendanceTable.session_date}::date >= date_trunc('month', current_date)`);

    return res.json({
      // Summary cards
      summary: {
        total_members: totalMembers,
        active_members: activeMembers,
        dormant_members: dormantMembers,
        upcoming_events: Number(upcomingEventsRow?.count ?? 0),
        checkins_this_week: Number(weekCheckins?.count ?? 0),
        checkins_this_month: Number(monthCheckins?.count ?? 0),
        at_risk_count: atRiskMembers.length,
        feedback_total: Number(feedbackTotal?.count ?? 0),
        feedback_this_week: Number(feedbackThisWeek?.count ?? 0),
      },
      // Chart data
      checkin_trends_weekly: checkinTrends.map((r) => ({
        week: r.week,
        checkins: Number(r.total),
      })),
      checkin_trends_monthly: checkinMonthly.map((r) => ({
        month: r.month,
        checkins: Number(r.total),
      })),
      signup_trends: signupTrends.map((r) => ({
        week: r.week,
        signups: Number(r.total),
      })),
      event_attendance: eventAttendanceWithRate,
      at_risk_members: atRiskMembers.map((m) => ({
        id: m.id,
        full_name: m.full_name,
        phone: m.phone,
        last_checkin: m.last_checkin,
        weeks_absent: Number(m.weeks_absent),
      })),
      streak_leaders: streakLeaders.map((s) => ({
        profile_id: s.profile_id,
        full_name: s.full_name,
        total_checkins: Number(s.total_checkins),
        last_checkin: s.last_checkin,
      })),
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
