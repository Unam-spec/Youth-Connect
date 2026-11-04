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

import { phoneKey } from "./phone";

describe("phoneKey", () => {
  it("matches the same South African number however it's typed", () => {
    const want = "27821112222";
    for (const v of ["0821112222", "082 111 2222", "+27821112222", "+27 82 111 2222", "0027821112222", "+27 082 111 2222", "27821112222", "(082) 111-2222"]) {
      expect(phoneKey(v)).toBe(want);
    }
  });
  it("keeps other countries' numbers apart", () => {
    expect(phoneKey("+263771234567")).toBe("263771234567");
    expect(phoneKey("+263771234567")).not.toBe(phoneKey("+27771234567"));
  });
  it("ignores blanks and junk", () => {
    expect(phoneKey("")).toBeNull();
    expect(phoneKey("n/a")).toBeNull();
    expect(phoneKey(null)).toBeNull();
    expect(phoneKey("123")).toBeNull();
  });
});
