import { describe, it, expect } from "vitest";
import {
  automationActive,
  sessionsMissedSince,
  dueNow,
  reengagementMessage,
  renderEmailHtml,
  unsubscribeToken,
  verifyUnsubscribeToken,
} from "./autoMessages";

describe("automationActive", () => {
  it("is off before the start date and on from it", () => {
    expect(automationActive("2026-10-02", "2026-10-05")).toBe(false);
    expect(automationActive("2026-10-05", "2026-10-05")).toBe(true);
    expect(automationActive("2026-10-09", "2026-10-05")).toBe(true);
  });
});

describe("sessionsMissedSince", () => {
  const sessions = ["2026-09-04", "2026-09-11", "2026-09-18", "2026-10-02"];
  it("counts only sessions that actually happened after the anchor", () => {
    // 25 Sep had no check-ins, so it isn't a missed session.
    expect(sessionsMissedSince("2026-09-18", sessions, "2026-10-06")).toBe(1);
    expect(sessionsMissedSince("2026-09-04", sessions, "2026-10-06")).toBe(3);
  });
  it("ignores sessions after today and the anchor session itself", () => {
    expect(sessionsMissedSince("2026-10-02", sessions, "2026-10-06")).toBe(0);
    expect(sessionsMissedSince("2026-09-11", sessions, "2026-09-20")).toBe(1);
  });
});

describe("dueNow", () => {
  it("fires from the target time until the grace period ends", () => {
    expect(dueNow("13:59", "14:00")).toBe(false);
    expect(dueNow("14:00", "14:00")).toBe(true);
    expect(dueNow("14:59", "14:00")).toBe(true);
    expect(dueNow("15:00", "14:00")).toBe(false);
  });
});

describe("messages", () => {
  it("re-engagement tone depends on role and how long they've been away", () => {
    expect(reengagementMessage("member", 2, "Sipho").push.body).toContain("we missed you");
    expect(reengagementMessage("member", 8, "Sipho").push.body).toContain("save you a seat");
    expect(reengagementMessage("leader", 4, "Sipho").subject).toContain("team");
  });
});

describe("unsubscribe tokens", () => {
  it("verifies only for the matching profile and secret", () => {
    const t = unsubscribeToken("p1", "s");
    expect(verifyUnsubscribeToken("p1", t, "s")).toBe(true);
    expect(verifyUnsubscribeToken("p2", t, "s")).toBe(false);
    expect(verifyUnsubscribeToken("p1", t, "other")).toBe(false);
    expect(verifyUnsubscribeToken("p1", "short", "s")).toBe(false);
  });
});

describe("renderEmailHtml", () => {
  it("includes the app link, unsubscribe link and escapes content", () => {
    const html = renderEmailHtml(
      reengagementMessage("member", 2, "<b>X</b>"),
      { appUrl: "https://jgyouth.site", unsubscribeUrl: "https://jgyouth.site/api/email/unsubscribe?p=1&t=2" },
    );
    expect(html).toContain("https://jgyouth.site/my");
    expect(html).toContain("unsubscribe?p=1&t=2");
    expect(html).toContain("&lt;b&gt;X&lt;/b&gt;");
    expect(html).not.toContain("<b>X</b>");
  });
});
