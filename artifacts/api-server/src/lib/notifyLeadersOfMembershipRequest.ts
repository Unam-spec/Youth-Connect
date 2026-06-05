import { db, profilesTable, pendingEmailsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

/**
 * Queues a notification email to every leader and super_admin (who has an email
 * on file) telling them a new membership request needs review. Best-effort: if
 * no recipients have emails, it is a no-op. The actual send happens via the
 * pending_emails queue / email processor.
 */
export async function notifyLeadersOfMembershipRequest(
  requesterName: string,
  reason: string,
): Promise<void> {
  const recipients = await db
    .select({ email: profilesTable.email })
    .from(profilesTable)
    .where(
      inArray(profilesTable.role, ["leader", "super_admin"]),
    );

  const dashboardUrl =
    (process.env.FRONTEND_URL ?? "https://youth-connect-tau.vercel.app") +
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
