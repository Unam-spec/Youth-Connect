// Public first-timer registration (port of artifacts/api-server/src/routes/register.ts).
// POST /register — no auth. Inserts a visitor + a pending check-in request.
import { createApp } from "../_shared/router.ts";
import { db } from "../_shared/db.ts";
import { visitorsTable, checkInRequestsTable } from "../_shared/schema.ts";

const app = createApp();

app.post("/register", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const { full_name, phone_number, email, gender, age, how_did_you_hear, school, parent_phone, parent_name, whatsapp_opt_in } =
      body as Record<string, unknown>;

    if (!full_name || typeof full_name !== "string" || !full_name.trim()) {
      return c.json({ error: "full_name is required" }, 400);
    }
    if (!phone_number || typeof phone_number !== "string" || !phone_number.trim()) {
      return c.json({ error: "phone_number is required" }, 400);
    }
    if (!gender || !["male", "female", "other"].includes(gender as string)) {
      return c.json({ error: "gender is required and must be male, female, or other" }, 400);
    }
    if (age === undefined || age === null || age === "") {
      return c.json({ error: "age is required" }, 400);
    }
    if (!how_did_you_hear || typeof how_did_you_hear !== "string" || !how_did_you_hear.trim()) {
      return c.json({ error: "how_did_you_hear is required" }, 400);
    }

    const ageInt = parseInt(String(age), 10);
    if (isNaN(ageInt) || ageInt < 1 || ageInt > 120) {
      return c.json({ error: "age must be a valid number between 1 and 120" }, 400);
    }

    const emailValue = !email || (typeof email === "string" && email.trim() === "") ? null : String(email).trim();
    const today = new Date().toISOString().split("T")[0] as string;

    const [visitor] = await db
      .insert(visitorsTable)
      .values({
        full_name: full_name.trim(),
        phone_number: phone_number.trim(),
        email: emailValue,
        gender: gender as "male" | "female" | "other",
        age: ageInt,
        how_did_you_hear: how_did_you_hear.trim(),
        school: typeof school === "string" && school.trim() ? school.trim() : null,
        parent_phone: typeof parent_phone === "string" && parent_phone.trim() ? parent_phone.trim() : null,
        parent_name: typeof parent_name === "string" && parent_name.trim() ? parent_name.trim() : null,
        whatsapp_opt_in: !!whatsapp_opt_in,
        session_date: today,
        status: "pending",
      })
      .returning();

    await db.insert(checkInRequestsTable).values({
      visitor_id: visitor.id,
      type: "visitor",
      session_date: today,
      status: "pending",
    });

    return c.json({ success: true, visitor }, 201);
  } catch (err) {
    console.error("[register] error:", err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

Deno.serve(app.fetch);
