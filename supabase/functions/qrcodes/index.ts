// Supabase Edge Function: qrcodes
// Port of artifacts/api-server/src/routes/qrcodes.ts (every route).
//
// Mirrors the porting conventions established in profiles/attendance/index.ts:
//  - createApp() from ../_shared/router.ts; FULL paths incl /qrcodes segment.
//  - requireLeaderSession("leader") -> requireRole("leader") from ../_shared/auth.ts.
//  - Public routes (GET /qrcodes/public, GET /qrcodes/:slug) stay public.
//  - crypto.randomBytes(n).toString("hex") -> Deno crypto.getRandomValues hex helper.
//  - RegenerateQrCodeBody inlined via npm:zod@3.
//  - req.log.error -> console.error.
//  - exact response shapes/status codes preserved.

import { createApp } from "../_shared/router.ts";
import { db } from "../_shared/db.ts";
import { qrCodesTable } from "../_shared/schema.ts";
import { requireRole } from "../_shared/auth.ts";
import { and, eq } from "npm:drizzle-orm@0.45.2";
import { z } from "npm:zod@3";

const app = createApp();

// ── Inline zod body schemas (ported from @workspace/api-zod) ─────────────────
const RegenerateQrCodeBody = z.object({
  type: z.enum(["public", "leader", "session"]),
});

// ── Local helpers ─────────────────────────────────────────────────────────────

/** Build a hex token from N random bytes (replaces Node crypto.randomBytes(n).toString("hex")). */
function randomHexToken(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getActiveQr(type: "public" | "leader" | "session") {
  return db.query.qrCodesTable.findFirst({
    where: and(eq(qrCodesTable.type, type), eq(qrCodesTable.active, true)),
  });
}

async function ensureDefaultQrCodes() {
  const pub = await getActiveQr("public");
  if (!pub) {
    await db.insert(qrCodesTable).values({
      slug: randomHexToken(6),
      type: "public",
      active: true,
    });
  }
  const leader = await getActiveQr("leader");
  if (!leader) {
    await db.insert(qrCodesTable).values({
      slug: randomHexToken(6),
      type: "leader",
      active: true,
    });
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

app.get("/qrcodes/public", async (c) => {
  try {
    await ensureDefaultQrCodes();
    const qr = await getActiveQr("public");
    return c.json(qr);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.get("/qrcodes/leader", requireRole("leader"), async (c) => {
  try {
    await ensureDefaultQrCodes();
    const qr = await getActiveQr("leader");
    return c.json(qr);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /qrcodes/session — generates a fresh per-session QR code for check-in
// Called by the leader dashboard "Generate Session QR" button.
app.post("/qrcodes/session", requireRole("leader"), async (c) => {
  try {
    // Deactivate any existing session QR codes
    await db
      .update(qrCodesTable)
      .set({ active: false })
      .where(and(eq(qrCodesTable.type, "session"), eq(qrCodesTable.active, true)));

    // Create a fresh session QR
    const slug = randomHexToken(8);
    const [newQr] = await db
      .insert(qrCodesTable)
      .values({
        slug,
        type: "session",
        active: true,
      })
      .returning();

    return c.json({ slug: newQr.slug, type: newQr.type });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.post("/qrcodes/regenerate", requireRole("leader"), async (c) => {
  try {
    const body = await c.req.json();
    const parsed = RegenerateQrCodeBody.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const { type } = parsed.data;
    await db
      .update(qrCodesTable)
      .set({ active: false })
      .where(and(eq(qrCodesTable.type, type), eq(qrCodesTable.active, true)));
    const [newQr] = await db
      .insert(qrCodesTable)
      .values({
        slug: randomHexToken(6),
        type,
        active: true,
      })
      .returning();
    return c.json(newQr);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.get("/qrcodes/:slug", async (c) => {
  try {
    const slug = c.req.param("slug");
    const qr = await db.query.qrCodesTable.findFirst({
      where: and(
        eq(qrCodesTable.slug, slug),
        eq(qrCodesTable.active, true),
      ),
    });
    if (!qr) {
      return c.json({ error: "QR code not found or expired" }, 404);
    }
    const redirect_to = qr.type === "public" ? "/register" : "/leader-login";
    return c.json({ slug: qr.slug, type: qr.type, redirect_to });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

Deno.serve(app.fetch);
