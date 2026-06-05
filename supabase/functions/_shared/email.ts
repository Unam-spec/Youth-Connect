// Email transport via the Resend REST API (https://resend.com).
//
// Replaces the previous Gmail SMTP transport (denomailer): raw SMTP sockets
// time out from the Supabase Edge runtime ("Connection timeout"), so the queue
// dead-lettered every message. Resend is a plain HTTPS fetch, which the edge
// runtime handles reliably.
//
// Required secrets (Supabase → Project Settings → Edge Functions → Manage secrets):
//   RESEND_API_KEY  — Resend API key (starts with "re_")
//   RESEND_FROM     — verified sender, e.g.
//                     "Jeremiah Generation Youth <noreply@jeremiahgenerationyouth.org>"
//                     (the domain must be verified in the Resend dashboard)

export interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL =
  Deno.env.get("RESEND_FROM") ??
  Deno.env.get("EMAIL_FROM") ??
  "Jeremiah Generation Youth <noreply@jeremiahgenerationyouth.org>";

/**
 * Sends a transactional email via the Resend REST API. Throws when the API key
 * is missing or Resend rejects the request, so the email queue records the
 * failure (last_error) instead of marking undelivered mail as sent.
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
