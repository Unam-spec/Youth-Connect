import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
const fromEmail = process.env.TWILIO_SENDGRID_FROM ?? "noreply@jeremiahgenerationyouth.org";

// Twilio SendGrid client (Twilio's email product, available via the same SDK)
let sgClient: ReturnType<typeof twilio> | null = null;

function getClient() {
  if (!accountSid || !authToken) return null;
  if (!sgClient) sgClient = twilio(accountSid, authToken);
  return sgClient;
}

export interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Send a transactional email via Twilio SendGrid.
 * Silently skips (logs warning) if credentials are not configured —
 * keeps the app functional in environments without email set up.
 */
export async function sendEmail(payload: EmailPayload): Promise<void> {
  const client = getClient();
  if (!client) {
    console.warn("[twilio] TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set — skipping email to", payload.to);
    return;
  }
  try {
    // Twilio SendGrid via REST — uses the messages resource
    await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.TWILIO_SENDGRID_API_KEY ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: payload.to }] }],
        from: { email: fromEmail },
        subject: payload.subject,
        content: [
          { type: "text/plain", value: payload.text },
          ...(payload.html ? [{ type: "text/html", value: payload.html }] : []),
        ],
      }),
    });
  } catch (err) {
    // Non-fatal — log but don't crash the request
    console.error("[twilio] Email send failed:", err);
  }
}
