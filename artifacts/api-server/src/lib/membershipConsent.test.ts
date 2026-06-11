import { describe, it, expect } from "vitest";
import { canGrantMembership } from "./membershipConsent";

const base = {
  role: "visitor" as const,
  age: 15,
  parent_phone: null as string | null,
  parent_name: null as string | null,
};

describe("canGrantMembership", () => {
  it("allows a 13+ visitor without consent", () => {
    expect(canGrantMembership(base, false)).toEqual({ ok: true });
  });

  it("blocks an under-13 visitor without parent info", () => {
    const r = canGrantMembership({ ...base, age: 11 }, true);
    expect(r.ok).toBe(false);
  });

  it("blocks under-13 when consent flag is false even with parent info", () => {
    const r = canGrantMembership(
      { ...base, age: 11, parent_phone: "0712345678", parent_name: "Mom" },
      false,
    );
    expect(r.ok).toBe(false);
  });

  it("allows under-13 with parent info + consent", () => {
    const r = canGrantMembership(
      { ...base, age: 11, parent_phone: "0712345678", parent_name: "Mom" },
      true,
    );
    expect(r).toEqual({ ok: true });
  });

  it("treats null age as under-13 (requires consent)", () => {
    const r = canGrantMembership({ ...base, age: null }, false);
    expect(r.ok).toBe(false);
  });

  it("rejects promoting a non-visitor", () => {
    const r = canGrantMembership({ ...base, role: "member" as unknown as "visitor" }, false);
    expect(r.ok).toBe(false);
  });
});
