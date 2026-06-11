import { describe, it, expect } from "vitest";
import { normalizeUsername, validateUsername } from "./username";

describe("normalizeUsername", () => {
  it("trims and lowercases", () => {
    expect(normalizeUsername("  TKemo7 ")).toBe("tkemo7");
  });
  it("returns null for blank or non-string", () => {
    expect(normalizeUsername("   ")).toBeNull();
    expect(normalizeUsername(undefined)).toBeNull();
    expect(normalizeUsername(42)).toBeNull();
  });
});

describe("validateUsername", () => {
  it("accepts valid usernames", () => {
    expect(validateUsername("tkemo_7")).toEqual({ ok: true, value: "tkemo_7" });
  });
  it("rejects too short", () => {
    expect(validateUsername("ab").ok).toBe(false);
  });
  it("rejects too long", () => {
    expect(validateUsername("a".repeat(21)).ok).toBe(false);
  });
  it("rejects illegal characters", () => {
    expect(validateUsername("tk emo").ok).toBe(false);
    expect(validateUsername("tk!emo").ok).toBe(false);
  });
  it("rejects reserved handles (normalized)", () => {
    expect(validateUsername("Admin").ok).toBe(false);
    expect(validateUsername("leader").ok).toBe(false);
    expect(validateUsername("superadmin").ok).toBe(false);
  });
});
