import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, membershipRequestsTable, profilesTable, pendingEmailsTable } from "@workspace/db";
import { CreateMembershipRequestBody } from "@workspace/api-zod";
import { requireLeaderSession } from "../middlewares/requireLeaderSession";
import { notifyLeadersOfMembershipRequest } from "../lib/notifyLeadersOfMembershipRequest";

const router = Router();

// GET /membership-requests - List all membership requests (protected: leader)
router.get("/membership-requests", requireLeaderSession("leader"), async (req, res) => {
  try {
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

// POST /membership-requests - Create a new membership request (Clerk-auth member)
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

    await notifyLeadersOfMembershipRequest(profile.full_name, parsed.data.reason);

    return res.status(201).json({ ...request, profile });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /membership-requests/:id/approve - Approve membership request (protected: leader)
router.post("/membership-requests/:id/approve", requireLeaderSession("leader"), async (req, res) => {
  try {
    const [updated] = await db
      .update(membershipRequestsTable)
      .set({ status: "approved", reviewed_by: req.leaderId! })
      .where(eq(membershipRequestsTable.id, req.params.id as string))
      .returning();
    if (!updated) {
      return res.status(404).json({ error: "Request not found" });
    }
    await db
      .update(profilesTable)
      .set({ role: "member" })
      .where(eq(profilesTable.id, updated.profile_id));

    // Notify member via email using queued pending_emails table
    const member = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, updated.profile_id),
    });
    if (member?.email) {
      const hasClerkAccount = !!member.clerk_id;
      const signUpUrl = `${process.env.FRONTEND_URL ?? "https://youth-connect-tau.vercel.app"}/sign-up`;
      const ctaHtml = hasClerkAccount
        ? `<p>Log in to see upcoming events, RSVP, and check in on Fridays.</p>`
        : `<p><a href="${signUpUrl}" style="background:#2A9D8F;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;margin-top:8px">Create Your Login</a></p><p style="font-size:12px;color:#888;margin-top:4px">Or copy this link: ${signUpUrl}</p>`;

      const emailBody = `
        <div style="font-family: 'Inter', sans-serif; background-color: #0B0F14; color: #E6E8EB; padding: 24px; border-radius: 8px;">
          <h2 style="color: #2A9D8F; font-family: 'Sora', sans-serif;">Membership Approved!</h2>
          <p>Hi <strong>${member.full_name}</strong>,</p>
          <p>Great news! Your membership request has been <strong>approved</strong>. Welcome to Jeremiah Generation Youth!</p>
          ${ctaHtml}
          <p style="margin-top: 24px; font-weight: bold;">See you at the next session,</p>
          <p style="color: #2A9D8F; font-weight: bold;">Jeremiah Generation Youth Team</p>
        </div>
      `;

      await db.insert(pendingEmailsTable).values({
        to_address: member.email,
        subject: "Your membership has been approved — Jeremiah Generation Youth",
        body_html: emailBody,
      });
    }

    return res.json({ ...updated, profile: member ?? null });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /membership-requests/:id/reject - Reject membership request (protected: leader)
router.post("/membership-requests/:id/reject", requireLeaderSession("leader"), async (req, res) => {
  try {
    const [updated] = await db
      .update(membershipRequestsTable)
      .set({ status: "rejected", reviewed_by: req.leaderId! })
      .where(eq(membershipRequestsTable.id, req.params.id as string))
      .returning();
    if (!updated) {
      return res.status(404).json({ error: "Request not found" });
    }

    // Notify member via email using queued pending_emails table
    const member = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, updated.profile_id),
    });
    if (member?.email) {
      const emailBody = `
        <div style="font-family: 'Inter', sans-serif; background-color: #0B0F14; color: #E6E8EB; padding: 24px; border-radius: 8px;">
          <h2 style="color: #E63946; font-family: 'Sora', sans-serif;">Membership Update</h2>
          <p>Hi <strong>${member.full_name}</strong>,</p>
          <p>Thank you for your interest in joining Jeremiah Generation Youth. After review, your membership request was not approved at this time.</p>
          <p>Please reach out to a leader if you have any questions.</p>
          <p style="margin-top: 24px; font-weight: bold; color: #2A9D8F;">Jeremiah Generation Youth Team</p>
        </div>
      `;

      await db.insert(pendingEmailsTable).values({
        to_address: member.email,
        subject: "Your membership request — Jeremiah Generation Youth",
        body_html: emailBody,
      });
    }

    return res.json({ ...updated, profile: member ?? null });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
