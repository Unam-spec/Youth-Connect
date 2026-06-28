import { Router } from "express";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { eq } from "drizzle-orm";
import { db, visitorsTable, checkInRequestsTable } from "@workspace/db";
import { isCheckinOpenNow } from "../lib/checkinSchedule";
import { publishActivity } from "../lib/activityStream";
import { uploadAvatar, FileTooLargeError } from "../storage/avatarUpload";

const router = Router();

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});

// POST /api/register/photo — public profile-picture upload for first-timers.
// First-timers have no profile/auth yet, so this is unauthenticated; the upload
// is size/type limited and returns a public URL the register form then submits.
router.post("/register/photo", photoUpload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No image file provided" });
    }
    if (!file.mimetype.startsWith("image/")) {
      return res.status(400).json({ error: "Only image files are allowed" });
    }
    const url = await uploadAvatar(`visitor-${randomUUID()}`, file.buffer, file.mimetype);
    return res.json({ url });
  } catch (err: any) {
    if (err instanceof FileTooLargeError || err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "Image exceeds the 2MB size limit. Please choose a smaller photo." });
    }
    req.log.error(err);
    return res.status(500).json({ error: err.message || "Failed to upload photo" });
  }
});

/**
 * POST /api/register
 *
 * Fully public endpoint — no auth middleware, no Clerk check.
 * Registers a first-time visitor and creates a pending check-in request
 * so a leader can approve their attendance.
 *
 * Body fields:
 *   full_name        string  required
 *   phone_number     string  required
 *   email            string  optional (empty string treated as null)
 *   gender           "male" | "female" | "other"  required
 *   age              number  required (converted to integer)
 *   how_did_you_hear string  required
 */
router.post("/register", async (req, res) => {
  try {
    // First-timer registration is a self check-in: it creates a pending
    // check-in request for today's session. Like the member self check-in
    // (POST /checkin/requests), it must respect the schedule configured in the
    // leader dashboard. Fails closed if the schedule can't be read.
    if (!(await isCheckinOpenNow())) {
      return res.status(403).json({
        error: "Check-in is closed right now. Please register during the scheduled check-in times.",
      });
    }

    const { full_name, phone_number, email, gender, age, how_did_you_hear, school, parent_phone, parent_name, whatsapp_opt_in, avatar_url } =
      req.body;

    // ── Required field validation ──────────────────────────────────────────────
    if (!full_name || typeof full_name !== "string" || !full_name.trim()) {
      return res.status(400).json({ error: "full_name is required" });
    }
    // A profile picture is mandatory: registration must not go through without one.
    if (!avatar_url || typeof avatar_url !== "string" || !avatar_url.trim()) {
      return res.status(400).json({ error: "A profile picture is required to register" });
    }
    if (
      !phone_number ||
      typeof phone_number !== "string" ||
      !phone_number.trim()
    ) {
      return res.status(400).json({ error: "phone_number is required" });
    }
    if (!gender || !["male", "female", "other"].includes(gender)) {
      return res.status(400).json({
        error: "gender is required and must be male, female, or other",
      });
    }
    if (age === undefined || age === null || age === "") {
      return res.status(400).json({ error: "age is required" });
    }
    if (
      !how_did_you_hear ||
      typeof how_did_you_hear !== "string" ||
      !how_did_you_hear.trim()
    ) {
      return res.status(400).json({ error: "how_did_you_hear is required" });
    }

    // ── Type coercions ─────────────────────────────────────────────────────────
    const ageInt = parseInt(String(age), 10);
    if (isNaN(ageInt) || ageInt < 1 || ageInt > 120) {
      return res
        .status(400)
        .json({ error: "age must be a valid number between 1 and 120" });
    }

    // Convert empty string email to null
    const emailValue =
      !email || (typeof email === "string" && email.trim() === "")
        ? null
        : String(email).trim();

    const today = new Date().toISOString().split("T")[0] as string;

    // ── Insert visitor record ──────────────────────────────────────────────────
    const [visitor] = await db
      .insert(visitorsTable)
      .values({
        full_name: full_name.trim(),
        phone_number: phone_number.trim(),
        email: emailValue,
        gender: gender as "male" | "female" | "other",
        age: ageInt,
        how_did_you_hear: how_did_you_hear.trim(),
        school: school && typeof school === 'string' && school.trim() ? school.trim() : null,
        parent_phone: parent_phone && typeof parent_phone === 'string' && parent_phone.trim() ? parent_phone.trim() : null,
        parent_name: parent_name && typeof parent_name === 'string' && parent_name.trim() ? parent_name.trim() : null,
        avatar_url: avatar_url.trim(),
        whatsapp_opt_in: !!whatsapp_opt_in,
        session_date: today,
        status: "pending",
      })
      .returning();

    // ── Insert check-in request for this visitor ───────────────────────────────
    // type = 'visitor' so leaders can distinguish first-timers from members
    await db.insert(checkInRequestsTable).values({
      visitor_id: visitor.id,
      type: "visitor",
      session_date: today,
      status: "pending",
    });

    publishActivity({
      type: "registration",
      profile_id: visitor.id,
      profile_name: visitor.full_name,
      metadata: { source: "visitor_registration" },
    });

    return res.status(201).json({ success: true, visitor });
  } catch (err: any) {
    req.log.error(err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/register/membership-intent
 *
 * Public — called right after registration when a first-timer answers the
 * "Would you like to become a member?" prompt. Setting wants_membership = true
 * routes their pending check-in into the leaders' membership check-in queue;
 * false keeps them in the first-timer check-in approvals. The visitor id is an
 * unguessable UUID returned by the registration response, which gates the call.
 */
router.patch("/register/membership-intent", async (req, res) => {
  try {
    const { visitor_id, wants_membership } = req.body ?? {};
    if (!visitor_id || typeof visitor_id !== "string") {
      return res.status(400).json({ error: "visitor_id is required" });
    }

    const [updated] = await db
      .update(visitorsTable)
      .set({ wants_membership: !!wants_membership })
      .where(eq(visitorsTable.id, visitor_id))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Visitor not found" });
    }

    if (wants_membership) {
      publishActivity({
        type: "membership_request",
        profile_id: updated.id,
        profile_name: updated.full_name,
        metadata: { source: "first_timer_registration" },
      });
    }

    return res.json({ success: true, wants_membership: updated.wants_membership });
  } catch (err: any) {
    req.log.error(err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
