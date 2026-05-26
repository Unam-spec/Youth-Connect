import { Router, type Request } from "express";
import { getAuth } from "@clerk/express";
import { ilike, or, eq, and, desc } from "drizzle-orm";
import { toZonedTime } from "date-fns-tz";
import {
  db,
  profilesTable,
  checkInRequestsTable,
  attendanceTable,
  visitorsTable,
  type Profile,
} from "@workspace/db";

const router = Router();

// ── Auth helpers ──────────────────────────────────────────────────────────────

/**
 * Resolve the authenticated profile from a Clerk JWT.
 * Returns null if the request has no valid Clerk session.
 */
async function resolveClerkProfile(req: Request): Promise<Profile | null> {
  const auth = getAuth(req);
  if (!auth?.userId) return null;
  const profile = await db.query.profilesTable.findFirst({
    where: eq(profilesTable.clerk_id, auth.userId),
  });
  return profile ?? null;
}

/**
 * Resolve a leader/super_admin profile from either:
 *   1. A valid Clerk JWT whose profile has role leader|super_admin, OR
 *   2. A valid x-leader-session header (PIN-based leader auth).
 *
 * Returns null if neither auth method yields a leader/super_admin.
 */
async function resolveLeaderOrAdmin(req: Request): Promise<Profile | null> {
  // 1. Try Clerk auth
  const clerkAuth = getAuth(req);
  if (clerkAuth?.userId) {
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, clerkAuth.userId),
    });
    if (
      profile &&
      (profile.role === "leader" || profile.role === "super_admin")
    ) {
      return profile;
    }
    // Clerk user found but not a leader — do NOT fall through to session header
    return null;
  }

  // 2. Fall back to x-leader-session (PIN-based leader auth from dashboard)
  const sessionHeader = req.headers["x-leader-session"];
  if (typeof sessionHeader === "string") {
    try {
      const session: { profile_id?: string; expires_at?: number } =
        JSON.parse(sessionHeader);
      if (
        session.profile_id &&
        typeof session.expires_at === "number" &&
        Date.now() < session.expires_at
      ) {
        const profile = await db.query.profilesTable.findFirst({
          where: eq(profilesTable.id, session.profile_id),
        });
        if (
          profile &&
          (profile.role === "leader" || profile.role === "super_admin")
        ) {
          return profile;
        }
      }
    } catch {
      // ignore malformed session header
    }
  }

  return null;
}

// ── Time-window helpers ───────────────────────────────────────────────────────

/**
 * Returns true only on Fridays between 18:30 and 22:00 Africa/Johannesburg.
 */
function isCheckinWindowOpen(): boolean {
  const sast = toZonedTime(new Date(), "Africa/Johannesburg");
  const day = sast.getDay(); // 0 = Sunday, 5 = Friday
  const totalMinutes = sast.getHours() * 60 + sast.getMinutes();
  return day === 5 && totalMinutes >= 18 * 60 + 30 && totalMinutes < 22 * 60;
}

/**
 * Returns today's date string in Africa/Johannesburg timezone (YYYY-MM-DD).
 */
function getSastToday(): string {
  const sast = toZonedTime(new Date(), "Africa/Johannesburg");
  const y = sast.getFullYear();
  const m = String(sast.getMonth() + 1).padStart(2, "0");
  const d = String(sast.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/checkin/search
 * Search profiles by name or phone — used by the leader dashboard manual
 * check-in panel. No auth required (results are non-sensitive).
 */
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

/**
 * POST /api/checkin/requests
 *
 * Member self check-in. Requires a valid Clerk JWT — the authenticated user's
 * profile is always used; profile_id in the request body is ignored (and
 * rejected if it doesn't match the authenticated user).
 *
 * Time restriction: Fridays 18:30–22:00 Africa/Johannesburg only.
 *
 * Role behaviour:
 *   leader | super_admin → inserted directly into attendance (approved)
 *   member | visitor     → inserted into check_in_requests as pending
 */
router.post("/checkin/requests", async (req, res) => {
  try {
    // ── 1. Require Clerk auth ─────────────────────────────────────────────────
    const clerkAuth = getAuth(req);
    if (!clerkAuth?.userId) {
      return res
        .status(401)
        .json({ error: "Unauthorized. Please sign in to check in." });
    }

    // ── 2. Server-side time-window check (Africa/Johannesburg) ────────────────
    if (!isCheckinWindowOpen()) {
      const sast = toZonedTime(new Date(), "Africa/Johannesburg");
      const day = sast.getDay();
      if (day !== 5) {
        return res.status(403).json({
          error:
            "Check-in is only available on Fridays between 18:30 and 22:00 SAST.",
        });
      }
      const totalMinutes = sast.getHours() * 60 + sast.getMinutes();
      if (totalMinutes < 18 * 60 + 30) {
        return res.status(403).json({
          error: "Check-in opens at 18:30 SAST on Fridays.",
        });
      }
      return res.status(403).json({
        error: "Check-in has closed for tonight (closes at 22:00 SAST).",
      });
    }

    // ── 3. Resolve profile from Clerk token (never from request body) ─────────
    const profile = await resolveClerkProfile(req);
    if (!profile) {
      return res.status(404).json({
        error: "Profile not found. Please complete your registration first.",
      });
    }

    // ── 4. Reject if body contains a mismatched profile_id ───────────────────
    const bodyProfileId =
      req.body && typeof req.body === "object"
        ? (req.body as Record<string, unknown>).profile_id
        : undefined;
    if (bodyProfileId && bodyProfileId !== profile.id) {
      return res.status(403).json({
        error: "You may only check in yourself.",
      });
    }

    const today = getSastToday();

    // ── 5. Duplicate check: already in attendance ─────────────────────────────
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

    // ── 6. Duplicate check: already has a pending request ────────────────────
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

    // ── 7. Role-based routing ─────────────────────────────────────────────────
    if (profile.role === "leader" || profile.role === "super_admin") {
      // Leaders and super admins bypass the approval queue
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

    // Members and visitors → pending approval
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

/**
 * GET /api/checkin/requests?status=pending
 *
 * Returns today's check-in requests, optionally filtered by status.
 * Joins with profiles (members) and visitors (first-timers) to include names.
 * Auth: leaders and super admins only (Clerk JWT or x-leader-session header).
 */
router.get("/checkin/requests", async (req, res) => {
  try {
    const leader = await resolveLeaderOrAdmin(req);
    if (!leader) {
      const clerkAuth = getAuth(req);
      if (!clerkAuth?.userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      return res
        .status(403)
        .json({ error: "Forbidden. Leaders and super admins only." });
    }

    const today = getSastToday();
    const statusFilter = req.query.status as string | undefined;

    // Build status condition
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
        // Member fields (null for visitor requests)
        member_name: profilesTable.full_name,
        member_phone: profilesTable.phone,
        member_role: profilesTable.role,
        // Visitor fields (null for member requests)
        visitor_name: visitorsTable.full_name,
        visitor_phone: visitorsTable.phone_number,
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

    // Normalise: expose a single `name`, `phone`, `role` regardless of type
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
    }));

    return res.json(requests);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /api/checkin/requests/:id/approve
 *
 * Approve a pending check-in request:
 *   1. Insert a row into attendance.
 *   2. Delete the row from check_in_requests.
 *
 * Auth: leaders and super admins only.
 */
router.patch("/checkin/requests/:id/approve", async (req, res) => {
  try {
    const leader = await resolveLeaderOrAdmin(req);
    if (!leader) {
      const clerkAuth = getAuth(req);
      if (!clerkAuth?.userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      return res
        .status(403)
        .json({ error: "Forbidden. Leaders and super admins only." });
    }

    const request = await db.query.checkInRequestsTable.findFirst({
      where: eq(checkInRequestsTable.id, req.params.id),
    });

    if (!request) {
      return res.status(404).json({ error: "Check-in request not found." });
    }

    if (request.status !== "pending") {
      return res
        .status(400)
        .json({ error: "Request has already been processed." });
    }

    // Insert into attendance (profile_id may be null for visitor requests)
    await db.insert(attendanceTable).values({
      profile_id: request.profile_id ?? undefined,
      session_date: request.session_date,
      check_in_method: "qr",
      type: request.type,
    });

    // Remove from check_in_requests — no longer needed
    await db
      .delete(checkInRequestsTable)
      .where(eq(checkInRequestsTable.id, req.params.id));

    return res.json({
      message: "Check-in approved.",
      id: req.params.id,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /api/checkin/requests/:id/reject
 *
 * Reject a pending check-in request by deleting it from check_in_requests.
 * Auth: leaders and super admins only.
 */
router.patch("/checkin/requests/:id/reject", async (req, res) => {
  try {
    const leader = await resolveLeaderOrAdmin(req);
    if (!leader) {
      const clerkAuth = getAuth(req);
      if (!clerkAuth?.userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      return res
        .status(403)
        .json({ error: "Forbidden. Leaders and super admins only." });
    }

    const request = await db.query.checkInRequestsTable.findFirst({
      where: eq(checkInRequestsTable.id, req.params.id),
    });

    if (!request) {
      return res.status(404).json({ error: "Check-in request not found." });
    }

    if (request.status !== "pending") {
      return res
        .status(400)
        .json({ error: "Request has already been processed." });
    }

    // Delete from check_in_requests
    await db
      .delete(checkInRequestsTable)
      .where(eq(checkInRequestsTable.id, req.params.id));

    return res.json({
      message: "Check-in request rejected.",
      id: req.params.id,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
