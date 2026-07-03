import { describe, it, expect } from "vitest";
import { resolveSignupAge } from "./signupAge";

// Fixed "today" so derived ages don't drift as real time passes.
const TODAY = "2026-07-03";

describe("resolveSignupAge", () => {
  it("derives age from a valid date_of_birth", () => {
    expect(resolveSignupAge({ date_of_birth: "2010-03-15" }, TODAY)).toEqual({
      ok: true,
      date_of_birth: "2010-03-15",
      age: 16,
    });
  });

  it("trims the date_of_birth string", () => {
    expect(resolveSignupAge({ date_of_birth: " 2010-03-15 " }, TODAY)).toEqual({
      ok: true,
      date_of_birth: "2010-03-15",
      age: 16,
    });
  });

  it("rejects an invalid date_of_birth", () => {
    expect(resolveSignupAge({ date_of_birth: "not-a-date" }, TODAY).ok).toBe(false);
    expect(resolveSignupAge({ date_of_birth: "2030-01-01" }, TODAY).ok).toBe(false);
    // Younger than MIN_AGE (5).
    expect(resolveSignupAge({ date_of_birth: "2025-01-01" }, TODAY).ok).toBe(false);
  });

  it("prefers date_of_birth over a legacy age when both are sent", () => {
    expect(
      resolveSignupAge({ date_of_birth: "2010-03-15", age: 40 }, TODAY),
    ).toEqual({ ok: true, date_of_birth: "2010-03-15", age: 16 });
  });

  it("falls back to a legacy age when no date_of_birth is sent", () => {
    expect(resolveSignupAge({ age: 15 }, TODAY)).toEqual({
      ok: true,
      date_of_birth: null,
      age: 15,
    });
    // Numeric strings arrive from older clients.
    expect(resolveSignupAge({ age: "15" }, TODAY)).toEqual({
      ok: true,
      date_of_birth: null,
      age: 15,
    });
  });

  it("rejects an out-of-range or non-numeric legacy age", () => {
    expect(resolveSignupAge({ age: 0 }, TODAY).ok).toBe(false);
    expect(resolveSignupAge({ age: 121 }, TODAY).ok).toBe(false);
    expect(resolveSignupAge({ age: "abc" }, TODAY).ok).toBe(false);
  });

  it("returns nulls when neither field is sent (both optional)", () => {
    expect(resolveSignupAge({}, TODAY)).toEqual({
      ok: true,
      date_of_birth: null,
      age: null,
    });
    // Empty strings count as absent.
    expect(resolveSignupAge({ date_of_birth: "", age: "" }, TODAY)).toEqual({
      ok: true,
      date_of_birth: null,
      age: null,
    });
  });
});
