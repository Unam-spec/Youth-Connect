import { describe, it, expect } from "vitest";
import { sastWeekRange, resolveReportWeek } from "./weekRange";

describe("sastWeekRange", () => {
  it("Friday maps to the Monday-start week containing it", () => {
    // 2026-07-24 is a Friday (dayOfWeek 5).
    expect(sastWeekRange("2026-07-24", 5)).toEqual({
      weekStart: "2026-07-20",
      weekEndExclusive: "2026-07-27",
      weekEndInclusive: "2026-07-26",
    });
  });

  it("Monday is the start of its own week", () => {
    expect(sastWeekRange("2026-07-20", 1)).toEqual({
      weekStart: "2026-07-20",
      weekEndExclusive: "2026-07-27",
      weekEndInclusive: "2026-07-26",
    });
  });

  it("Sunday belongs to the week that started the previous Monday", () => {
    // 2026-07-26 is a Sunday (dayOfWeek 0) — same week as the Friday above.
    expect(sastWeekRange("2026-07-26", 0)).toEqual({
      weekStart: "2026-07-20",
      weekEndExclusive: "2026-07-27",
      weekEndInclusive: "2026-07-26",
    });
  });

  it("handles a month boundary", () => {
    // 2026-08-01 is a Saturday (dayOfWeek 6); its week starts 2026-07-27.
    expect(sastWeekRange("2026-08-01", 6)).toEqual({
      weekStart: "2026-07-27",
      weekEndExclusive: "2026-08-03",
      weekEndInclusive: "2026-08-02",
    });
  });

  it("handles a year boundary", () => {
    // 2027-01-01 is a Friday (dayOfWeek 5); its week starts 2026-12-28.
    expect(sastWeekRange("2027-01-01", 5)).toEqual({
      weekStart: "2026-12-28",
      weekEndExclusive: "2027-01-04",
      weekEndInclusive: "2027-01-03",
    });
  });
});

describe("resolveReportWeek", () => {
  // "Today" in these tests: Monday 2026-09-28 (dayOfWeek 1).
  const today = "2026-09-28";
  const dow = 1;

  it("defaults to the current week when no week is requested", () => {
    expect(resolveReportWeek(undefined, today, dow)).toEqual({
      weekStart: "2026-09-28",
      weekEndExclusive: "2026-10-05",
      weekEndInclusive: "2026-10-04",
    });
  });

  it("returns a past week for any date inside it (e.g. the Friday session)", () => {
    // Friday 2026-09-25 → week of Monday 2026-09-21.
    expect(resolveReportWeek("2026-09-25", today, dow)).toEqual({
      weekStart: "2026-09-21",
      weekEndExclusive: "2026-09-28",
      weekEndInclusive: "2026-09-27",
    });
  });

  it("rejects malformed dates", () => {
    expect(resolveReportWeek("25-09-2026", today, dow)).toBeNull();
    expect(resolveReportWeek("2026-02-30", today, dow)).toBeNull();
    expect(resolveReportWeek("nope", today, dow)).toBeNull();
  });

  it("rejects weeks in the future", () => {
    expect(resolveReportWeek("2026-10-05", today, dow)).toBeNull();
  });
});
