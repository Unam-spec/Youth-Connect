import { describe, it, expect } from "vitest";
import { validatePin } from "./pin";

describe("validatePin", () => {
  it("accepts a 4-digit PIN", () => {
    expect(validatePin("8392")).toEqual({ ok: true, value: "8392" });
  });
  it("accepts a 6-digit PIN", () => {
    expect(validatePin("839204").ok).toBe(true);
  });
  it("rejects non-digit / wrong length", () => {
    expect(validatePin("12a4").ok).toBe(false);
    expect(validatePin("123").ok).toBe(false);
    expect(validatePin("1234567").ok).toBe(false);
    expect(validatePin(1234 as unknown).ok).toBe(false);
  });
  it("accepts a non-trivial 6-digit PIN by value", () => {
    expect(validatePin("839204")).toEqual({ ok: true, value: "839204" });
  });
  it("rejects trivial PINs of any length (same-digit and sequential)", () => {
    // 4-digit
    expect(validatePin("0000").ok).toBe(false);
    expect(validatePin("1111").ok).toBe(false);
    expect(validatePin("1234").ok).toBe(false);
    expect(validatePin("4321").ok).toBe(false);
    // 5-digit (previously slipped through)
    expect(validatePin("11111").ok).toBe(false);
    expect(validatePin("12345").ok).toBe(false);
    expect(validatePin("54321").ok).toBe(false);
    // 6-digit
    expect(validatePin("123456").ok).toBe(false);
    expect(validatePin("654321").ok).toBe(false);
    expect(validatePin("999999").ok).toBe(false);
  });
  it("accepts a non-trivial 5-digit PIN", () => {
    expect(validatePin("83920").ok).toBe(true);
  });
});
