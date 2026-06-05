import { describe, it, expect } from "vitest";
import { normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("lowercases and trims", () => {
    expect(normalizePhone("  +27 82 ABC  ")).toBe("+27 82 abc");
  });
  it("returns null for null/empty/whitespace", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
});
