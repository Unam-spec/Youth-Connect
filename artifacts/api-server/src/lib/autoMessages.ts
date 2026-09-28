/**
 * Automated outreach (push + email) — the pure rules, kept free of DB access
 * so they can be unit tested. The job that uses them lives in
 * jobs/autoMessenger.ts.
 *
 *  - Friday reminder: session day, FRIDAY_REMINDER_LEAD_MIN before check-in
 *    opens, to everyone active in the last 4 weeks.
 *  - Re-engagement: every Tuesday 17:00 SAST, to people who've missed enough
 *    weeks to hit a follow-up stage (stageForRole). Each stage is sent once
 *    per absence, so nobody gets the same nudge twice.
 *
 * Nothing is sent before AUTO_MESSAGES_START (a SAST date).
 */
import crypto from "node:crypto";
import type { ProfileRole } from "./directoryListParams";
import { isStaffRole } from "./followUpStages";
import type { PushPayload } from "./pushLogic";

export const AUTO_MESSAGES_START = process.env.AUTO_MESSAGES_START ?? "2026-10-05";

export const FRIDAY_REMINDER_LEAD_MIN = 180; // 3h before check-in opens
export const REENGAGE_DAY_OF_WEEK = 2; // Tuesday
export const REENGAGE_TIME = "17:00";
/** How long after the target time a missed send may still go out (restarts, deploys). */
export const SEND_GRACE_MIN = 60;

/**
 * How many sessions someone has missed: sessions held (dates with any
 * check-ins) after their anchor date, up to today. Counting real sessions
 * rather than calendar weeks means a Friday where check-in wasn't used can't
 * make everyone look absent. `sessionDates` are "YYYY-MM-DD".
 */
export function sessionsMissedSince(anchor: string, sessionDates: string[], todaySast: string): number {
  let missed = 0;
  for (const d of sessionDates) {
    if (d > anchor && d <= todaySast) missed++;
  }
  return missed;
}

/** True once automation has been switched on (dates are "YYYY-MM-DD", SAST). */
export function automationActive(todaySast: string, start = AUTO_MESSAGES_START): boolean {
  return todaySast >= start;
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(total: number): string {
  const t = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** Inside [target, target + grace) — so a send happens once, soon after its time. */
export function dueNow(nowHHMM: string, targetHHMM: string, graceMin = SEND_GRACE_MIN): boolean {
  const diff = toMinutes(nowHHMM) - toMinutes(targetHHMM);
  return diff >= 0 && diff < graceMin;
}

export function fridayReminderTime(checkinStart: string): string {
  return fromMinutes(toMinutes(checkinStart.slice(0, 5)) - FRIDAY_REMINDER_LEAD_MIN);
}

function firstNameOf(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "there";
}

/** "17:00" -> "5pm", "18:30" -> "6:30pm". */
export function friendlyTime(hhmm: string): string {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

export interface OutboundMessage {
  push: PushPayload;
  subject: string;
  /** Plain paragraphs; the email template wraps them. */
  paragraphs: string[];
  cta: { label: string; path: string };
}

export function fridayReminderMessage(fullName: string | null, checkinStart: string): OutboundMessage {
  const first = firstNameOf(fullName);
  const at = friendlyTime(checkinStart);
  return {
    push: {
      title: "JG Youth is tonight 🙌",
      body: `Check-in opens at ${at}. See you there!`,
      url: "/checkin",
    },
    subject: "JG Youth is tonight 🙌",
    paragraphs: [
      `Hi ${first},`,
      `Just a reminder that JG Youth is on tonight — check-in opens at ${at}.`,
      "Bring a friend, and don't forget to check in when you arrive. See you there!",
    ],
    cta: { label: "Open the app", path: "/checkin" },
  };
}

export function reengagementMessage(
  role: ProfileRole,
  stage: number,
  fullName: string | null,
): OutboundMessage {
  const first = firstNameOf(fullName);
  const staff = isStaffRole(role);
  const body = staff
    ? stage >= 4
      ? `Hi ${first}, it's been a while — the team really misses you. Can we count on you this Friday?`
      : `Hi ${first}, we missed you on the team! Hope to see you this Friday.`
    : stage >= 6
      ? `Hi ${first}, it's been a while and we still save you a seat. Come through this Friday — no pressure, just good vibes.`
      : stage >= 4
        ? `Hi ${first}, we've really missed you at JG Youth! This Friday is a great one to come back to.`
        : `Hi ${first}, we missed you at JG Youth! Hope to see you this Friday 🙌`;
  return {
    push: { title: "We miss you at JG Youth", body, url: "/my" },
    subject: staff ? "The team misses you 💙" : "We miss you at JG Youth 💙",
    paragraphs: [body, "Everything for this week — events and check-in — is in the app."],
    cta: { label: "See what's on", path: "/my" },
  };
}

// ── Email unsubscribe links ─────────────────────────────────────────────────
// A per-profile HMAC so a link can only unsubscribe the person it was sent to.

function unsubscribeSecret(): string {
  return (
    process.env.EMAIL_UNSUBSCRIBE_SECRET ??
    process.env.CLERK_SECRET_KEY ??
    "jg-youth-unsubscribe"
  );
}

export function unsubscribeToken(profileId: string, secret = unsubscribeSecret()): string {
  return crypto.createHmac("sha256", secret).update(`unsub:${profileId}`).digest("hex").slice(0, 32);
}

export function verifyUnsubscribeToken(
  profileId: string,
  token: string,
  secret = unsubscribeSecret(),
): boolean {
  const expected = unsubscribeToken(profileId, secret);
  if (typeof token !== "string" || token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Wraps a message in the email layout, with the app link and an unsubscribe link. */
export function renderEmailHtml(
  msg: OutboundMessage,
  opts: { appUrl: string; unsubscribeUrl: string },
): string {
  const paras = msg.paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#1f2933;">${escapeHtml(p)}</p>`)
    .join("");
  return `<div style="font-family:Inter,Arial,sans-serif;background:#f7f6f2;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;">
    <p style="margin:0 0 18px;font-size:13px;font-weight:600;letter-spacing:.08em;color:#2a4bff;text-transform:uppercase;">Jeremiah Generation Youth</p>
    ${paras}
    <p style="margin:22px 0 0;"><a href="${opts.appUrl}${msg.cta.path}" style="display:inline-block;background:#2a4bff;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:14px;">${escapeHtml(msg.cta.label)}</a></p>
  </div>
  <p style="max-width:520px;margin:14px auto 0;font-size:12px;color:#7b8794;text-align:center;">
    You're getting this because you're part of JG Youth. <a href="${opts.unsubscribeUrl}" style="color:#7b8794;">Unsubscribe from these emails</a>
  </p>
</div>`;
}
