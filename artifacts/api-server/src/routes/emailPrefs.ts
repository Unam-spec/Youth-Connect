import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, profilesTable } from "@workspace/db";
import { verifyUnsubscribeToken } from "../lib/autoMessages";
import { isUuid } from "../lib/sessions";
import { APP_BASE_URL } from "../lib/appUrl";

const router = Router();

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="font-family:Inter,Arial,sans-serif;background:#f7f6f2;margin:0;padding:48px 16px;">
<div style="max-width:440px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;text-align:center;">
<h1 style="font-size:20px;margin:0 0 12px;color:#1f2933;">${title}</h1>
<p style="font-size:15px;line-height:1.5;color:#52606d;margin:0 0 20px;">${body}</p>
<a href="${APP_BASE_URL}" style="color:#2a4bff;font-weight:600;">Back to JG Youth</a>
</div></body></html>`;
}

// GET /email/unsubscribe?p=<profileId>&t=<token> — link in automated emails.
// Public by design (clicked from an inbox); the HMAC token limits it to the
// person the email was sent to.
router.get("/email/unsubscribe", async (req, res) => {
  const profileId = typeof req.query.p === "string" ? req.query.p : "";
  const token = typeof req.query.t === "string" ? req.query.t : "";
  if (!isUuid(profileId) || !verifyUnsubscribeToken(profileId, token)) {
    return res
      .status(400)
      .type("html")
      .send(page("Link not valid", "This unsubscribe link is incomplete or has been changed."));
  }
  try {
    await db
      .update(profilesTable)
      .set({ email_opt_out: true })
      .where(eq(profilesTable.id, profileId));
    return res
      .type("html")
      .send(
        page(
          "You're unsubscribed",
          "You won't get reminder or follow-up emails from JG Youth any more. You'll still get app notifications if you've turned them on.",
        ),
      );
  } catch (err) {
    req.log.error(err);
    return res.status(500).type("html").send(page("Something went wrong", "Please try the link again later."));
  }
});

export default router;
