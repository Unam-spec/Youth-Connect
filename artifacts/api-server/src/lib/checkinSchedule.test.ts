import { describe, it, expect } from "vitest";
import { evaluateCheckinOpen, type CheckinWindow } from "./checkinSchedule";

const friday: CheckinWindow[] = [
  { day_of_week: 5, start_time: "18:30", end_time: "22:00", enabled: true },
];

describe("evaluateCheckinOpen", () => {
  it("always open when restriction is off", () => {
    expect(evaluateCheckinOpen(false, [], 2, "03:00")).toBe(true);
  });
  it("open inside an enabled window for the current weekday", () => {
    expect(evaluateCheckinOpen(true, friday, 5, "19:00")).toBe(true);
  });
  it("open exactly at start", () => {
    expect(evaluateCheckinOpen(true, friday, 5, "18:30")).toBe(true);
  });
  it("closed exactly at end (exclusive)", () => {
    expect(evaluateCheckinOpen(true, friday, 5, "22:00")).toBe(false);
  });
  it("closed before start", () => {
    expect(evaluateCheckinOpen(true, friday, 5, "18:29")).toBe(false);
  });
  it("closed on a different weekday", () => {
    expect(evaluateCheckinOpen(true, friday, 4, "19:00")).toBe(false);
  });
  it("closed when the day's window is disabled", () => {
    const disabled = [{ ...friday[0], enabled: false }];
    expect(evaluateCheckinOpen(true, disabled, 5, "19:00")).toBe(false);
  });
});
