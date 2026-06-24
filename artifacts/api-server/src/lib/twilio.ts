/**
 * WhatsApp transport via Twilio.
 *
 * Required env vars:
 *   TWILIO_ACCOUNT_SID   — Twilio account SID (starts with AC…)
 *   TWILIO_AUTH_TOKEN    — Twilio auth token
 *   TWILIO_WHATSAPP_FROM — sender, e.g. "whatsapp:+14155238886" (sandbox) or your
 *                          approved WhatsApp sender. The "whatsapp:" prefix is added
 *                          automatically if omitted.
 * Optional:
 *   TWILIO_DEFAULT_COUNTRY_CODE — E.164 country code prepended to local numbers that
 *                          start with "0" (default "+27"). The youth group spans SA
 *                          (+27) and Namibia (+264); set this to match your audience.
 */
import twilio from "twilio";
import { logger } from "./logger";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const RAW_FROM = process.env.TWILIO_WHATSAPP_FROM ?? "";
const DEFAULT_CC = process.env.TWILIO_DEFAULT_COUNTRY_CODE ?? "+27";

const FROM = RAW_FROM
  ? RAW_FROM.startsWith("whatsapp:")
    ? RAW_FROM
    : `whatsapp:${RAW_FROM}`
  : "";

/** True when Twilio credentials + sender are all configured. */
export const isTwilioConfigured = Boolean(ACCOUNT_SID && AUTH_TOKEN && FROM);

let client: ReturnType<typeof twilio> | null = null;
function getClient() {
  if (!client) client = twilio(ACCOUNT_SID, AUTH_TOKEN);
  return client;
}

/**
 * Best-effort conversion of a stored phone string to E.164. Handles "+…",
 * "00…", local "0…" (→ default country code), and bare digit strings (assumed to
 * already include a country code). Returns null when it can't form a plausible
 * number.
 */
export function toE164(phone: unknown, defaultCc = DEFAULT_CC): string | null {
  if (typeof phone !== "string") return null;
  let p = phone.trim().replace(/[\s\-().]/g, "");
  if (!p) return null;

  if (p.startsWith("+")) {
    // keep as-is
  } else if (p.startsWith("00")) {
    p = "+" + p.slice(2);
  } else if (p.startsWith("0")) {
    p = defaultCc + p.slice(1);
  } else if (/^\d{6,15}$/.test(p)) {
    p = "+" + p; // assume it already includes a country code
  } else {
    return null;
  }

  const digits = p.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return "+" + digits;
}

/** Format a phone string as a Twilio WhatsApp address, or null if invalid. */
export function toWhatsAppAddress(phone: unknown): string | null {
  const e164 = toE164(phone);
  return e164 ? `whatsapp:${e164}` : null;
}

/**
 * Replace `[Key]` placeholders in a template. e.g.
 *   applyTemplateVars("Hi [User], from [Leader]", { User: "Sam", Leader: "Jo" })
 */
export function applyTemplateVars(
  text: string,
  vars: Record<string, string | null | undefined>,
): string {
  let out = text;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`[${key}]`).join(value ?? "");
  }
  return out;
}

/**
 * Build the Twilio `ContentVariables` object from a template's position→key map
 * and the resolved values. Drops empty values (Twilio error 92007 rejects
 * null/empty) and strips newlines (not allowed in WhatsApp template variables).
 */
export function buildContentVariables(
  varMap: Record<string, string> | null | undefined,
  values: Record<string, string | null | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!varMap) return out;
  for (const [position, key] of Object.entries(varMap)) {
    const v = values[key];
    if (v != null && String(v).trim() !== "") {
      out[position] = String(v).replace(/\s*\n\s*/g, " ").trim();
    }
  }
  return out;
}

/**
 * Send a WhatsApp message. Provide either `body` (free-form — only valid in the
 * sandbox or within the 24h session window) or `contentSid` (+ optional
 * `contentVariables`) to send an approved Content template (required for
 * business-initiated messages outside the window). Throws when Twilio isn't
 * configured or the number is invalid. Returns the Twilio message SID.
 */
export async function sendWhatsApp(options: {
  to: string;
  body?: string;
  contentSid?: string;
  contentVariables?: Record<string, string>;
}): Promise<string> {
  if (!isTwilioConfigured) {
    throw new Error(
      "Twilio not configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM",
    );
  }
  const address = toWhatsAppAddress(options.to);
  if (!address) {
    throw new Error(`Invalid phone number for WhatsApp: "${options.to}"`);
  }

  let message;
  if (options.contentSid) {
    // Content template send — no Body/MediaUrl alongside ContentSid.
    const cv = options.contentVariables;
    message = await getClient().messages.create({
      from: FROM,
      to: address,
      contentSid: options.contentSid,
      ...(cv && Object.keys(cv).length > 0
        ? { contentVariables: JSON.stringify(cv) }
        : {}),
    });
  } else {
    if (!options.body) {
      throw new Error("sendWhatsApp requires either `body` or `contentSid`");
    }
    message = await getClient().messages.create({
      from: FROM,
      to: address,
      body: options.body,
    });
  }

  logger.info(
    { sid: message.sid, to: address, mode: options.contentSid ? "content" : "freeform" },
    "WhatsApp message sent",
  );
  return message.sid;
}

/**
 * Send using a `whatsapp_templates` row: if it carries a `content_sid`, send the
 * approved Content template (production-safe outside the 24h window); otherwise
 * fall back to free-form text with `[Key]` substitution (sandbox / in-window).
 */
export async function sendWhatsAppFromTemplate(args: {
  to: string;
  template: {
    content_sid?: string | null;
    content_var_map?: Record<string, string> | null;
    message_text: string;
  };
  vars: Record<string, string | null | undefined>;
}): Promise<string> {
  const { to, template, vars } = args;
  if (template.content_sid) {
    return sendWhatsApp({
      to,
      contentSid: template.content_sid,
      contentVariables: buildContentVariables(template.content_var_map, vars),
    });
  }
  return sendWhatsApp({
    to,
    body: applyTemplateVars(template.message_text, vars),
  });
}
