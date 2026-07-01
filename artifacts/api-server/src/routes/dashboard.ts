import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, count, sql, desc, gte, inArray, and, lte, isNotNull } from "drizzle-orm";
import ExcelJS from "exceljs";
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
import { getCache, setCache } from "../lib/redis";

const router = Router();

const CACHE_TTL_KPIS = 300; // 5 min
const CACHE_TTL_ANALYTICS = 600; // 10 min

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

// ── Gender counts (for the event/broadcast audience preview) ──────────────────
router.get("/dashboard/gender-counts", requireLeaderSession("leader"), async (req, res) => {
  try {
    const rows = await db
      .select({ gender: profilesTable.gender, total: count() })
      .from(profilesTable)
      .where(eq(profilesTable.role, "member"))
      .groupBy(profilesTable.gender);

    const counts = { male: 0, female: 0, unspecified: 0, total: 0 };
    for (const row of rows) {
      const n = Number(row.total);
      counts.total += n;
      if (row.gender === "male") counts.male += n;
      else if (row.gender === "female") counts.female += n;
      else counts.unspecified += n; // any legacy "other" + null
    }
    return res.json(counts);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── KPIs (cached) ─────────────────────────────────────────────────────────────
router.get("/dashboard/kpis", async (req, res) => {
  try {
    const { dateString: today } = getSastParts();
    const inWindow = isInsideFridayWindow();

    const cacheKey = `dashboard:kpis:${today}:${inWindow}`;
    const cached = await getCache<Record<string, number>>(cacheKey);
    if (cached) return res.json(cached);

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

    const result = {
      total_members: Number(totalMembersRow?.count ?? 0),
      today_attendance: todayAttendanceCount,
      today_new_visitors: todayNewVisitorsCount,
      upcoming_events_count: Number(upcomingEvents?.count ?? 0),
    };

    await setCache(cacheKey, result, inWindow ? 60 : CACHE_TTL_KPIS);

    return res.json(result);
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

    // Check Redis cache first (30s TTL — activity doesn't need to be real-time)
    const cacheKey = `dashboard:recent-activity:${limit}`;
    const cached = await getCache<unknown[]>(cacheKey);
    if (cached) return res.json(cached);

    // Run all 3 queries in parallel instead of sequentially (~3x faster)
    const [checkIns, registrations, memberRequests] = await Promise.all([
      db
        .select({
          id: attendanceTable.id,
          name: profilesTable.full_name,
          timestamp: attendanceTable.checked_in_at,
          method: attendanceTable.check_in_method,
        })
        .from(attendanceTable)
        .leftJoin(profilesTable, eq(attendanceTable.profile_id, profilesTable.id))
        .orderBy(desc(attendanceTable.checked_in_at))
        .limit(Math.ceil(limit / 3)),

      db
        .select({
          id: profilesTable.id,
          name: profilesTable.full_name,
          timestamp: profilesTable.created_at,
          role: profilesTable.role,
        })
        .from(profilesTable)
        .orderBy(desc(profilesTable.created_at))
        .limit(Math.ceil(limit / 3)),

      db
        .select({
          id: membershipRequestsTable.id,
          name: profilesTable.full_name,
          timestamp: membershipRequestsTable.created_at,
          status: membershipRequestsTable.status,
        })
        .from(membershipRequestsTable)
        .leftJoin(profilesTable, eq(membershipRequestsTable.profile_id, profilesTable.id))
        .orderBy(desc(membershipRequestsTable.created_at))
        .limit(Math.ceil(limit / 3)),
    ]);

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

    await setCache(cacheKey, activity, 30); // 30s TTL

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

// ── Analytics Data Endpoint (cached) ──────────────────────────────────────────
router.get("/dashboard/analytics-data", requireLeaderSession("leader"), async (req, res) => {
  try {
    const { dateString: today } = getSastParts();
    const now = new Date();

    const cacheKey = `dashboard:analytics:${today}`;
    const cached = await getCache<Record<string, unknown>>(cacheKey);
    if (cached) return res.json(cached);

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

    // ── 4a. Gender breakdown (total + active per gender) ─────────────────
    const genderTotals = await db
      .select({ gender: profilesTable.gender, total: count() })
      .from(profilesTable)
      .where(inArray(profilesTable.role, ["member", "leader", "super_admin"]))
      .groupBy(profilesTable.gender);

    const genderActive = await db
      .select({
        gender: profilesTable.gender,
        active: sql<number>`count(distinct ${profilesTable.id})`,
      })
      .from(profilesTable)
      .innerJoin(attendanceTable, eq(attendanceTable.profile_id, profilesTable.id))
      .where(
        and(
          inArray(profilesTable.role, ["member", "leader", "super_admin"]),
          sql`${attendanceTable.session_date}::date >= ${twoWeeksAgo}::date`,
        ),
      )
      .groupBy(profilesTable.gender);

    const genderBucket = (g: string | null): "male" | "female" | "unspecified" =>
      g === "male" ? "male" : g === "female" ? "female" : "unspecified";
    const gb: Record<string, { gender: string; total: number; active: number; dormant: number }> = {
      male: { gender: "male", total: 0, active: 0, dormant: 0 },
      female: { gender: "female", total: 0, active: 0, dormant: 0 },
      unspecified: { gender: "unspecified", total: 0, active: 0, dormant: 0 },
    };
    for (const r of genderTotals) gb[genderBucket(r.gender)].total += Number(r.total);
    for (const r of genderActive) gb[genderBucket(r.gender)].active += Number(r.active);
    for (const k of Object.keys(gb)) gb[k].dormant = Math.max(0, gb[k].total - gb[k].active);
    const genderBreakdown = [gb.male, gb.female, gb.unspecified];

    // ── 4b. No-email (PIN) accounts ──────────────────────────────────────
    // PIN accounts are the username+PIN signups (no email); identified by a
    // non-null username — the only flow that sets one. They start as visitors
    // and a leader can promote them to member.
    const [pinAccountsRow] = await db
      .select({
        total: count(),
        visitors: sql<number>`count(*) filter (where ${profilesTable.role} = 'visitor')`,
      })
      .from(profilesTable)
      .where(isNotNull(profilesTable.username));

    const pinAccountsTotal = Number(pinAccountsRow?.total ?? 0);
    const pinAccountsVisitors = Number(pinAccountsRow?.visitors ?? 0);
    const pinAccountsMembers = Math.max(0, pinAccountsTotal - pinAccountsVisitors);

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

    const result = {
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
        no_email_accounts: pinAccountsTotal,
        no_email_visitors: pinAccountsVisitors,
        no_email_members: pinAccountsMembers,
      },
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
      gender_breakdown: genderBreakdown,
    };

    await setCache(cacheKey, result, CACHE_TTL_ANALYTICS);

    return res.json(result);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── Data Export (multi-sheet Excel) ───────────────────────────────────────────
router.get("/dashboard/export", requireLeaderSession("leader"), async (req, res) => {
  try {
    const { dateString: today } = getSastParts();

    // ── 1. Full Attendance ──────────────────────────────────────────────
    const fullAttendance = await db
      .select({
        full_name: profilesTable.full_name,
        phone: profilesTable.phone,
        role: profilesTable.role,
        session_date: attendanceTable.session_date,
        checked_in_at: attendanceTable.checked_in_at,
        check_in_method: attendanceTable.check_in_method,
      })
      .from(attendanceTable)
      .leftJoin(profilesTable, eq(attendanceTable.profile_id, profilesTable.id))
      .orderBy(desc(attendanceTable.session_date));

    // ── 2. At-Risk / Absentees ──────────────────────────────────────────
    const absentees = await db
      .select({
        full_name: profilesTable.full_name,
        phone: profilesTable.phone,
        email: profilesTable.email,
        role: profilesTable.role,
        last_checkin: sql<string>`max(${attendanceTable.session_date})`,
        weeks_absent: sql<number>`
          GREATEST(1, (current_date - max(${attendanceTable.session_date}::date)) / 7)
        `,
        total_checkins: sql<number>`count(${attendanceTable.id})`,
      })
      .from(profilesTable)
      .leftJoin(attendanceTable, eq(profilesTable.id, attendanceTable.profile_id))
      .where(inArray(profilesTable.role, ["member", "leader", "super_admin"]))
      .groupBy(
        profilesTable.id,
        profilesTable.full_name,
        profilesTable.phone,
        profilesTable.email,
        profilesTable.role,
      )
      .having(
        sql`max(${attendanceTable.session_date}) IS NULL
            OR max(${attendanceTable.session_date}::date) < (current_date - interval '2 weeks')`,
      )
      .orderBy(sql`max(${attendanceTable.session_date}) ASC NULLS FIRST`);

    // ── 3. Visitor Tracking ─────────────────────────────────────────────
    const visitors = await db
      .select({
        full_name: profilesTable.full_name,
        phone: profilesTable.phone,
        email: profilesTable.email,
        age: profilesTable.age,
        school: profilesTable.school,
        heard_from: profilesTable.heard_from,
        created_at: profilesTable.created_at,
        checkin_count: sql<number>`(
          SELECT count(*) FROM attendance WHERE attendance.profile_id = ${profilesTable.id}
        )`,
      })
      .from(profilesTable)
      .where(eq(profilesTable.role, "visitor"))
      .orderBy(desc(profilesTable.created_at));

    // ── 4. Weekly Trends ────────────────────────────────────────────────
    const weeklyTrends = await db
      .select({
        week: sql<string>`to_char(date_trunc('week', ${attendanceTable.session_date}::date), 'YYYY-MM-DD')`,
        total: count(),
        members: sql<number>`count(*) filter (where ${profilesTable.role} IN ('member', 'leader', 'super_admin'))`,
        visitors: sql<number>`count(*) filter (where ${profilesTable.role} = 'visitor')`,
      })
      .from(attendanceTable)
      .leftJoin(profilesTable, eq(attendanceTable.profile_id, profilesTable.id))
      .groupBy(sql`date_trunc('week', ${attendanceTable.session_date}::date)`)
      .orderBy(sql`date_trunc('week', ${attendanceTable.session_date}::date) DESC`);

    // ── 5. Feedback ─────────────────────────────────────────────────────
    const feedback = await db
      .select({
        content: feedbacksTable.content,
        anonymous: feedbacksTable.anonymous,
        submitted_by: profilesTable.full_name,
        created_at: feedbacksTable.created_at,
      })
      .from(feedbacksTable)
      .leftJoin(profilesTable, eq(feedbacksTable.user_id, profilesTable.id))
      .orderBy(desc(feedbacksTable.created_at));

    // ── Build Excel workbook ────────────────────────────────────────────
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "JG Youth Connect";
    workbook.created = new Date();

    const headerStyle: Partial<ExcelJS.Style> = {
      font: { bold: true, color: { argb: "FFFFFFFF" } },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF2A9D8F" } },
      alignment: { horizontal: "center" },
    };

    // Sheet 1: Full Attendance
    const attendSheet = workbook.addWorksheet("Full Attendance");
    attendSheet.columns = [
      { header: "Name", key: "full_name", width: 25 },
      { header: "Phone", key: "phone", width: 18 },
      { header: "Role", key: "role", width: 14 },
      { header: "Session Date", key: "session_date", width: 14 },
      { header: "Checked In At", key: "checked_in_at", width: 22 },
      { header: "Method", key: "check_in_method", width: 12 },
    ];
    attendSheet.getRow(1).eachCell((cell) => { cell.style = headerStyle; });
    for (const row of fullAttendance) {
      attendSheet.addRow({
        ...row,
        checked_in_at: row.checked_in_at.toISOString(),
      });
    }

    // Sheet 2: At-Risk / Absentees
    const absentSheet = workbook.addWorksheet("Absentees");
    absentSheet.columns = [
      { header: "Name", key: "full_name", width: 25 },
      { header: "Phone", key: "phone", width: 18 },
      { header: "Email", key: "email", width: 25 },
      { header: "Role", key: "role", width: 14 },
      { header: "Last Check-in", key: "last_checkin", width: 14 },
      { header: "Weeks Absent", key: "weeks_absent", width: 14 },
      { header: "Total Check-ins", key: "total_checkins", width: 16 },
    ];
    absentSheet.getRow(1).eachCell((cell) => { cell.style = headerStyle; });
    for (const row of absentees) {
      absentSheet.addRow({
        ...row,
        last_checkin: row.last_checkin ?? "Never",
        weeks_absent: Number(row.weeks_absent),
        total_checkins: Number(row.total_checkins),
      });
    }

    // Sheet 3: Visitor Tracking
    const visitorSheet = workbook.addWorksheet("Visitor Tracking");
    visitorSheet.columns = [
      { header: "Name", key: "full_name", width: 25 },
      { header: "Phone", key: "phone", width: 18 },
      { header: "Email", key: "email", width: 25 },
      { header: "Age", key: "age", width: 8 },
      { header: "School", key: "school", width: 20 },
      { header: "How Did You Hear?", key: "heard_from", width: 20 },
      { header: "Registered", key: "created_at", width: 22 },
      { header: "Check-ins", key: "checkin_count", width: 12 },
    ];
    visitorSheet.getRow(1).eachCell((cell) => { cell.style = headerStyle; });
    for (const row of visitors) {
      visitorSheet.addRow({
        ...row,
        created_at: row.created_at.toISOString().split("T")[0],
        checkin_count: Number(row.checkin_count),
      });
    }

    // Sheet 4: Weekly Trends
    const trendsSheet = workbook.addWorksheet("Weekly Trends");
    trendsSheet.columns = [
      { header: "Week Starting", key: "week", width: 14 },
      { header: "Total", key: "total", width: 10 },
      { header: "Members", key: "members", width: 10 },
      { header: "Visitors", key: "visitors", width: 10 },
    ];
    trendsSheet.getRow(1).eachCell((cell) => { cell.style = headerStyle; });
    for (const row of weeklyTrends) {
      trendsSheet.addRow({
        week: row.week,
        total: Number(row.total),
        members: Number(row.members),
        visitors: Number(row.visitors),
      });
    }

    // Sheet 5: Feedback
    const feedbackSheet = workbook.addWorksheet("Feedback");
    feedbackSheet.columns = [
      { header: "Feedback", key: "content", width: 50 },
      { header: "Anonymous", key: "anonymous", width: 12 },
      { header: "Submitted By", key: "submitted_by", width: 25 },
      { header: "Date", key: "created_at", width: 22 },
    ];
    feedbackSheet.getRow(1).eachCell((cell) => { cell.style = headerStyle; });
    for (const row of feedback) {
      feedbackSheet.addRow({
        content: row.content,
        anonymous: row.anonymous ? "Yes" : "No",
        submitted_by: row.anonymous ? "Anonymous" : (row.submitted_by ?? "Unknown"),
        created_at: row.created_at.toISOString().split("T")[0],
      });
    }

    // Stream response
    const filename = `JG-Youth-Report-${today}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    return res.end();
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
