// Supabase Edge Function: auth
// Port of the /auth/* routes from artifacts/api-server/src/routes/pinAccounts.ts.
//   - POST /auth/pin-signup   → public (creates a visitor account, auto-logs-in)
//   - POST /auth/pin-login    → public (username + PIN → session)
//   - PATCH /auth/pin         → self (resolveAuth: Clerk or PIN session)
import { createApp } from "../_shared/router.ts";
import { db } from "../_shared/db.ts";
import { profilesTable } from "../_shared/schema.ts";
import { resolveAuth } from "../_shared/auth.ts";
import { validateUsername } from "../_shared/username.ts";
import { validatePin } from "../_shared/pin.ts";
import { eq, sql } from "npm:drizzle-orm@0.45.2";
import bcrypt from "npm:bcryptjs@2";

const app = createApp();

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
function findByUsername(normalized: string) {
  return db.query.profilesTable.findFirst({
    where: sql`lower(btrim(${profilesTable.username})) = ${normalized}`,
  });
}

// POST /auth/pin-signup — public. Creates a visitor account and auto-logs-in.
app.post("/auth/pin-signup", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
    if (!fullName) return c.json({ error: "full_name is required" }, 400);

    const uname = validateUsername(body.username);
    if (!uname.ok) return c.json({ error: uname.error }, 400);

    const pin = validatePin(body.pin);
    if (!pin.ok) return c.json({ error: pin.error }, 400);

    const ageRaw = body.age;
    const age =
      ageRaw === undefined || ageRaw === null || ageRaw === ""
        ? null
        : parseInt(String(ageRaw), 10);
    if (age !== null && (Number.isNaN(age) || age < 1 || age > 120)) {
      return c.json({ error: "age must be a valid number between 1 and 120" }, 400);
    }

    const existing = await findByUsername(uname.value);
    if (existing) return c.json({ error: "That username is already taken." }, 409);

    const pinHash = await bcrypt.hash(pin.value, 12);
    const sessionToken = crypto.randomUUID();

    try {
      const [inserted] = await db
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
      return c.json(sessionPayload(inserted.id, sessionToken), 201);
    } catch (_e) {
      // Unique-index race: another signup took the username between check and insert.
      return c.json({ error: "That username is already taken." }, 409);
    }
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /auth/pin-login — public. Username + PIN -> session.
app.post("/auth/pin-login", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const normalized =
      typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!normalized || !pin) {
      return c.json({ error: "Username and PIN are required." }, 400);
    }
    // Fast-reject implausibly long input so bcrypt.compare never runs on it.
    if (pin.length > 8) {
      return c.json({ error: "Invalid username or PIN" }, 401);
    }

    const profile = await findByUsername(normalized);
    if (!profile || !profile.pin_hash) {
      return c.json({ error: "Invalid username or PIN" }, 401);
    }

    const valid = await bcrypt.compare(pin, profile.pin_hash);
    if (!valid) return c.json({ error: "Invalid username or PIN" }, 401);

    const sessionToken = crypto.randomUUID();
    await db
      .update(profilesTable)
      .set({ session_token: sessionToken })
      .where(eq(profilesTable.id, profile.id));

    return c.json({ ...sessionPayload(profile.id, sessionToken), role: profile.role });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// PATCH /auth/pin — authenticated account changes its own PIN.
app.patch("/auth/pin", async (c) => {
  try {
    const auth = await resolveAuth(c.req.raw);
    if (!auth) return c.json({ error: "Unauthorized" }, 401);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const pin = validatePin(body.pin);
    if (!pin.ok) return c.json({ error: pin.error }, 400);

    const pinHash = await bcrypt.hash(pin.value, 12);
    await db
      .update(profilesTable)
      .set({ pin_hash: pinHash, pin_plain: pin.value })
      .where(eq(profilesTable.id, auth.profile.id));

    return c.json({ success: true });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /auth/me — the caller's own minimal profile (Clerk OR PIN session).
app.get("/auth/me", async (c) => {
  try {
    const auth = await resolveAuth(c.req.raw);
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    const p = auth.profile;
    return c.json({
      id: p.id,
      full_name: p.full_name,
      username: p.username,
      role: p.role,
      age: p.age,
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

Deno.serve(app.fetch);
