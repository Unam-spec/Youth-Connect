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

const SENDGRID_API_KEY = process.env.TWILIO_SENDGRID_API_KEY ?? "";
const FROM_EMAIL =
  process.env.TWILIO_SENDGRID_FROM ?? "noreply@jeremiahgenerationyouth.org";

export interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Send a transactional email via Twilio SendGrid REST API.
 * Silently skips (logs warning) when credentials are missing so the
 * app stays functional in environments without email configured.
 */
export async function sendEmail(payload: EmailPayload): Promise<void> {
  if (!SENDGRID_API_KEY) {
    console.warn(
      "[twilio-sendgrid] TWILIO_SENDGRID_API_KEY not set — skipping email to",
      payload.to
    );
    return;
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
    }
  } catch (err) {
    // Non-fatal — log but do not crash the request
    console.error("[twilio-sendgrid] Network error sending email:", err);
  }
}
