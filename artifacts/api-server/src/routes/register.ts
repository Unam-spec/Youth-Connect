import { Router } from "express";
import { db, visitorsTable, checkInRequestsTable } from "@workspace/db";

const router = Router();

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
    const { full_name, phone_number, email, gender, age, how_did_you_hear } =
      req.body;

    // ── Required field validation ──────────────────────────────────────────────
    if (!full_name || typeof full_name !== "string" || !full_name.trim()) {
      return res.status(400).json({ error: "full_name is required" });
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

    return res.status(201).json({ success: true, visitor });
  } catch (err: any) {
    req.log.error(err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
