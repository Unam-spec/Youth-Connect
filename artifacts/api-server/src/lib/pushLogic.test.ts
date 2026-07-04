import { describe, it, expect } from "vitest";
import {
  checkinWindowOpenNow,
  eventNotifyAllowed,
  shouldDeleteSubscription,
  eventPushPayload,
  checkinOpenPayload,
  checkinApprovedPayload,
  type PushWindow,
} from "./pushLogic";

const friday: PushWindow = {
  day_of_week: 5,
  start_time: "18:30",
  end_time: "22:00",
  enabled: true,
};

// Open-now semantics (not "just opened"): the push must still fire when the
// server was asleep at the opening minute and only wakes mid-window. The
// DB-unique (kind, sent_on) dedupe guarantees at most one send per day.
describe("checkinWindowOpenNow", () => {
  it("is open at the exact opening minute", () => {
    expect(checkinWindowOpenNow([friday], 5, "18:30")).toBe(true);
  });
  it("is open mid-window (catch-up after a missed opening)", () => {
    expect(checkinWindowOpenNow([friday], 5, "20:15")).toBe(true);
  });
  it("is open on the last minute before close", () => {
    expect(checkinWindowOpenNow([friday], 5, "21:59")).toBe(true);
  });
  it("is closed before opening", () => {
    expect(checkinWindowOpenNow([friday], 5, "18:29")).toBe(false);
  });
  it("is closed at the end minute and after", () => {
    expect(checkinWindowOpenNow([friday], 5, "22:00")).toBe(false);
    expect(checkinWindowOpenNow([friday], 5, "23:30")).toBe(false);
  });
  it("is closed on another weekday", () => {
    expect(checkinWindowOpenNow([friday], 4, "19:00")).toBe(false);
  });
  it("ignores disabled windows", () => {
    expect(checkinWindowOpenNow([{ ...friday, enabled: false }], 5, "19:00")).toBe(false);
  });
  it("ignores windows with blank times", () => {
    expect(checkinWindowOpenNow([{ ...friday, start_time: "" }], 5, "19:00")).toBe(false);
    expect(checkinWindowOpenNow([{ ...friday, end_time: "" }], 5, "19:00")).toBe(false);
  });
});

describe("eventNotifyAllowed", () => {
  const now = new Date("2026-07-02T18:00:00Z");
  it("allows when never notified", () => {
    expect(eventNotifyAllowed(null, now)).toBe(true);
  });
  it("blocks within 24 hours", () => {
    expect(
      eventNotifyAllowed(new Date("2026-07-02T10:00:00Z"), now),
    ).toBe(false);
  });
  it("allows after 24 hours", () => {
    expect(
      eventNotifyAllowed(new Date("2026-07-01T17:59:00Z"), now),
    ).toBe(true);
  });
});

describe("shouldDeleteSubscription", () => {
  it("deletes on 404 and 410", () => {
    expect(shouldDeleteSubscription(404)).toBe(true);
    expect(shouldDeleteSubscription(410)).toBe(true);
  });
  it("keeps on other statuses", () => {
    expect(shouldDeleteSubscription(429)).toBe(false);
    expect(shouldDeleteSubscription(500)).toBe(false);
    expect(shouldDeleteSubscription(0)).toBe(false);
  });
});

describe("payloads", () => {
  it("check-in payload links to /checkin", () => {
    const p = checkinOpenPayload();
    expect(p.url).toBe("/checkin");
    expect(p.body).toContain("Check-in is open");
  });
  it("event payload contains title, readable date, time, and links to /my", () => {
    const p = eventPushPayload({
      id: "abc",
      title: "Youth Night",
      date: "2026-07-10",
      time: "18:30:00",
    });
    expect(p.title).toContain("Youth Night");
    expect(p.body).toContain("18:30");
    expect(p.body).toContain("Friday");
    expect(p.url).toBe("/my");
  });
  it("approval payload confirms the check-in and greets by first name when given", () => {
    const p = checkinApprovedPayload("Thandi Khumalo");
    expect(p.body).toContain("Thandi");
    expect(p.body.toLowerCase()).toContain("checked in");
    const anon = checkinApprovedPayload(null);
    expect(anon.body.toLowerCase()).toContain("checked in");
  });
});
