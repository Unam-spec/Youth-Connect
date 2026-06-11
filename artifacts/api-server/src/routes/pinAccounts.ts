import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { eq, sql, isNotNull, desc } from "drizzle-orm";
import { db, profilesTable } from "@workspace/db";
import { validateUsername } from "../lib/username";
import { validatePin } from "../lib/pin";
import { resolveAccount } from "../lib/resolveAccount";
import { requireLeaderSession } from "../middlewares/requireLeaderSession";
import { canGrantMembership, CONSENT_AGE } from "../lib/membershipConsent";

const router = Router();

const SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours

function sessionPayload(profileId: string, sessionToken: string) {
  return {
    success: true,
    profile_id: profileId,
    session_token: sessionToken,
    expires_at: Date.now() + SESSION_MS,
  };
}

// Looks up a profile by normalized username via the same lower(btrim()) predicate
// as the unique index, so lookups match stored rows case-insensitively.
async function findByUsername(normalized: string) {
  return db.query.profilesTable.findFirst({
    where: sql`lower(btrim(${profilesTable.username})) = ${normalized}`,
  });
}

// POST /auth/pin-signup — public. Creates a visitor account and auto-logs-in.
router.post("/auth/pin-signup", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
    if (!fullName) return res.status(400).json({ error: "full_name is required" });

    const uname = validateUsername(body.username);
    if (!uname.ok) return res.status(400).json({ error: uname.error });

    const pin = validatePin(body.pin);
    if (!pin.ok) return res.status(400).json({ error: pin.error });

    const ageRaw = body.age;
    const age =
      ageRaw === undefined || ageRaw === null || ageRaw === ""
        ? null
        : parseInt(String(ageRaw), 10);
    if (age !== null && (Number.isNaN(age) || age < 1 || age > 120)) {
      return res.status(400).json({ error: "age must be a valid number between 1 and 120" });
    }

    const existing = await findByUsername(uname.value);
    if (existing) return res.status(409).json({ error: "That username is already taken." });

    const pinHash = await bcrypt.hash(pin.value, 12);
    const sessionToken = crypto.randomUUID();

    let inserted;
    try {
      [inserted] = await db
        .insert(profilesTable)
        .values({
          full_name: fullName,
          username: uname.value,
          pin_hash: pinHash,
          pin_plain: pin.value,
          age,
          role: "visitor",
          parent_phone:
            typeof body.parent_phone === "string" && body.parent_phone.trim()
              ? body.parent_phone.trim()
              : null,
          parent_name:
            typeof body.parent_name === "string" && body.parent_name.trim()
              ? body.parent_name.trim()
              : null,
          session_token: sessionToken,
        })
        .returning();
    } catch (e) {
      // Unique-index race: another signup took the username between check and insert.
      return res.status(409).json({ error: "That username is already taken." });
    }

    return res.status(201).json(sessionPayload(inserted.id, sessionToken));
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /auth/pin-login — public. Username + PIN -> session.
router.post("/auth/pin-login", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const normalized =
      typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!normalized || !pin) {
      return res.status(400).json({ error: "Username and PIN are required." });
    }
    // Fast-reject implausibly long input so bcrypt.compare never runs on it.
    if (pin.length > 8) {
      return res.status(401).json({ error: "Invalid username or PIN" });
    }

    const profile = await findByUsername(normalized);
    if (!profile || !profile.pin_hash) {
      return res.status(401).json({ error: "Invalid username or PIN" });
    }

    const valid = await bcrypt.compare(pin, profile.pin_hash);
    if (!valid) return res.status(401).json({ error: "Invalid username or PIN" });

    const sessionToken = crypto.randomUUID();
    await db
      .update(profilesTable)
      .set({ session_token: sessionToken })
      .where(eq(profilesTable.id, profile.id));

    return res.json({ ...sessionPayload(profile.id, sessionToken), role: profile.role });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /pin-accounts/:id/grant-membership — leader promotes a visitor to member.
// Server-enforces the parental-consent gate for under-13s.
router.post(
  "/pin-accounts/:id/grant-membership",
  requireLeaderSession("leader"),
  async (req, res) => {
    try {
      const target = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.id, req.params.id as string),
      });
      if (!target) return res.status(404).json({ error: "Account not found" });

      const consentProvided = (req.body ?? {}).parental_consent === true;
      const gate = canGrantMembership(
        {
          role: target.role,
          age: target.age,
          parent_phone: target.parent_phone,
          parent_name: target.parent_name,
        },
        consentProvided,
      );
      if (!gate.ok) return res.status(400).json({ error: gate.error });

      // For 13+ no consent is required, so the audit columns are explicitly
      // nulled. Safe: the gate above only lets visitors through, so this never
      // clears an existing member's recorded consent.
      const needsConsent = target.age === null || target.age < CONSENT_AGE;
      const [updated] = await db
        .update(profilesTable)
        .set({
          role: "member",
          parental_consent_at: needsConsent ? new Date() : null,
          parental_consent_by: needsConsent ? req.leaderId : null,
        })
        .where(eq(profilesTable.id, target.id))
        .returning();

      return res.json({ success: true, profile: updated });
    } catch (err) {
      req.log.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// POST /pin-accounts/:id/reset-pin — leader resets a kid's PIN to a provided
// or generated value, returned once so the leader can hand it over. Stores
// pin_plain so the dashboard shows the current PIN (product decision).
router.post(
  "/pin-accounts/:id/reset-pin",
  requireLeaderSession("leader"),
  async (req, res) => {
    try {
      const target = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.id, req.params.id as string),
      });
      if (!target) return res.status(404).json({ error: "Account not found" });
      // Scope to PIN accounts (have a username). A promoted member keeps their
      // username, so this still covers them; it just blocks setting a PIN on a
      // Clerk/email-only account that never had one.
      if (!target.username) {
        return res.status(400).json({ error: "This account has no PIN to reset." });
      }

      const provided = (req.body ?? {}).pin;
      let newPin: string;
      if (provided !== undefined) {
        const check = validatePin(provided);
        if (!check.ok) return res.status(400).json({ error: check.error });
        newPin = check.value;
      } else {
        // Generate a non-trivial 4-digit PIN.
        do {
          newPin = String(crypto.randomInt(1000, 10000));
        } while (!validatePin(newPin).ok);
      }

      const pinHash = await bcrypt.hash(newPin, 12);
      await db
        .update(profilesTable)
        .set({ pin_hash: pinHash, pin_plain: newPin, session_token: null })
        .where(eq(profilesTable.id, target.id));

      return res.json({ success: true, pin: newPin });
    } catch (err) {
      req.log.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// PATCH /auth/pin — authenticated account changes its own PIN.
router.patch("/auth/pin", async (req, res) => {
  try {
    const profile = await resolveAccount(req);
    if (!profile) return res.status(401).json({ error: "Unauthorized" });

    const pin = validatePin((req.body ?? {}).pin);
    if (!pin.ok) return res.status(400).json({ error: pin.error });

    const pinHash = await bcrypt.hash(pin.value, 12);
    await db
      .update(profilesTable)
      .set({ pin_hash: pinHash, pin_plain: pin.value })
      .where(eq(profilesTable.id, profile.id));

    return res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /pin-accounts — leader list of username+PIN accounts (visitors & members).
router.get("/pin-accounts", requireLeaderSession("leader"), async (req, res) => {
  try {
    const rows = await db
      .select({
        id: profilesTable.id,
        full_name: profilesTable.full_name,
        username: profilesTable.username,
        pin_plain: profilesTable.pin_plain,
        age: profilesTable.age,
        role: profilesTable.role,
        parent_phone: profilesTable.parent_phone,
        parent_name: profilesTable.parent_name,
      })
      .from(profilesTable)
      .where(isNotNull(profilesTable.username))
      .orderBy(desc(profilesTable.created_at));
    return res.json(rows);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /auth/me — the caller's own minimal profile (Clerk OR PIN session).
router.get("/auth/me", async (req, res) => {
  try {
    const profile = await resolveAccount(req);
    if (!profile) return res.status(401).json({ error: "Unauthorized" });
    return res.json({
      id: profile.id,
      full_name: profile.full_name,
      username: profile.username,
      role: profile.role,
      age: profile.age,
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
