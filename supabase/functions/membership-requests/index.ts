// Supabase Edge Function: membership-requests
// Port of artifacts/api-server/src/routes/membership.ts (every route).
//
// Mirrors the porting conventions established in profiles/attendance/index.ts:
//  - createApp() from ../_shared/router.ts; FULL paths incl /membership-requests segment.
//  - requireLeaderSession("leader") -> requireRole("leader"); req.leaderId -> c.get("leaderId").
//  - getAuth(req).userId -> await getClerkUserId(c.req.raw).
//  - req.log.error -> console.error.
//  - zod -> npm:zod@3 (inline, mirroring api-zod CreateMembershipRequestBody).
//  - notifyLeadersOfMembershipRequest ported inline (queues into pending_emails).
//  - exact response shapes/status codes + email HTML templates preserved.

import { createApp } from "../_shared/router.ts";
import { db } from "../_shared/db.ts";
import {
  membershipRequestsTable,
  profilesTable,
  pendingEmailsTable,
} from "../_shared/schema.ts";
import { getClerkUserId, requireRole } from "../_shared/auth.ts";
import { eq, inArray } from "npm:drizzle-orm@0.45.2";
import { z } from "npm:zod@3";

const app = createApp();

// ── Inline zod body schemas (ported from @workspace/api-zod) ─────────────────
const CreateMembershipRequestBody = z.object({
  reason: z.string(),
});

// ── Local helpers (ported from api-server/src/lib) ───────────────────────────

/** Mirrors lib/notifyLeadersOfMembershipRequest.ts — queues into pending_emails. */
async function notifyLeadersOfMembershipRequest(
  requesterName: string,
  reason: string,
): Promise<void> {
  const recipients = await db
    .select({ email: profilesTable.email })
    .from(profilesTable)
    .where(inArray(profilesTable.role, ["leader", "super_admin"]));

  const dashboardUrl =
    (Deno.env.get("FRONTEND_URL") ?? "https://youth-connect-tau.vercel.app") +
    "/dashboard";

  const rows = recipients
    .map((r) => r.email)
    .filter((email): email is string => !!email && email.trim().length > 0)
    .map((email) => ({
      to_address: email,
      subject: "New membership request — Jeremiah Generation Youth",
      body_html: `
        <div style="font-family: 'Inter', sans-serif; background-color: #0B0F14; color: #E6E8EB; padding: 24px; border-radius: 8px;">
          <h2 style="color: #2A9D8F; font-family: 'Sora', sans-serif;">New Membership Request</h2>
          <p><strong>${requesterName}</strong> has requested to become a member.</p>
          <p style="background-color: rgba(255,255,255,0.05); padding: 12px; border-radius: 6px;"><em>${reason}</em></p>
          <p>Review and approve or decline it in the leader dashboard.</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${dashboardUrl}" style="background-color:#2A9D8F;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">Open Dashboard</a>
          </div>
        </div>
      `,
    }));

  if (rows.length > 0) {
    await db.insert(pendingEmailsTable).values(rows);
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /membership-requests - List all membership requests (protected: leader)
app.get("/membership-requests", requireRole("leader"), async (c) => {
  try {
    const status = c.req.query("status");
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
      .leftJoin(
        profilesTable,
        eq(membershipRequestsTable.profile_id, profilesTable.id),
      )
      .where(
        status ? eq(membershipRequestsTable.status, status as any) : undefined,
      );
    return c.json(requests);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /membership-requests - Create a new membership request (Clerk-auth member)
app.post("/membership-requests", async (c) => {
  try {
    const userId = await getClerkUserId(c.req.raw);
    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const body = await c.req.json();
    const parsed = CreateMembershipRequestBody.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, userId),
    });
    if (!profile) {
      return c.json({ error: "Profile not found" }, 404);
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

    return c.json({ ...request, profile }, 201);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /membership-requests/:id/approve - Approve membership request (protected: leader)
app.post("/membership-requests/:id/approve", requireRole("leader"), async (c) => {
  try {
    const leaderId = c.get("leaderId") as string;
    const id = c.req.param("id");
    const [updated] = await db
      .update(membershipRequestsTable)
      .set({ status: "approved", reviewed_by: leaderId })
      .where(eq(membershipRequestsTable.id, id))
      .returning();
    if (!updated) {
      return c.json({ error: "Request not found" }, 404);
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
      const signUpUrl = `${
        Deno.env.get("FRONTEND_URL") ?? "https://youth-connect-tau.vercel.app"
      }/sign-up`;
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

    return c.json({ ...updated, profile: member ?? null });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /membership-requests/:id/reject - Reject membership request (protected: leader)
app.post("/membership-requests/:id/reject", requireRole("leader"), async (c) => {
  try {
    const leaderId = c.get("leaderId") as string;
    const id = c.req.param("id");
    const [updated] = await db
      .update(membershipRequestsTable)
      .set({ status: "rejected", reviewed_by: leaderId })
      .where(eq(membershipRequestsTable.id, id))
      .returning();
    if (!updated) {
      return c.json({ error: "Request not found" }, 404);
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

    return c.json({ ...updated, profile: member ?? null });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

Deno.serve(app.fetch);
