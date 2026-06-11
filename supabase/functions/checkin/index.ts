// Supabase Edge Function: checkin
// Port of artifacts/api-server/src/routes/checkin.ts (every route).
//
// Auth mapping (matches source exactly):
//   - GET  /checkin/search                       → public (no auth)
//   - GET  /checkin/schedule                     → public read (no auth)
//   - PUT  /checkin/schedule                     → requireLeaderSession("leader") → requireRole("leader")
//   - POST /checkin/requests                     → Clerk OR PIN-session auth (resolveAuth)
//   - GET  /checkin/requests                     → requireLeaderSession("leader") → requireRole("leader")
//   - PATCH /checkin/requests/:id/approve        → requireLeaderSession("leader") → requireRole("leader")
//   - PATCH /checkin/requests/:id/reject         → requireLeaderSession("leader") → requireRole("leader")
//   - GET  /checkin/stream/:requestId            → public SSE (no auth in source)

import { createApp } from "../_shared/router.ts";
import { db } from "../_shared/db.ts";
import {
  profilesTable,
  checkInRequestsTable,
  attendanceTable,
  visitorsTable,
  pendingEmailsTable,
  checkinSettingsTable,
  checkinWindowsTable,
} from "../_shared/schema.ts";
import { requireRole, resolveAuth } from "../_shared/auth.ts";
import { and, desc, eq, ilike, or } from "npm:drizzle-orm@0.45.2";
import { toZonedTime } from "npm:date-fns-tz@3";

const app = createApp();

// ── Check-in schedule helpers ──────────────────────────────────────────────────
// Ported from artifacts/api-server/src/lib/checkinSchedule.ts.

const TZ = "Africa/Johannesburg";

interface CheckinWindow {
  day_of_week: number; // 0=Sun … 6=Sat (matches JS Date.getDay())
  start_time: string; // "HH:MM" 24h SAST
  end_time: string; // "HH:MM" 24h SAST
  enabled: boolean;
}

interface CheckinSchedule {
  restrict_to_schedule: boolean;
  windows: CheckinWindow[];
}

/**
 * Pure open/closed decision. `nowHHMM` must be zero-padded "HH:MM".
 * Time comparison is a lexical string compare, valid for equal-length "HH:MM".
 */
function evaluateCheckinOpen(
  restrict: boolean,
  windows: CheckinWindow[],
  dayOfWeek: number,
  nowHHMM: string,
): boolean {
  if (!restrict) return true;
  return windows.some(
    (w) =>
      w.enabled &&
      w.day_of_week === dayOfWeek &&
      nowHHMM >= w.start_time &&
      nowHHMM < w.end_time,
  );
}

/** Reads the schedule, normalizing windows to all 7 weekdays (0..6). */
async function getSchedule(): Promise<CheckinSchedule> {
  const [settings, rows] = await Promise.all([
    db.query.checkinSettingsTable.findFirst(),
    db.select().from(checkinWindowsTable),
  ]);
  const byDay = new Map<number, (typeof rows)[number]>(
    rows.map((r) => [r.day_of_week, r]),
  );
  const windows: CheckinWindow[] = [];
  for (let d = 0; d < 7; d++) {
    const r = byDay.get(d);
    windows.push({
      day_of_week: d,
      start_time: r?.start_time ?? "",
      end_time: r?.end_time ?? "",
      enabled: r?.enabled ?? false,
    });
  }
  return { restrict_to_schedule: settings?.restrict_to_schedule ?? true, windows };
}

/** Current SAST { dayOfWeek, hhmm } as zero-padded "HH:MM". */
function sastNow(now: Date = new Date()): { dayOfWeek: number; hhmm: string } {
  const z = toZonedTime(now, TZ);
  const hh = String(z.getHours()).padStart(2, "0");
  const mm = String(z.getMinutes()).padStart(2, "0");
  return { dayOfWeek: z.getDay(), hhmm: `${hh}:${mm}` };
}

/** True if a non-leader may check in right now. Fails safe to closed on error. */
async function isCheckinOpenNow(): Promise<boolean> {
  try {
    const schedule = await getSchedule();
    const { dayOfWeek, hhmm } = sastNow();
    return evaluateCheckinOpen(
      schedule.restrict_to_schedule,
      schedule.windows.filter((w) => w.enabled && w.start_time && w.end_time),
      dayOfWeek,
      hhmm,
    );
  } catch (err) {
    console.error("[checkin] isCheckinOpenNow failed; treating as closed:", err);
    return false;
  }
}

function getSastToday(): string {
  const sast = toZonedTime(new Date(), "Africa/Johannesburg");
  const y = sast.getFullYear();
  const m = String(sast.getMonth() + 1).padStart(2, "0");
  const d = String(sast.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /checkin/search - Search members (Public)
app.get("/checkin/search", async (c) => {
  try {
    const queryParam = c.req.query("query");
    const query = typeof queryParam === "string" ? queryParam : "";
    if (!query || query.length < 2) {
      return c.json([]);
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
    return c.json(profiles);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /checkin/schedule - current schedule (public read)
app.get("/checkin/schedule", async (c) => {
  try {
    const schedule = await getSchedule();
    return c.json(schedule);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// PUT /checkin/schedule - update schedule (leaders & super-admins)
app.put("/checkin/schedule", requireRole("leader"), async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as {
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
        return c.json({ error: `Invalid day_of_week: ${w.day_of_week}` }, 400);
      }
      if (enabled) {
        if (!HHMM.test(start) || !HHMM.test(end)) {
          return c.json({ error: `Times must be "HH:MM" for day ${day}` }, 400);
        }
        if (start >= end) {
          return c.json({ error: `Start must be before end for day ${day}` }, 400);
        }
      }
      windows.push({ day_of_week: day, start_time: start, end_time: end, enabled });
    }

    const leaderId = c.get("leaderId") as string | undefined;

    await db.transaction(async (tx) => {
      const existing = await tx.query.checkinSettingsTable.findFirst();
      if (existing) {
        await tx
          .update(checkinSettingsTable)
          .set({ restrict_to_schedule: restrict, updated_at: new Date(), updated_by: leaderId })
          .where(eq(checkinSettingsTable.id, existing.id));
      } else {
        await tx
          .insert(checkinSettingsTable)
          .values({ restrict_to_schedule: restrict, updated_by: leaderId });
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
    return c.json(saved);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /checkin/requests - Member self check-in request (Clerk-auth)
app.post("/checkin/requests", async (c) => {
  try {
    const auth = await resolveAuth(c.req.raw);
    if (!auth) {
      return c.json(
        { error: "Unauthorized. Please sign in to check in." },
        401,
      );
    }
    const profile = auth.profile;

    // Leaders & super-admins may check in any time; everyone else is limited
    // to the configured schedule.
    const isLeader = profile.role === "leader" || profile.role === "super_admin";
    if (!isLeader && !(await isCheckinOpenNow())) {
      return c.json(
        {
          error:
            "Check-in is closed right now. Please check in during the scheduled times.",
        },
        403,
      );
    }

    const body = await c.req.json().catch(() => ({}));
    const bodyData =
      body && typeof body === "object"
        ? (body as Record<string, unknown>)
        : {};
    const bodyProfileId = bodyData.profile_id;
    const sessionSlug = bodyData.sessionSlug as string | undefined;

    if (bodyProfileId && bodyProfileId !== profile.id) {
      return c.json({ error: "You may only check in yourself." }, 403);
    }

    if (sessionSlug) {
      console.log(`Check-in request for sessionSlug: ${sessionSlug}`);
    }

    const today = getSastToday();

    const existingAttendance = await db.query.attendanceTable.findFirst({
      where: and(
        eq(attendanceTable.profile_id, profile.id),
        eq(attendanceTable.session_date, today),
      ),
    });
    if (existingAttendance) {
      return c.json(
        { error: "You have already been checked in for this session." },
        409,
      );
    }

    const existingRequest = await db.query.checkInRequestsTable.findFirst({
      where: and(
        eq(checkInRequestsTable.profile_id, profile.id),
        eq(checkInRequestsTable.session_date, today),
      ),
    });
    if (existingRequest) {
      return c.json(
        {
          error:
            "You have already submitted a check-in request for this session.",
        },
        409,
      );
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

      return c.json(
        {
          status: "approved",
          message: "Checked in successfully.",
          attendance,
        },
        200,
      );
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

    return c.json(
      {
        status: "pending",
        message: "Check-in request submitted. Pending leader approval.",
        request,
      },
      201,
    );
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /checkin/requests - List today's check-in requests (protected: leader)
app.get("/checkin/requests", requireRole("leader"), async (c) => {
  try {
    const today = getSastToday();
    const statusFilter = c.req.query("status");

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
      parent_phone:
        row.type === "visitor" ? (row.visitor_parent_phone ?? null) : null,
      how_did_you_hear:
        row.type === "visitor" ? (row.visitor_how_did_you_hear ?? null) : null,
    }));

    return c.json(requests);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// PATCH /checkin/requests/:id/approve - Approve check-in request (protected: leader)
app.patch("/checkin/requests/:id/approve", requireRole("leader"), async (c) => {
  try {
    const id = c.req.param("id");
    const request = await db.query.checkInRequestsTable.findFirst({
      where: eq(checkInRequestsTable.id, id),
    });

    if (!request) {
      return c.json({ error: "Check-in request not found." }, 404);
    }

    if (request.status !== "pending") {
      return c.json({ error: "Request has already been processed." }, 400);
    }

    await db.insert(attendanceTable).values({
      profile_id: request.profile_id ?? undefined,
      session_date: request.session_date,
      check_in_method: "qr",
      type: request.type,
    });

    await db
      .delete(checkInRequestsTable)
      .where(eq(checkInRequestsTable.id, id));

    // Send check-in confirmation email via database pending_emails queue
    if (request.profile_id) {
      const profile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.id, request.profile_id),
      });
      if (profile?.email) {
        let sessionDate = "";
        try {
          sessionDate = new Date(request.session_date).toLocaleDateString(
            "en-ZA",
            {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            },
          );
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

    return c.json({
      message: "Check-in approved.",
      id,
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// PATCH /checkin/requests/:id/reject - Reject check-in request (protected: leader)
app.patch("/checkin/requests/:id/reject", requireRole("leader"), async (c) => {
  try {
    const id = c.req.param("id");
    const request = await db.query.checkInRequestsTable.findFirst({
      where: eq(checkInRequestsTable.id, id),
    });

    if (!request) {
      return c.json({ error: "Check-in request not found." }, 404);
    }

    if (request.status !== "pending") {
      return c.json({ error: "Request has already been processed." }, 400);
    }

    await db
      .delete(checkInRequestsTable)
      .where(eq(checkInRequestsTable.id, id));

    return c.json({
      message: "Check-in request rejected.",
      id,
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ── SSE Check-in Status Stream Endpoint ───────────────────────────────────────
// GET /checkin/stream/:requestId (public). Ported from Express res.write SSE to a
// Deno ReadableStream. Polls every 2s; emits {status} and closes on resolution.
app.get("/checkin/stream/:requestId", (c) => {
  const requestId = c.req.param("requestId");
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let interval: number | undefined;

      const enqueue = (data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // controller already closed
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (interval !== undefined) clearInterval(interval);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // Tell client to retry in 5s if disconnected, plus initial pending event.
      enqueue("retry: 5000\n");
      enqueue('data: {"status":"pending"}\n\n');

      try {
        // 1. Resolve request to get profile_id / visitor_id
        const initialRequest = await db.query.checkInRequestsTable.findFirst({
          where: eq(checkInRequestsTable.id, requestId),
        });

        if (!initialRequest) {
          enqueue('data: {"status":"rejected"}\n\n');
          close();
          return;
        }

        const { profile_id, visitor_id, session_date } = initialRequest;

        interval = setInterval(async () => {
          try {
            const request = await db.query.checkInRequestsTable.findFirst({
              where: eq(checkInRequestsTable.id, requestId),
            });

            if (request) {
              // Request still exists -> pending
              enqueue('data: {"status":"pending"}\n\n');
            } else {
              // Request deleted! Check if approved or rejected
              let checkedIn = false;
              if (profile_id) {
                const attendance = await db.query.attendanceTable.findFirst({
                  where: and(
                    eq(attendanceTable.profile_id, profile_id),
                    eq(attendanceTable.session_date, session_date),
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
                enqueue('data: {"status":"approved"}\n\n');
              } else {
                enqueue('data: {"status":"rejected"}\n\n');
              }

              close();
            }
          } catch {
            close();
          }
        }, 2000) as unknown as number;
      } catch {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

Deno.serve(app.fetch);
