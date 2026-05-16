import { Router } from "express";
import { getAuth } from "@clerk/express";
import { ilike, or, eq, and, desc } from "drizzle-orm";
import { toZonedTime } from "date-fns-tz";
import {
  db,
  profilesTable,
  checkInRequestsTable,
  attendanceTable,
} from "@workspace/db";

const router = Router();

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

router.post("/checkin/requests", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Time restriction: Check-in only available on Fridays 18:30-22:00 SAST
    const now = new Date();
    const sastTime = toZonedTime(now, "Africa/Johannesburg");
    const dayOfWeek = sastTime.getDay(); // 0 = Sunday, 5 = Friday
    const hours = sastTime.getHours();
    const minutes = sastTime.getMinutes();
    const currentTimeInMinutes = hours * 60 + minutes;
    const openTime = 18 * 60 + 30; // 18:30 in minutes
    const closeTime = 22 * 60; // 22:00 in minutes

    if (dayOfWeek !== 5) {
      return res.status(403).json({
        error: "Check-in is only available on Fridays at 18:30 SAST",
      });
    }

    if (currentTimeInMinutes < openTime) {
      return res.status(403).json({
        error: "Check-in opens at 18:30 SAST on Fridays",
      });
    }

    if (currentTimeInMinutes >= closeTime) {
      return res.status(403).json({
        error: "Check-in has closed for tonight",
      });
    }

    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, auth.userId),
    });

    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const today = new Date().toISOString().split("T")[0];

    // Check if user already has a pending request for today
    const existingRequest = await db.query.checkInRequestsTable.findFirst({
      where: and(
        eq(checkInRequestsTable.profile_id, profile.id),
        eq(checkInRequestsTable.session_date, today),
        eq(checkInRequestsTable.status, "pending"),
      ),
    });

    if (existingRequest) {
      return res.status(409).json({
        error: "You have already requested check-in for this session",
      });
    }

    // Leaders and super admins auto-approve - skip check_in_requests and go directly to attendance
    if (profile.role === "leader" || profile.role === "super_admin") {
      const [attendance] = await db
        .insert(attendanceTable)
        .values({
          profile_id: profile.id,
          session_date: today,
          check_in_method: "self",
        })
        .returning();

      return res.status(200).json({
        message: "Checked in successfully",
        attendance,
      });
    }

    // Members and visitors go through check_in_requests
    const [request] = await db
      .insert(checkInRequestsTable)
      .values({
        profile_id: profile.id,
        session_date: today,
        status: "pending",
      })
      .returning();

    return res.status(201).json({
      message: "Check-in request submitted, pending approval",
      request,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/checkin/requests", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, auth.userId),
    });

    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    // Only leaders and super admins can view pending requests
    if (profile.role !== "leader" && profile.role !== "super_admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const today = new Date().toISOString().split("T")[0];

    const requests = await db
      .select({
        id: checkInRequestsTable.id,
        profile_id: checkInRequestsTable.profile_id,
        session_date: checkInRequestsTable.session_date,
        status: checkInRequestsTable.status,
        requested_at: checkInRequestsTable.requested_at,
        profile: {
          id: profilesTable.id,
          full_name: profilesTable.full_name,
          phone: profilesTable.phone,
          role: profilesTable.role,
        },
      })
      .from(checkInRequestsTable)
      .leftJoin(
        profilesTable,
        eq(checkInRequestsTable.profile_id, profilesTable.id),
      )
      .where(eq(checkInRequestsTable.session_date, today))
      .orderBy(desc(checkInRequestsTable.requested_at));

    return res.json(requests);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/checkin/requests/:id/approve", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const reviewerProfile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, auth.userId),
    });

    if (!reviewerProfile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    if (
      reviewerProfile.role !== "leader" &&
      reviewerProfile.role !== "super_admin"
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const request = await db.query.checkInRequestsTable.findFirst({
      where: eq(checkInRequestsTable.id, req.params.id),
    });

    if (!request) {
      return res.status(404).json({ error: "Check-in request not found" });
    }

    if (request.status !== "pending") {
      return res.status(400).json({ error: "Request already processed" });
    }

    // Update request status
    const [updatedRequest] = await db
      .update(checkInRequestsTable)
      .set({
        status: "approved",
        reviewed_by: reviewerProfile.id,
        reviewed_at: new Date(),
      })
      .where(eq(checkInRequestsTable.id, req.params.id))
      .returning();

    // Create attendance record
    await db.insert(attendanceTable).values({
      profile_id: request.profile_id,
      session_date: request.session_date,
      check_in_method: "qr",
    });

    return res.json(updatedRequest);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/checkin/requests/:id/reject", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const reviewerProfile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, auth.userId),
    });

    if (!reviewerProfile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    if (
      reviewerProfile.role !== "leader" &&
      reviewerProfile.role !== "super_admin"
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const request = await db.query.checkInRequestsTable.findFirst({
      where: eq(checkInRequestsTable.id, req.params.id),
    });

    if (!request) {
      return res.status(404).json({ error: "Check-in request not found" });
    }

    if (request.status !== "pending") {
      return res.status(400).json({ error: "Request already processed" });
    }

    const [updatedRequest] = await db
      .update(checkInRequestsTable)
      .set({
        status: "rejected",
        reviewed_by: reviewerProfile.id,
        reviewed_at: new Date(),
      })
      .where(eq(checkInRequestsTable.id, req.params.id))
      .returning();

    return res.json(updatedRequest);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
