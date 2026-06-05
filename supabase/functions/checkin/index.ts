// Supabase Edge Function: checkin
// Port of artifacts/api-server/src/routes/checkin.ts (every route).
//
// Auth mapping (matches source exactly):
//   - GET  /checkin/search                       → public (no auth)
//   - POST /checkin/requests                     → Clerk auth (getAuth(req).userId → getClerkUserId)
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
  type Profile,
} from "../_shared/schema.ts";
import { getClerkUserId, requireRole } from "../_shared/auth.ts";
import { and, desc, eq, ilike, or } from "npm:drizzle-orm@0.45.2";
import { toZonedTime } from "npm:date-fns-tz@3";

const app = createApp();

// ── Local helper: resolve profile from Clerk token ───────────────────────────
async function resolveClerkProfile(req: Request): Promise<Profile | null> {
  const userId = await getClerkUserId(req);
  if (!userId) return null;
  const profile = await db.query.profilesTable.findFirst({
    where: eq(profilesTable.clerk_id, userId),
  });
  return profile ?? null;
}

// ── Time-window helpers ───────────────────────────────────────────────────────

function isCheckinWindowOpen(): boolean {
  const sast = toZonedTime(new Date(), "Africa/Johannesburg");
  const day = sast.getDay(); // 0 = Sunday, 5 = Friday
  const totalMinutes = sast.getHours() * 60 + sast.getMinutes();
  return day === 5 && totalMinutes >= 18 * 60 + 30 && totalMinutes < 22 * 60;
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

// POST /checkin/requests - Member self check-in request (Clerk-auth)
app.post("/checkin/requests", async (c) => {
  try {
    const userId = await getClerkUserId(c.req.raw);
    if (!userId) {
      return c.json(
        { error: "Unauthorized. Please sign in to check in." },
        401,
      );
    }

    if (!isCheckinWindowOpen()) {
      const sast = toZonedTime(new Date(), "Africa/Johannesburg");
      const day = sast.getDay();
      if (day !== 5) {
        return c.json(
          {
            error:
              "Check-in is only available on Fridays between 18:30 and 22:00 SAST.",
          },
          403,
        );
      }
      const totalMinutes = sast.getHours() * 60 + sast.getMinutes();
      if (totalMinutes < 18 * 60 + 30) {
        return c.json(
          { error: "Check-in opens at 18:30 SAST on Fridays." },
          403,
        );
      }
      return c.json(
        { error: "Check-in has closed for tonight (closes at 22:00 SAST)." },
        403,
      );
    }

    const profile = await resolveClerkProfile(c.req.raw);
    if (!profile) {
      return c.json(
        {
          error:
            "Profile not found. Please complete your registration first.",
        },
        404,
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
