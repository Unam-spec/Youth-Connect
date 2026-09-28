/**
 * Email transport.
 *
 * Preferred: Resend (https://resend.com) sending from the app's own domain,
 * e.g. hello@jgyouth.site — better deliverability, no daily Gmail cap.
 * Fallback: Gmail SMTP with an App Password, used only when Resend isn't set.
 *
 * Resend env vars:
 *   RESEND_API_KEY      — API key from resend.com (the domain must be verified there)
 *   EMAIL_FROM          — optional, default "Jeremiah Generation Youth <hello@jgyouth.site>"
 * Gmail env vars (fallback):
 *   GMAIL_USER          — the Gmail address that sends the mail
 *   GMAIL_APP_PASSWORD  — a 16-character Google App Password (NOT the account password;
 *                         requires 2-Step Verification enabled on the account)
 *   EMAIL_FROM_NAME     — display name on the From header (default below)
 */
import nodemailer, { type Transporter } from "nodemailer";

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const EMAIL_FROM =
  process.env.EMAIL_FROM ?? "Jeremiah Generation Youth <hello@jgyouth.site>";
const GMAIL_USER = process.env.GMAIL_USER ?? "";
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD ?? "";
const FROM_NAME = process.env.EMAIL_FROM_NAME ?? "Jeremiah Generation Youth";

export interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });
  }
  return transporter;
}

/** True when some email provider is configured (used to skip queuing mail that can't send). */
export function isEmailConfigured(): boolean {
  return Boolean(RESEND_API_KEY || (GMAIL_USER && GMAIL_APP_PASSWORD));
}

async function sendViaResend(payload: EmailPayload): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [payload.to],
      subject: payload.subject,
      text: payload.text,
      ...(payload.html ? { html: payload.html } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API error (${res.status}): ${body.slice(0, 300)}`);
  }
}

/**
 * Send a transactional email (Resend if configured, else Gmail SMTP).
 * Throws when no provider is configured or the send fails, so the caller
 * (the email queue) records the failure instead of marking mail as sent.
 */
export async function sendEmail(payload: EmailPayload): Promise<void> {
  if (RESEND_API_KEY) {
    await sendViaResend(payload);
    return;
  }

  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    // Throw (rather than silently return) so the queue does NOT mark this email
    // as sent. Missing credentials mean nothing was delivered — keep it visible.
    throw new Error(
      "No email provider configured (set RESEND_API_KEY, or GMAIL_USER + GMAIL_APP_PASSWORD) — email cannot be sent",
    );
  }

  await getTransporter().sendMail({
    from: `${FROM_NAME} <${GMAIL_USER}>`,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    ...(payload.html ? { html: payload.html } : {}),
  });
}
