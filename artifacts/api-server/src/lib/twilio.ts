/**
 * Twilio MCP Email Integration
 * Uses the official Twilio Node.js SDK to send transactional emails
 * via Twilio SendGrid. This is the ONLY email transport in this app —
 * no Resend, no Postmark, no AWS SES.
 *
 * Required env vars:
 *   TWILIO_SENDGRID_API_KEY  — SendGrid API key (starts with SG.)
 *   TWILIO_SENDGRID_FROM     — verified sender email address
 */

const SENDGRID_API_KEY =
  process.env.TWILIO_SENDGRID_API_KEY ??
  process.env.SENDGRID_API_KEY ??
  "";
const FROM_EMAIL =
  process.env.TWILIO_SENDGRID_FROM ??
  process.env.SENDGRID_FROM ??
  process.env.FROM_EMAIL ??
  "noreply@jeremiahgenerationyouth.org";

export interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Send a transactional email via Twilio SendGrid REST API.
 * Throws when credentials are missing or the API rejects the request, so the
 * caller (the email queue) records the failure instead of marking mail as sent.
 */
export async function sendEmail(payload: EmailPayload): Promise<void> {
  if (!SENDGRID_API_KEY) {
    // Throw (rather than silently return) so the queue does NOT mark this email
    // as sent. A missing key means nothing was delivered — that must be visible.
    throw new Error(
      "TWILIO_SENDGRID_API_KEY is not configured — email cannot be sent",
    );
  }

  const body = {
    personalizations: [{ to: [{ email: payload.to }] }],
    from: { email: FROM_EMAIL, name: "Jeremiah Generation Youth" },
    subject: payload.subject,
    content: [
      { type: "text/plain", value: payload.text },
      ...(payload.html ? [{ type: "text/html", value: payload.html }] : []),
    ],
  };

  try {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(
        `[twilio-sendgrid] Email send failed (${res.status}):`,
        errorText
      );
      throw new Error(`SendGrid API error (${res.status}): ${errorText}`);
    }
  } catch (err) {
    console.error("[twilio-sendgrid] Network error sending email:", err);
    throw err;
  }
}
