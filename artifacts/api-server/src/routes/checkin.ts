import { Router } from "express";
import { ilike, or, eq, and, desc } from "drizzle-orm";
import { toZonedTime } from "date-fns-tz";
import {
  db,
  profilesTable,
  checkInRequestsTable,
  attendanceTable,
  visitorsTable,
  pendingEmailsTable,
  checkinSettingsTable,
  checkinWindowsTable,
  type Profile,
} from "@workspace/db";
import { requireLeaderSession } from "../middlewares/requireLeaderSession";
import { getSchedule, isCheckinOpenNow, type CheckinWindow } from "../lib/checkinSchedule";
import { resolveAccount } from "../lib/resolveAccount";

const router = Router();

// ── Time-window helpers ───────────────────────────────────────────────────────

function getSastToday(): string {
  const sast = toZonedTime(new Date(), "Africa/Johannesburg");
  const y = sast.getFullYear();
  const m = String(sast.getMonth() + 1).padStart(2, "0");
  const d = String(sast.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/checkin/search - Search members (Public)
router.get("/checkin/search", async (req, res) => {
  try {
    const query = typeof req.query.query === "string" ? req.query.query : "";
    if (!query || query.length < 2) {
      return res.json([]);
    }
    const profiles = await db
      .select()
      .from(profilesTable)
      .where(
        or(
          ilike(profilesTable.full_name, `%${query}%`),
          ilike(profilesTable.phone ?? "", `%${query}%`),
        ),
      )
      .limit(20);
    return res.json(profiles);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/checkin/schedule - current schedule (public read)
router.get("/checkin/schedule", async (req, res) => {
  try {
    const schedule = await getSchedule();
    return res.json(schedule);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// PUT /api/checkin/schedule - update schedule (leaders & super-admins)
router.put("/checkin/schedule", requireLeaderSession("leader"), async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      restrict_to_schedule?: unknown;
      windows?: unknown;
    };
    const restrict = body.restrict_to_schedule !== false; // default true
    const rawWindows = Array.isArray(body.windows) ? body.windows : [];

    const windows: CheckinWindow[] = [];
    for (const w of rawWindows as Record<string, unknown>[]) {
      const day = Number(w.day_of_week);
      const enabled = w.enabled === true;
      const start = String(w.start_time ?? "");
      const end = String(w.end_time ?? "");
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        return res.status(400).json({ error: `Invalid day_of_week: ${w.day_of_week}` });
      }
      if (enabled) {
        if (!HHMM.test(start) || !HHMM.test(end)) {
          return res.status(400).json({ error: `Times must be "HH:MM" for day ${day}` });
        }
        if (start >= end) {
          return res.status(400).json({ error: `Start must be before end for day ${day}` });
        }
      }
      windows.push({ day_of_week: day, start_time: start, end_time: end, enabled });
    }

    await db.transaction(async (tx) => {
      const existing = await tx.query.checkinSettingsTable.findFirst();
      if (existing) {
        await tx
          .update(checkinSettingsTable)
          .set({ restrict_to_schedule: restrict, updated_at: new Date(), updated_by: req.leaderId })
          .where(eq(checkinSettingsTable.id, existing.id));
      } else {
        await tx
          .insert(checkinSettingsTable)
          .values({ restrict_to_schedule: restrict, updated_by: req.leaderId });
      }
      await tx.delete(checkinWindowsTable);
      // Only persist rows with real "HH:MM" times. Disabled/blank days are
      // intentionally not stored; getSchedule() synthesises them as
      // { enabled:false, start_time:"", end_time:"" } on read-back.
      const toInsert = windows.filter((w) => HHMM.test(w.start_time) && HHMM.test(w.end_time));
      if (toInsert.length > 0) {
        await tx.insert(checkinWindowsTable).values(
          toInsert.map((w) => ({
            day_of_week: w.day_of_week,
            start_time: w.start_time,
            end_time: w.end_time,
            enabled: w.enabled,
          })),
        );
      }
    });

    const saved = await getSchedule();
    return res.json(saved);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/checkin/requests - Member self check-in request (Clerk-auth)
router.post("/checkin/requests", async (req, res) => {
  try {
    const profile = await resolveAccount(req);
    if (!profile) {
      return res
        .status(401)
        .json({ error: "Unauthorized. Please sign in to check in." });
    }

    // Leaders & super-admins may check in any time; everyone else is limited
    // to the configured schedule.
    const isLeader = profile.role === "leader" || profile.role === "super_admin";
    if (!isLeader && !(await isCheckinOpenNow())) {
      return res.status(403).json({
        error: "Check-in is closed right now. Please check in during the scheduled times.",
      });
    }

    const bodyData =
      req.body && typeof req.body === "object"
        ? (req.body as Record<string, unknown>)
        : {};
    const bodyProfileId = bodyData.profile_id;
    const sessionSlug = bodyData.sessionSlug as string | undefined;

    if (bodyProfileId && bodyProfileId !== profile.id) {
      return res.status(403).json({
        error: "You may only check in yourself.",
      });
    }

    if (sessionSlug) {
      req.log.info(`Check-in request for sessionSlug: ${sessionSlug}`);
    }

    const today = getSastToday();

    const existingAttendance = await db.query.attendanceTable.findFirst({
      where: and(
        eq(attendanceTable.profile_id, profile.id),
        eq(attendanceTable.session_date, today),
      ),
    });
    if (existingAttendance) {
      return res.status(409).json({
        error: "You have already been checked in for this session.",
      });
    }

    const existingRequest = await db.query.checkInRequestsTable.findFirst({
      where: and(
        eq(checkInRequestsTable.profile_id, profile.id),
        eq(checkInRequestsTable.session_date, today),
      ),
    });
    if (existingRequest) {
      return res.status(409).json({
        error:
          "You have already submitted a check-in request for this session.",
      });
    }

    if (profile.role === "leader" || profile.role === "super_admin") {
      const [attendance] = await db
        .insert(attendanceTable)
        .values({
          profile_id: profile.id,
          session_date: today,
          check_in_method: "self",
          type: "member",
        })
        .returning();

      return res.status(200).json({
        status: "approved",
        message: "Checked in successfully.",
        attendance,
      });
    }

    const [request] = await db
      .insert(checkInRequestsTable)
      .values({
        profile_id: profile.id,
        session_date: today,
        status: "pending",
        type: "member",
      })
      .returning();

    return res.status(201).json({
      status: "pending",
      message: "Check-in request submitted. Pending leader approval.",
      request,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/checkin/requests - List today's check-in requests (protected: leader)
router.get("/checkin/requests", requireLeaderSession("leader"), async (req, res) => {
  try {
    const today = getSastToday();
    const statusFilter = req.query.status as string | undefined;

    const validStatuses = ["pending", "approved", "rejected"] as const;
    type ValidStatus = (typeof validStatuses)[number];
    const statusCondition =
      statusFilter && validStatuses.includes(statusFilter as ValidStatus)
        ? eq(checkInRequestsTable.status, statusFilter as ValidStatus)
        : undefined;

    const rows = await db
      .select({
        id: checkInRequestsTable.id,
        profile_id: checkInRequestsTable.profile_id,
        visitor_id: checkInRequestsTable.visitor_id,
        type: checkInRequestsTable.type,
        session_date: checkInRequestsTable.session_date,
        status: checkInRequestsTable.status,
        requested_at: checkInRequestsTable.requested_at,
        member_name: profilesTable.full_name,
        member_phone: profilesTable.phone,
        member_role: profilesTable.role,
        visitor_name: visitorsTable.full_name,
        visitor_phone: visitorsTable.phone_number,
        visitor_age: visitorsTable.age,
        visitor_school: visitorsTable.school,
        visitor_parent_phone: visitorsTable.parent_phone,
        visitor_how_did_you_hear: visitorsTable.how_did_you_hear,
      })
      .from(checkInRequestsTable)
      .leftJoin(
        profilesTable,
        eq(checkInRequestsTable.profile_id, profilesTable.id),
      )
      .leftJoin(
        visitorsTable,
        eq(checkInRequestsTable.visitor_id, visitorsTable.id),
      )
      .where(
        statusCondition
          ? and(eq(checkInRequestsTable.session_date, today), statusCondition)
          : eq(checkInRequestsTable.session_date, today),
      )
      .orderBy(desc(checkInRequestsTable.requested_at));

    const requests = rows.map((row) => ({
      id: row.id,
      type: row.type,
      session_date: row.session_date,
      status: row.status,
      requested_at: row.requested_at,
      profile_id: row.profile_id,
      visitor_id: row.visitor_id,
      name:
        row.type === "visitor"
          ? (row.visitor_name ?? "Unknown visitor")
          : (row.member_name ?? "Unknown member"),
      phone: row.type === "visitor" ? row.visitor_phone : row.member_phone,
      role: row.type === "visitor" ? "visitor" : (row.member_role ?? "member"),
      age: row.type === "visitor" ? (row.visitor_age ?? null) : null,
      school: row.type === "visitor" ? (row.visitor_school ?? null) : null,
      parent_phone: row.type === "visitor" ? (row.visitor_parent_phone ?? null) : null,
      how_did_you_hear: row.type === "visitor" ? (row.visitor_how_did_you_hear ?? null) : null,
    }));

    return res.json(requests);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/checkin/requests/:id/approve - Approve check-in request (protected: leader)
router.patch("/checkin/requests/:id/approve", requireLeaderSession("leader"), async (req, res) => {
  try {
    const request = await db.query.checkInRequestsTable.findFirst({
      where: eq(checkInRequestsTable.id, req.params.id as string),
    });

    if (!request) {
      return res.status(404).json({ error: "Check-in request not found." });
    }

    if (request.status !== "pending") {
      return res
        .status(400)
        .json({ error: "Request has already been processed." });
    }

    await db.insert(attendanceTable).values({
      profile_id: request.profile_id ?? undefined,
      session_date: request.session_date,
      check_in_method: "qr",
      type: request.type,
    });

    await db
      .delete(checkInRequestsTable)
      .where(eq(checkInRequestsTable.id, req.params.id as string));

    // Send check-in confirmation email via database pending_emails queue
    if (request.profile_id) {
      const profile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.id, request.profile_id),
      });
      if (profile?.email) {
        let sessionDate = "";
        try {
          sessionDate = new Date(request.session_date).toLocaleDateString("en-ZA", {
            weekday: "long", year: "numeric", month: "long", day: "numeric",
          });
        } catch {
          sessionDate = String(request.session_date);
        }

        const emailBody = `
          <div style="font-family: 'Inter', sans-serif; background-color: #0B0F14; color: #E6E8EB; padding: 24px; border-radius: 8px;">
            <h2 style="color: #2A9D8F; font-family: 'Sora', sans-serif;">You are Checked In!</h2>
            <p>Hi <strong>${profile.full_name}</strong>,</p>
            <p>You have been successfully checked in for the youth session on <strong>${sessionDate}</strong>.</p>
            <p>See you in there!</p>
            <p style="margin-top: 24px; font-weight: bold; color: #2A9D8F;">Jeremiah Generation Youth Team</p>
          </div>
        `;

        await db.insert(pendingEmailsTable).values({
          to_address: profile.email,
          subject: "You are checked in — Jeremiah Generation Youth",
          body_html: emailBody,
        });
      }
    }

    return res.json({
      message: "Check-in approved.",
      id: req.params.id,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/checkin/requests/:id/reject - Reject check-in request (protected: leader)
router.patch("/checkin/requests/:id/reject", requireLeaderSession("leader"), async (req, res) => {
  try {
    const request = await db.query.checkInRequestsTable.findFirst({
      where: eq(checkInRequestsTable.id, req.params.id as string),
    });

    if (!request) {
      return res.status(404).json({ error: "Check-in request not found." });
    }

    if (request.status !== "pending") {
      return res
        .status(400)
        .json({ error: "Request has already been processed." });
    }

    await db
      .delete(checkInRequestsTable)
      .where(eq(checkInRequestsTable.id, req.params.id as string));

    return res.json({
      message: "Check-in request rejected.",
      id: req.params.id,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── SSE Check-in Status Stream Endpoint ───────────────────────────────────────
router.get("/checkin/stream/:requestId", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  
  res.write("retry: 5000\n"); // Tell client to retry in 5s if disconnected
  res.write("data: {\"status\":\"pending\"}\n\n");

  const requestId = req.params.requestId as string;

  try {
    // 1. Resolve request to get profile_id / visitor_id
    const initialRequest = await db.query.checkInRequestsTable.findFirst({
      where: eq(checkInRequestsTable.id, requestId),
    });

    if (!initialRequest) {
      res.write("data: {\"status\":\"rejected\"}\n\n");
      res.end();
      return;
    }

    const { profile_id, visitor_id, session_date } = initialRequest;

    const interval = setInterval(async () => {
      try {
        const request = await db.query.checkInRequestsTable.findFirst({
          where: eq(checkInRequestsTable.id, requestId),
        });

        if (request) {
          // Request still exists -> pending
          res.write("data: {\"status\":\"pending\"}\n\n");
        } else {
          // Request deleted! Check if approved or rejected
          let checkedIn = false;
          if (profile_id) {
            const attendance = await db.query.attendanceTable.findFirst({
              where: and(
                eq(attendanceTable.profile_id, profile_id),
                eq(attendanceTable.session_date, session_date)
              ),
            });
            checkedIn = !!attendance;
          } else if (visitor_id) {
            const visitor = await db.query.visitorsTable.findFirst({
              where: eq(visitorsTable.id, visitor_id),
            });
            checkedIn = visitor?.status === "approved";
          }

          if (checkedIn) {
            res.write("data: {\"status\":\"approved\"}\n\n");
          } else {
            res.write("data: {\"status\":\"rejected\"}\n\n");
          }
          
          clearInterval(interval);
          res.end();
        }
      } catch (err) {
        clearInterval(interval);
        res.end();
      }
    }, 2000);

    req.on("close", () => {
      clearInterval(interval);
    });
  } catch (err) {
    res.end();
  }
});

export default router;
