/**
 * Email transport via Gmail SMTP (nodemailer).
 *
 * Chosen because it needs no domain and no provider vetting — it uses an
 * existing Gmail account with an App Password.
 *
 * Required env vars:
 *   GMAIL_USER          — the Gmail address that sends the mail
 *   GMAIL_APP_PASSWORD  — a 16-character Google App Password (NOT the account password;
 *                         requires 2-Step Verification enabled on the account)
 * Optional:
 *   EMAIL_FROM_NAME     — display name on the From header (default below)
 */
import nodemailer, { type Transporter } from "nodemailer";

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

/**
 * Send a transactional email via Gmail SMTP.
 * Throws when credentials are missing or the SMTP send fails, so the caller
 * (the email queue) records the failure instead of marking mail as sent.
 */
export async function sendEmail(payload: EmailPayload): Promise<void> {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    // Throw (rather than silently return) so the queue does NOT mark this email
    // as sent. Missing credentials mean nothing was delivered — keep it visible.
    throw new Error(
      "GMAIL_USER / GMAIL_APP_PASSWORD not configured — email cannot be sent",
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
