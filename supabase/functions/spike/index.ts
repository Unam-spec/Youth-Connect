import { Hono } from "npm:hono@4";
import postgres from "npm:postgres@3";
import { drizzle } from "npm:drizzle-orm@0.45.2/postgres-js";
import { eq } from "npm:drizzle-orm@0.45.2";
import bcrypt from "npm:bcryptjs@2";
import { verifyToken } from "npm:@clerk/backend@1";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { pgTable, text, uuid } from "npm:drizzle-orm@0.45.2/pg-core";

// Minimal profiles subset for the Phase-0 spike (self-contained).
const profilesTable = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  pin_hash: text("pin_hash"),
  role: text("role"),
});

const app = new Hono();
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });
const db = drizzle(sql);

app.get("/spike/db", async (c) => {
  const rows = await db
    .select({ id: profilesTable.id, role: profilesTable.role })
    .from(profilesTable)
    .limit(3);
  return c.json({ ok: true, count: rows.length });
});

app.get("/spike/bcrypt", async (c) => {
  const [p] = await db
    .select({ pin: profilesTable.pin_hash })
    .from(profilesTable)
    .where(eq(profilesTable.role, "super_admin"))
    .limit(1);
  if (!p?.pin) return c.json({ ok: false, reason: "no pin hash found" });
  const looksBcrypt = p.pin.startsWith("$2");
  const wrong = await bcrypt.compare("000000", p.pin); // must not throw; expected false
  return c.json({ ok: looksBcrypt, looksBcrypt, comparedWithoutThrow: typeof wrong === "boolean" });
});

app.get("/spike/clerk", async (c) => {
  const token = (c.req.header("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return c.json({ ok: false, reason: "no token" });
  try {
    const payload = await verifyToken(token, { secretKey: Deno.env.get("CLERK_SECRET_KEY")! });
    return c.json({ ok: true, sub: payload.sub });
  } catch (e) {
    return c.json({ ok: false, reason: String(e) });
  }
});

app.get("/spike/email", async (c) => {
  try {
    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: {
          username: Deno.env.get("GMAIL_USER")!,
          password: Deno.env.get("GMAIL_APP_PASSWORD")!,
        },
      },
    });
    await client.send({
      from: `${Deno.env.get("EMAIL_FROM_NAME") ?? "JG Youth"} <${Deno.env.get("GMAIL_USER")}>`,
      to: Deno.env.get("GMAIL_USER")!,
      subject: "Supabase Edge spike test",
      content: "If you received this, denomailer + Gmail works on Deno.",
    });
    await client.close();
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ ok: false, reason: String(e) });
  }
});

Deno.serve(app.fetch);
