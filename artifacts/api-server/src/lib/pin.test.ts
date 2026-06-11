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
  it("rejects trivial PINs", () => {
    expect(validatePin("0000").ok).toBe(false);
    expect(validatePin("1111").ok).toBe(false);
    expect(validatePin("1234").ok).toBe(false);
    expect(validatePin("123456").ok).toBe(false);
  });
});
