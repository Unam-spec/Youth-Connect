// Supabase Edge Function: pin-accounts
// Port of the /pin-accounts/* leader routes from
// artifacts/api-server/src/routes/pinAccounts.ts.
//   - POST /pin-accounts/:id/grant-membership → requireRole("leader"), consent-gated
//   - POST /pin-accounts/:id/reset-pin        → requireRole("leader")
import { createApp } from "../_shared/router.ts";
import { db } from "../_shared/db.ts";
import { profilesTable } from "../_shared/schema.ts";
import { requireRole } from "../_shared/auth.ts";
import { canGrantMembership, CONSENT_AGE } from "../_shared/membershipConsent.ts";
import { validatePin } from "../_shared/pin.ts";
import { eq, isNotNull, desc } from "npm:drizzle-orm@0.45.2";
import bcrypt from "npm:bcryptjs@2";

const app = createApp();

/** Crypto-random integer in [min, max) (Deno has no node crypto.randomInt). */
function randomInt(min: number, max: number): number {
  const range = max - min;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return min + (buf[0] % range);
}

// POST /pin-accounts/:id/grant-membership — leader promotes a visitor to member.
// Server-enforces the parental-consent gate for under-13s.
app.post("/pin-accounts/:id/grant-membership", requireRole("leader"), async (c) => {
  try {
    const id = c.req.param("id");
    const target = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, id),
    });
    if (!target) return c.json({ error: "Account not found" }, 404);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const consentProvided = body.parental_consent === true;
    // Effective parent info: a non-blank value in the request overrides the
    // stored one (lets the under-13 promote dialog supply it in one call).
    const parentName =
      typeof body.parent_name === "string" && body.parent_name.trim()
        ? body.parent_name.trim()
        : target.parent_name;
    const parentPhone =
      typeof body.parent_phone === "string" && body.parent_phone.trim()
        ? body.parent_phone.trim()
        : target.parent_phone;

    const gate = canGrantMembership(
      {
        role: target.role,
        age: target.age,
        parent_phone: parentPhone,
        parent_name: parentName,
      },
      consentProvided,
    );
    if (!gate.ok) return c.json({ error: gate.error }, 400);

    // For 13+ no consent is required, so the audit columns are explicitly
    // nulled. Safe: the gate above only lets visitors through, so this never
    // clears an existing member's recorded consent.
    const needsConsent = target.age === null || target.age < CONSENT_AGE;
    const leaderId = c.get("leaderId") as string;
    const [updated] = await db
      .update(profilesTable)
      .set({
        role: "member",
        parent_name: parentName,
        parent_phone: parentPhone,
        parental_consent_at: needsConsent ? new Date() : null,
        parental_consent_by: needsConsent ? leaderId : null,
      })
      .where(eq(profilesTable.id, target.id))
      .returning();

    return c.json({ success: true, profile: updated });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /pin-accounts/:id/reset-pin — leader resets a kid's PIN to a provided
// or generated value, returned once so the leader can hand it over. Stores
// pin_plain so the dashboard shows the current PIN (product decision).
app.post("/pin-accounts/:id/reset-pin", requireRole("leader"), async (c) => {
  try {
    const id = c.req.param("id");
    const target = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, id),
    });
    if (!target) return c.json({ error: "Account not found" }, 404);
    // Scope to PIN accounts (have a username). A promoted member keeps their
    // username, so this still covers them; it just blocks setting a PIN on a
    // Clerk/email-only account that never had one.
    if (!target.username) {
      return c.json({ error: "This account has no PIN to reset." }, 400);
    }

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const provided = body.pin;
    let newPin: string;
    if (provided !== undefined) {
      const check = validatePin(provided);
      if (!check.ok) return c.json({ error: check.error }, 400);
      newPin = check.value;
    } else {
      // Generate a non-trivial 4-digit PIN.
      do {
        newPin = String(randomInt(1000, 10000));
      } while (!validatePin(newPin).ok);
    }

    const pinHash = await bcrypt.hash(newPin, 12);
    await db
      .update(profilesTable)
      .set({ pin_hash: pinHash, pin_plain: newPin, session_token: null })
      .where(eq(profilesTable.id, target.id));

    return c.json({ success: true, pin: newPin });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /pin-accounts — leader list of username+PIN accounts (visitors & members).
app.get("/pin-accounts", requireRole("leader"), async (c) => {
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
    return c.json(rows);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

Deno.serve(app.fetch);
