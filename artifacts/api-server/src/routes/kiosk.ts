import { Router } from "express";
import bcrypt from "bcrypt";
import { and, eq } from "drizzle-orm";
import {
  db,
  profilesTable,
  attendanceTable,
  membershipRequestsTable,
} from "@workspace/db";
import { requireLeaderSession } from "../middlewares/requireLeaderSession";
import { validateDob } from "../lib/age";
import { publishActivity } from "../lib/activityStream";
import {
  usernameFromName,
  usernameCandidates,
  generatePin,
} from "../lib/kioskAccount";

const router = Router();

// POST /kiosk/register — leader registers a newcomer on the shared kiosk phone.
// Creates a username+PIN visitor profile (login-capable on their own phone
// later), records tonight's attendance, and returns the credentials once for
// handoff. Leader-gated: the kiosk always runs under the leader's session.
router.post(
  "/kiosk/register",
  requireLeaderSession("leader"),
  async (req, res) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const fullName = typeof b.full_name === "string" ? b.full_name.trim() : "";
      if (!fullName) return res.status(400).json({ error: "full_name is required" });
      const avatarUrl = typeof b.avatar_url === "string" ? b.avatar_url.trim() : "";
      if (!avatarUrl) {
        return res.status(400).json({ error: "A profile picture is required" });
      }
      if (b.gender !== "male" && b.gender !== "female") {
        return res.status(400).json({ error: "gender is required" });
      }
      const v = validateDob(b.date_of_birth);
      if (!v.ok) return res.status(400).json({ error: v.error });
      const phone =
        typeof b.phone === "string" && b.phone.trim() ? b.phone.trim() : null;
      const parentName =
        typeof b.parent_name === "string" && b.parent_name.trim()
          ? b.parent_name.trim()
          : null;
      const parentPhone =
        typeof b.parent_phone === "string" && b.parent_phone.trim()
          ? b.parent_phone.trim()
          : null;

      const pin = generatePin();
      const pinHash = await bcrypt.hash(pin, 12);

      // The partial unique index on lower(btrim(username)) arbitrates races:
      // on 23505 try the next candidate.
      let inserted = null;
      for (const candidate of usernameCandidates(usernameFromName(fullName))) {
        try {
          [inserted] = await db
            .insert(profilesTable)
            .values({
              full_name: fullName,
              username: candidate,
              pin_hash: pinHash,
              pin_plain: pin, // deliberate: leaders can always recover kids' PINs
              date_of_birth: String(b.date_of_birth).trim(),
              age: v.age,
              gender: b.gender,
              phone,
              avatar_url: avatarUrl,
              parent_name: parentName,
              parent_phone: parentPhone,
              role: "visitor",
              heard_from: "kiosk",
            })
            .returning();
          break;
        } catch (e) {
          if ((e as { code?: string })?.code === "23505") continue;
          throw e;
        }
      }
      if (!inserted) {
        return res.status(500).json({ error: "Could not allocate a username" });
      }

      const today = new Date().toISOString().split("T")[0] as string;
      await db.insert(attendanceTable).values({
        profile_id: inserted.id,
        session_date: today,
        check_in_method: "manual",
        type: "visitor",
      });
      publishActivity({
        type: "registration",
        profile_id: inserted.id,
        profile_name: inserted.full_name,
        metadata: { source: "kiosk_registration" },
      });

      return res.status(201).json({
        profile_id: inserted.id,
        full_name: inserted.full_name,
        username: inserted.username,
        pin,
      });
    } catch (err) {
      req.log.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// POST /kiosk/request-membership — "want to become a member?" tap on the kiosk.
// Idempotent pending membership request; no leader email (the leader is present).
router.post(
  "/kiosk/request-membership",
  requireLeaderSession("leader"),
  async (req, res) => {
    try {
      const profileId = ((req.body ?? {}) as Record<string, unknown>).profile_id;
      if (typeof profileId !== "string" || !profileId) {
        return res.status(400).json({ error: "profile_id is required" });
      }
      const target = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.id, profileId),
      });
      if (!target) return res.status(404).json({ error: "Profile not found" });

      const existing = await db
        .select({ id: membershipRequestsTable.id })
        .from(membershipRequestsTable)
        .where(
          and(
            eq(membershipRequestsTable.profile_id, profileId),
            eq(membershipRequestsTable.status, "pending"),
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        await db.insert(membershipRequestsTable).values({
          profile_id: profileId,
          reason: "Kiosk registration",
          status: "pending",
        });
        publishActivity({
          type: "membership_request",
          profile_id: target.id,
          profile_name: target.full_name,
          metadata: { source: "kiosk_registration" },
        });
      }
      return res.json({ success: true });
    } catch (err) {
      req.log.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// POST /kiosk/verify-pin — leader re-authenticates to exit kiosk mode.
router.post(
  "/kiosk/verify-pin",
  requireLeaderSession("leader"),
  async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const pin = typeof body.pin === "string" ? body.pin : "";
      const profile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.id, req.leaderId!),
      });
      if (!profile?.pin_hash) return res.json({ valid: false, no_pin: true });
      // Legacy short hashes are plaintext (same fallback as /leaders/verify-pin).
      const valid =
        profile.pin_hash.length < 20
          ? pin === profile.pin_hash
          : await bcrypt.compare(pin, profile.pin_hash);
      return res.json({ valid });
    } catch (err) {
      req.log.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
