import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db, qrCodesTable } from "@workspace/db";
import { RegenerateQrCodeBody } from "@workspace/api-zod";
import { requireLeaderSession } from "../middlewares/requireLeaderSession";

const router = Router();

async function getActiveQr(type: "public" | "leader" | "session") {
  return db.query.qrCodesTable.findFirst({
    where: and(eq(qrCodesTable.type, type), eq(qrCodesTable.active, true)),
  });
}

async function ensureDefaultQrCodes() {
  const pub = await getActiveQr("public");
  if (!pub) {
    await db.insert(qrCodesTable).values({
      slug: randomBytes(6).toString("hex"),
      type: "public",
      active: true,
    });
  }
  const leader = await getActiveQr("leader");
  if (!leader) {
    await db.insert(qrCodesTable).values({
      slug: randomBytes(6).toString("hex"),
      type: "leader",
      active: true,
    });
  }
}

router.get("/qrcodes/public", async (req, res) => {
  try {
    await ensureDefaultQrCodes();
    const qr = await getActiveQr("public");
    return res.json(qr);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/qrcodes/leader", requireLeaderSession("leader"), async (req, res) => {
  try {
    await ensureDefaultQrCodes();
    const qr = await getActiveQr("leader");
    return res.json(qr);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /qrcodes/session — generates a fresh per-session QR code for check-in
// Called by the leader dashboard "Generate Session QR" button.
router.post("/qrcodes/session", requireLeaderSession("leader"), async (req, res) => {
  try {
    // Deactivate any existing session QR codes
    await db
      .update(qrCodesTable)
      .set({ active: false })
      .where(and(eq(qrCodesTable.type, "session"), eq(qrCodesTable.active, true)));

    // Create a fresh session QR
    const slug = randomBytes(8).toString("hex");
    const [newQr] = await db
      .insert(qrCodesTable)
      .values({
        slug,
        type: "session",
        active: true,
      })
      .returning();

    return res.json({ slug: newQr.slug, type: newQr.type });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/qrcodes/regenerate", requireLeaderSession("leader"), async (req, res) => {
  try {
    const parsed = RegenerateQrCodeBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { type } = parsed.data;
    await db
      .update(qrCodesTable)
      .set({ active: false })
      .where(and(eq(qrCodesTable.type, type), eq(qrCodesTable.active, true)));
    const [newQr] = await db
      .insert(qrCodesTable)
      .values({
        slug: randomBytes(6).toString("hex"),
        type,
        active: true,
      })
      .returning();
    return res.json(newQr);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/qrcodes/:slug", async (req, res) => {
  try {
    const qr = await db.query.qrCodesTable.findFirst({
      where: and(
        eq(qrCodesTable.slug, req.params.slug),
        eq(qrCodesTable.active, true),
      ),
    });
    if (!qr) {
      return res.status(404).json({ error: "QR code not found or expired" });
    }
    const redirect_to = qr.type === "public" ? "/register" : "/leader-login";
    return res.json({ slug: qr.slug, type: qr.type, redirect_to });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
