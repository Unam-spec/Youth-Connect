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
    if (!auth?.userId) {
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
    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const reviewerProfile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, auth.userId),
    });
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
      await sendEmail({
        to: member.email,
        subject: "Your membership has been approved — Jeremiah Generation Youth",
        text: `Hi ${member.full_name},\n\nGreat news! Your membership request has been approved. Welcome to Jeremiah Generation Youth!\n\nYou can now log in and access all member features.\n\nSee you at the next session,\nJeremiah Generation Youth`,
        html: `<p>Hi <strong>${member.full_name}</strong>,</p><p>Great news! Your membership request has been <strong>approved</strong>. Welcome to Jeremiah Generation Youth!</p><p>You can now log in and access all member features.</p><p>See you at the next session,<br/>Jeremiah Generation Youth</p>`,
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
    if (!auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const reviewerProfile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, auth.userId),
    });
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
