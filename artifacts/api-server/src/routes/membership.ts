import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, membershipRequestsTable, profilesTable } from "@workspace/db";
import { CreateMembershipRequestBody } from "@workspace/api-zod";
import { sendEmail } from "../lib/twilio";

const router = Router();

router.get("/membership-requests", async (req, res) => {
  try {
    const auth = getAuth(req);
    const hasLeaderSess = (() => {
      try {
        const h = req.headers["x-leader-session"];
        if (!h) return false;
        const s = JSON.parse(h as string);
        return typeof s?.expires_at === "number" && Date.now() < s.expires_at;
      } catch { return false; }
    })();
    if (!auth?.userId && !hasLeaderSess) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const requests = await db
      .select({
        id: membershipRequestsTable.id,
        profile_id: membershipRequestsTable.profile_id,
        reason: membershipRequestsTable.reason,
        status: membershipRequestsTable.status,
        reviewed_by: membershipRequestsTable.reviewed_by,
        created_at: membershipRequestsTable.created_at,
        profile: {
          id: profilesTable.id,
          full_name: profilesTable.full_name,
          role: profilesTable.role,
          phone: profilesTable.phone,
          email: profilesTable.email,
          gender: profilesTable.gender,
          age: profilesTable.age,
          heard_from: profilesTable.heard_from,
          clerk_id: profilesTable.clerk_id,
          created_at: profilesTable.created_at,
        },
      })
      .from(membershipRequestsTable)
      .leftJoin(profilesTable, eq(membershipRequestsTable.profile_id, profilesTable.id))
      .where(status ? eq(membershipRequestsTable.status, status as any) : undefined);
    return res.json(requests);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/membership-requests", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const parsed = CreateMembershipRequestBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, auth.userId),
    });
    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }
    const [request] = await db
      .insert(membershipRequestsTable)
      .values({
        profile_id: profile.id,
        reason: parsed.data.reason,
        status: "pending",
      })
      .returning();
    return res.status(201).json({ ...request, profile });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/membership-requests/:id/approve", async (req, res) => {
  try {
    const auth = getAuth(req);
    const hasLeaderSess = (() => {
      try {
        const h = req.headers["x-leader-session"];
        if (!h) return false;
        const s = JSON.parse(h as string);
        return typeof s?.expires_at === "number" && Date.now() < s.expires_at;
      } catch { return false; }
    })();
    if (!auth?.userId && !hasLeaderSess) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    let reviewerProfile: any = null;
    if (auth?.userId) {
      reviewerProfile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.clerk_id, auth.userId),
      });
    } else {
      const s = JSON.parse(req.headers["x-leader-session"] as string);
      reviewerProfile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.id, s.profile_id),
      });
    }
    const [updated] = await db
      .update(membershipRequestsTable)
      .set({ status: "approved", reviewed_by: reviewerProfile?.id ?? null })
      .where(eq(membershipRequestsTable.id, req.params.id))
      .returning();
    if (!updated) {
      return res.status(404).json({ error: "Request not found" });
    }
    await db
      .update(profilesTable)
      .set({ role: "member" })
      .where(eq(profilesTable.id, updated.profile_id));

    // Notify member via email using Twilio
    const member = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, updated.profile_id),
    });
    if (member?.email) {
      // If they don't have a Clerk account yet, include the sign-up link in the email
      const hasClerkAccount = !!member.clerk_id;
      const signUpUrl = `${process.env.FRONTEND_URL ?? "https://youth-connect-tau.vercel.app"}/sign-up`;
      const ctaText = hasClerkAccount
        ? "Log in to see upcoming events, RSVP, and check in on Fridays."
        : `Create your login account to access all member features: ${signUpUrl}`;
      const ctaHtml = hasClerkAccount
        ? `<p>Log in to see upcoming events, RSVP, and check in on Fridays.</p>`
        : `<p><a href="${signUpUrl}" style="background:#2A9D8F;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;margin-top:8px">Create Your Login Account</a></p><p style="font-size:12px;color:#888;margin-top:4px">Or copy this link: ${signUpUrl}</p>`;
      await sendEmail({
        to: member.email,
        subject: "Your membership has been approved — Jeremiah Generation Youth",
        text: `Hi ${member.full_name},\n\nGreat news! Your membership request has been approved. Welcome to Jeremiah Generation Youth!\n\n${ctaText}\n\nSee you at the next session,\nJeremiah Generation Youth`,
        html: `<p>Hi <strong>${member.full_name}</strong>,</p><p>Great news! Your membership request has been <strong>approved</strong>. Welcome to Jeremiah Generation Youth!</p>${ctaHtml}<p>See you at the next session,<br/>Jeremiah Generation Youth</p>`,
      });
    }

    return res.json({ ...updated, profile: member ?? null });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/membership-requests/:id/reject", async (req, res) => {
  try {
    const auth = getAuth(req);
    const hasLeaderSess = (() => {
      try {
        const h = req.headers["x-leader-session"];
        if (!h) return false;
        const s = JSON.parse(h as string);
        return typeof s?.expires_at === "number" && Date.now() < s.expires_at;
      } catch { return false; }
    })();
    if (!auth?.userId && !hasLeaderSess) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    let reviewerProfile: any = null;
    if (auth?.userId) {
      reviewerProfile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.clerk_id, auth.userId),
      });
    } else {
      const s = JSON.parse(req.headers["x-leader-session"] as string);
      reviewerProfile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.id, s.profile_id),
      });
    }
    const [updated] = await db
      .update(membershipRequestsTable)
      .set({ status: "rejected", reviewed_by: reviewerProfile?.id ?? null })
      .where(eq(membershipRequestsTable.id, req.params.id))
      .returning();
    if (!updated) {
      return res.status(404).json({ error: "Request not found" });
    }

    // Notify member via email using Twilio
    const member = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, updated.profile_id),
    });
    if (member?.email) {
      await sendEmail({
        to: member.email,
        subject: "Your membership request — Jeremiah Generation Youth",
        text: `Hi ${member.full_name},\n\nThank you for your interest in joining Jeremiah Generation Youth. After review, your membership request was not approved at this time.\n\nPlease reach out to a leader if you have any questions.\n\nJeremiah Generation Youth`,
        html: `<p>Hi <strong>${member.full_name}</strong>,</p><p>Thank you for your interest in joining Jeremiah Generation Youth. After review, your membership request was not approved at this time.</p><p>Please reach out to a leader if you have any questions.</p><p>Jeremiah Generation Youth</p>`,
      });
    }

    return res.json({ ...updated, profile: member ?? null });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
