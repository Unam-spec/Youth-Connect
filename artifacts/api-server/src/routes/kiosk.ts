import { Router } from "express";
import bcrypt from "bcrypt";
import { and, eq } from "drizzle-orm";
import {
  db,
  profilesTable,
  attendanceTable,
  checkInRequestsTable,
  membershipRequestsTable,
  kioskSettingsTable,
} from "@workspace/db";
import { requireLeaderSession } from "../middlewares/requireLeaderSession";
import { validateDob, todaySAST } from "../lib/age";
import { validatePin } from "../lib/pin";
import { publishActivity } from "../lib/activityStream";
import {
  usernameFromName,
  usernameCandidates,
  generatePin,
} from "../lib/kioskAccount";

const router = Router();

// Kiosk check-ins are NOT auto-approved: they join the same pending queue the
// leader dashboard already reviews. The kiosk immediately resets for the next
// person; approval later fires a web push to the member's own devices.

/** 409 message when the person already has attendance or a request today. */
async function checkinDuplicate(profileId: string, today: string): Promise<string | null> {
  const attended = await db.query.attendanceTable.findFirst({
    where: and(
      eq(attendanceTable.profile_id, profileId),
      eq(attendanceTable.session_date, today),
    ),
  });
  if (attended) return "Already checked in for this session.";
  const requested = await db.query.checkInRequestsTable.findFirst({
    where: and(
      eq(checkInRequestsTable.profile_id, profileId),
      eq(checkInRequestsTable.session_date, today),
    ),
  });
  if (requested) return "Already waiting for leader approval.";
  return null;
}

// POST /kiosk/checkin — queue an existing member's check-in from the shared
// kiosk phone. Leader-gated (the kiosk runs under the leader's session).
router.post(
  "/kiosk/checkin",
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

      const today = todaySAST();
      const dup = await checkinDuplicate(profileId, today);
      if (dup) return res.status(409).json({ error: dup });

      const [request] = await db
        .insert(checkInRequestsTable)
        .values({
          profile_id: profileId,
          session_date: today,
          status: "pending",
          type: "member",
          check_in_method: "manual",
        })
        .returning();

      return res.status(201).json({ status: "pending", request });
    } catch (err) {
      req.log.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// POST /kiosk/register — leader registers a newcomer on the shared kiosk
// phone. Creates a username+PIN visitor profile (login-capable on their own
// phone later), queues a pending check-in for leader approval, and returns
// the credentials once for the WhatsApp handoff.
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
      // Phone is required at the kiosk: the login handoff and future check-in
      // reminders go out over WhatsApp.
      const phone = typeof b.phone === "string" && b.phone.trim() ? b.phone.trim() : null;
      if (!phone) {
        return res.status(400).json({ error: "A phone / WhatsApp number is required" });
      }
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

      // Pending check-in (type "member": display data comes from the profiles
      // join — the "visitor" request type is reserved for legacy visitors-table
      // rows). Approval later records attendance + sends the push.
      await db.insert(checkInRequestsTable).values({
        profile_id: inserted.id,
        session_date: todaySAST(),
        status: "pending",
        type: "member",
        check_in_method: "manual",
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

// ── Shared kiosk PIN ──────────────────────────────────────────────────────────
// One PIN for every leader/super-admin, used only to exit kiosk mode. Stored in
// the single-row kiosk_settings table (seeded at boot); managed from the
// dashboard session tab.

async function getKioskSettings() {
  const [row] = await db.select().from(kioskSettingsTable).limit(1);
  return row ?? null;
}

// GET /kiosk/pin — reveal the shared kiosk PIN (leader). Seeds one if missing.
router.get("/kiosk/pin", requireLeaderSession("leader"), async (req, res) => {
  try {
    let row = await getKioskSettings();
    if (!row) {
      const pin = generatePin();
      const pinHash = await bcrypt.hash(pin, 12);
      [row] = await db
        .insert(kioskSettingsTable)
        .values({ pin_hash: pinHash, pin_plain: pin })
        .returning();
    }
    return res.json({ pin: row.pin_plain });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /kiosk/pin — change the shared kiosk PIN (leader).
router.put("/kiosk/pin", requireLeaderSession("leader"), async (req, res) => {
  try {
    const check = validatePin((req.body ?? {}).pin);
    if (!check.ok) return res.status(400).json({ error: check.error });
    const pinHash = await bcrypt.hash(check.value, 12);

    const existing = await getKioskSettings();
    if (existing) {
      await db
        .update(kioskSettingsTable)
        .set({ pin_hash: pinHash, pin_plain: check.value, updated_at: new Date() })
        .where(eq(kioskSettingsTable.id, existing.id));
    } else {
      await db
        .insert(kioskSettingsTable)
        .values({ pin_hash: pinHash, pin_plain: check.value });
    }
    return res.json({ success: true, pin: check.value });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /kiosk/verify-pin — check the shared kiosk PIN to exit kiosk mode.
// Fails OPEN when no PIN row exists yet: being locked inside the kiosk is
// worse than a soft lock being briefly absent (boot seeding makes this rare).
router.post(
  "/kiosk/verify-pin",
  requireLeaderSession("leader"),
  async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const pin = typeof body.pin === "string" ? body.pin : "";
      const row = await getKioskSettings();
      if (!row) return res.json({ valid: true, no_pin: true });
      const valid = await bcrypt.compare(pin, row.pin_hash);
      return res.json({ valid });
    } catch (err) {
      req.log.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
