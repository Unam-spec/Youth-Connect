import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

export interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const GMAIL_USER = Deno.env.get("GMAIL_USER") ?? "";
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD") ?? "";
const FROM_NAME = Deno.env.get("EMAIL_FROM_NAME") ?? "Jeremiah Generation Youth";

/**
 * Sends a transactional email via Gmail SMTP (denomailer). Throws when
 * credentials are missing or the send fails, so the email queue records the
 * failure instead of marking undelivered mail as sent.
 */
export async function sendEmail(payload: EmailPayload): Promise<void> {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    throw new Error("GMAIL_USER / GMAIL_APP_PASSWORD not configured — email cannot be sent");
  }
  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD },
    },
  });
  try {
    await client.send({
      from: `${FROM_NAME} <${GMAIL_USER}>`,
      to: payload.to,
      subject: payload.subject,
      content: payload.text,
      html: payload.html,
    });
  } finally {
    await client.close();
  }
}
