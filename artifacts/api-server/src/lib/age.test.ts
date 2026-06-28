import { describe, it, expect } from "vitest";
import { computeAge, validateDob, MIN_AGE, MAX_AGE } from "./age";

describe("computeAge", () => {
  it("returns null for null/empty/invalid input", () => {
    expect(computeAge(null)).toBeNull();
    expect(computeAge("")).toBeNull();
    expect(computeAge("not-a-date")).toBeNull();
  });
  it("computes age when the birthday already passed this year", () => {
    expect(computeAge("2000-01-10", "2026-06-29")).toBe(26);
  });
  it("computes age when the birthday is later this year", () => {
    expect(computeAge("2000-12-10", "2026-06-29")).toBe(25);
  });
  it("counts the birthday on the day itself", () => {
    expect(computeAge("2008-06-29", "2026-06-29")).toBe(18);
  });
  it("does not count the birthday the day before", () => {
    expect(computeAge("2008-06-30", "2026-06-29")).toBe(17);
  });
  it("handles a Feb 29 birth date in a non-leap year", () => {
    expect(computeAge("2008-02-29", "2025-02-28")).toBe(16);
    expect(computeAge("2008-02-29", "2025-03-01")).toBe(17);
  });
});

describe("validateDob", () => {
  it("accepts a valid past date and returns the derived age", () => {
    expect(validateDob("2008-06-29", "2026-06-29")).toEqual({ ok: true, age: 18 });
  });
  it("rejects a future date", () => {
    expect(validateDob("2030-01-01", "2026-06-29").ok).toBe(false);
  });
  it("rejects an impossible calendar date", () => {
    expect(validateDob("2009-02-31", "2026-06-29").ok).toBe(false);
  });
  it(`rejects ages above ${MAX_AGE}`, () => {
    expect(validateDob("1900-01-01", "2026-06-29").ok).toBe(false);
  });
  it(`rejects ages below ${MIN_AGE}`, () => {
    expect(validateDob("2024-01-01", "2026-06-29").ok).toBe(false);
  });
  it("rejects malformed input", () => {
    expect(validateDob(12345 as unknown).ok).toBe(false);
    expect(validateDob("29-06-2008").ok).toBe(false);
  });
});
