import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db, qrCodesTable } from "@workspace/db";
import { RegenerateQrCodeBody } from "@workspace/api-zod";

const router = Router();

async function getActiveQr(type: "public" | "leader" | "session") {
  return db.query.qrCodesTable.findFirst({
    where: and(eq(qrCodesTable.type, type as any), eq(qrCodesTable.active, true)),
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

router.get("/qrcodes/leader", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
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
router.post("/qrcodes/session", async (req, res) => {
  try {
    // Allow both Clerk JWT and leader-session header auth
    const auth = getAuth(req);
    const leaderSessionHeader = req.headers["x-leader-session"];
    let isAuthorized = !!auth?.userId;

    if (!isAuthorized && leaderSessionHeader) {
      try {
        const session = JSON.parse(leaderSessionHeader as string);
        if (session?.expires_at && Date.now() < session.expires_at) {
          isAuthorized = true;
        }
      } catch {
        // ignore malformed header
      }
    }

    if (!isAuthorized) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Deactivate any existing session QR codes
    await db
      .update(qrCodesTable)
      .set({ active: false })
      .where(and(eq(qrCodesTable.type, "session" as any), eq(qrCodesTable.active, true)));

    // Create a fresh session QR
    const slug = randomBytes(8).toString("hex");
    const [newQr] = await db
      .insert(qrCodesTable)
      .values({
        slug,
        type: "session" as any,
        active: true,
      })
      .returning();

    return res.json({ slug: newQr.slug, type: newQr.type });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/qrcodes/regenerate", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
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
