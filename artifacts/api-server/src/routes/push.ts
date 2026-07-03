import { Router, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { resolveAccount } from "../lib/resolveAccount";
import { isPushConfigured, sendPushToProfiles } from "../lib/pushSender";

const router = Router();

// GET /push/public-key — VAPID public key the browser needs to subscribe (public).
router.get("/push/public-key", (_req: Request, res: Response) => {
  if (!isPushConfigured()) {
    return res.status(503).json({ error: "Push notifications not configured" });
  }
  return res.json({ public_key: process.env.VAPID_PUBLIC_KEY });
});

// POST /push/subscribe — store this browser's push subscription (member-facing;
// accepts Clerk and username+PIN accounts alike).
router.post("/push/subscribe", async (req: Request, res: Response) => {
  try {
    const profile = await resolveAccount(req);
    if (!profile) return res.status(401).json({ error: "Not signed in" });

    const body = req.body as {
      endpoint?: unknown;
      keys?: { p256dh?: unknown; auth?: unknown };
    };
    if (
      typeof body?.endpoint !== "string" ||
      body.endpoint.length === 0 ||
      typeof body?.keys?.p256dh !== "string" ||
      typeof body?.keys?.auth !== "string"
    ) {
      return res.status(400).json({ error: "Invalid push subscription" });
    }

    // Same device re-subscribing (or a device changing owners) updates in place.
    await db
      .insert(pushSubscriptionsTable)
      .values({
        profile_id: profile.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        user_agent: req.headers["user-agent"] ?? null,
      })
      .onConflictDoUpdate({
        target: pushSubscriptionsTable.endpoint,
        set: {
          profile_id: profile.id,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
        },
      });
    return res.status(201).json({ ok: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /push/unsubscribe — remove this browser's subscription.
router.post("/push/unsubscribe", async (req: Request, res: Response) => {
  try {
    const profile = await resolveAccount(req);
    if (!profile) return res.status(401).json({ error: "Not signed in" });

    const endpoint = (req.body as { endpoint?: unknown })?.endpoint;
    if (typeof endpoint !== "string" || endpoint.length === 0) {
      return res.status(400).json({ error: "endpoint required" });
    }
    await db
      .delete(pushSubscriptionsTable)
      .where(
        and(
          eq(pushSubscriptionsTable.endpoint, endpoint),
          eq(pushSubscriptionsTable.profile_id, profile.id),
        ),
      );
    return res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /push/test — push "it works" to the caller's own devices (verification).
router.post("/push/test", async (req: Request, res: Response) => {
  try {
    const profile = await resolveAccount(req);
    if (!profile) return res.status(401).json({ error: "Not signed in" });

    const sent = await sendPushToProfiles([profile.id], {
      title: "JG Youth",
      body: "🎉 Notifications are working!",
      url: "/my",
    });
    return res.json({ sent });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
