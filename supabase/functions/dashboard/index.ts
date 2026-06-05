// Supabase Edge Function: dashboard
// Port of artifacts/api-server/src/routes/dashboard.ts (every route).
//
// Auth mirrors the source EXACTLY:
//   GET /dashboard/kpis              - no auth check (public in the source)
//   GET /dashboard/recent-activity   - any authenticated Clerk user (getAuth(req).userId)
//   GET /dashboard/attendance-history- any authenticated Clerk user (getAuth(req).userId)

import { createApp } from "../_shared/router.ts";
import { db } from "../_shared/db.ts";
import {
  profilesTable,
  attendanceTable,
  eventsTable,
  membershipRequestsTable,
} from "../_shared/schema.ts";
import { getClerkUserId } from "../_shared/auth.ts";
import { count, desc, eq, gte, inArray, sql } from "npm:drizzle-orm@0.45.2";

const app = createApp();

// ── Local helpers (ported verbatim from dashboard.ts) ────────────────────────

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

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /dashboard/kpis - aggregate KPIs (no auth in source)
app.get("/dashboard/kpis", async (c) => {
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

    return c.json({
      total_members: Number(totalMembersRow?.count ?? 0),
      today_attendance: todayAttendanceCount,
      today_new_visitors: todayNewVisitorsCount,
      upcoming_events_count: Number(upcomingEvents?.count ?? 0),
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /dashboard/recent-activity - any authenticated Clerk user
app.get("/dashboard/recent-activity", async (c) => {
  try {
    const userId = await getClerkUserId(c.req.raw);
    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const limit = parseInt(String(c.req.query("limit") ?? "20"));

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

    return c.json(activity);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /dashboard/attendance-history - any authenticated Clerk user
app.get("/dashboard/attendance-history", async (c) => {
  try {
    const userId = await getClerkUserId(c.req.raw);
    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const limit = parseInt(String(c.req.query("limit") ?? "30"));

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

    return c.json(
      history.map((h) => ({
        session_date: h.session_date,
        total_count: Number(h.total_count),
        member_count: Number(h.member_count),
        visitor_count: Number(h.visitor_count),
        event_title: null,
      })),
    );
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

Deno.serve(app.fetch);
