/**
 * Email transport via Resend (https://resend.com).
 *
 * Switched from Twilio SendGrid after SendGrid declined to activate the account.
 *
 * Required env vars:
 *   RESEND_API_KEY  — Resend API key (starts with "re_")
 *   RESEND_FROM     — verified sender, e.g. "Jeremiah Generation Youth <noreply@yourdomain.org>"
 *                     (must be on a domain verified in the Resend dashboard)
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const FROM_EMAIL =
  process.env.RESEND_FROM ??
  process.env.EMAIL_FROM ??
  "Jeremiah Generation Youth <noreply@jeremiahgenerationyouth.org>";

export interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Send a transactional email via the Resend REST API.
 * Throws when the API key is missing or Resend rejects the request, so the
 * caller (the email queue) records the failure instead of marking mail as sent.
 */
export async function sendEmail(payload: EmailPayload): Promise<void> {
  if (!RESEND_API_KEY) {
    // Throw (rather than silently return) so the queue does NOT mark this email
    // as sent. A missing key means nothing was delivered — that must be visible.
    throw new Error("RESEND_API_KEY is not configured — email cannot be sent");
  }

  const body = {
    from: FROM_EMAIL,
    to: [payload.to],
    subject: payload.subject,
    text: payload.text,
    ...(payload.html ? { html: payload.html } : {}),
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Resend API error (${res.status}): ${errorText}`);
  }
}
