import { describe, it, expect } from "vitest";
import { sastWeekRange } from "./weekRange";

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
