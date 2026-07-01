import { describe, it, expect } from "vitest";
import { formatServerTiming } from "./serverTiming";

describe("formatServerTiming", () => {
  it("formats a single mark", () => {
    expect(formatServerTiming({ total: 12.34 })).toBe("total;dur=12.3");
  });

  it("formats multiple marks in order, one decimal each", () => {
    expect(formatServerTiming({ db: 4, total: 12 })).toBe("db;dur=4.0, total;dur=12.0");
  });

  it("returns an empty string for no marks", () => {
    expect(formatServerTiming({})).toBe("");
  });
});
