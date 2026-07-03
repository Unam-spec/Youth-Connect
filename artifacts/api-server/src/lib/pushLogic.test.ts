import { describe, it, expect } from "vitest";
import {
  windowJustOpened,
  eventNotifyAllowed,
  shouldDeleteSubscription,
  eventPushPayload,
  checkinOpenPayload,
  type PushWindow,
} from "./pushLogic";

const friday: PushWindow = {
  day_of_week: 5,
  start_time: "18:30",
  end_time: "22:00",
  enabled: true,
};

describe("windowJustOpened", () => {
  it("fires at the exact opening minute", () => {
    expect(windowJustOpened([friday], 5, "18:30")).toBe(true);
  });
  it("fires within the 2-minute grace period", () => {
    expect(windowJustOpened([friday], 5, "18:32")).toBe(true);
  });
  it("does not fire before opening", () => {
    expect(windowJustOpened([friday], 5, "18:29")).toBe(false);
  });
  it("does not fire after the grace period", () => {
    expect(windowJustOpened([friday], 5, "18:33")).toBe(false);
  });
  it("does not fire on another weekday", () => {
    expect(windowJustOpened([friday], 4, "18:30")).toBe(false);
  });
  it("ignores disabled windows", () => {
    expect(windowJustOpened([{ ...friday, enabled: false }], 5, "18:30")).toBe(false);
  });
  it("ignores windows with blank times", () => {
    expect(
      windowJustOpened([{ ...friday, start_time: "" }], 5, "18:30"),
    ).toBe(false);
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
});
