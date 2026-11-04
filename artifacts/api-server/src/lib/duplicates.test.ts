import { describe, it, expect } from "vitest";
import { dedupeGroups, nameKey } from "./duplicates";

describe("nameKey", () => {
  it("ignores case and extra spaces", () => {
    expect(nameKey("  Thabo   MOKOENA ")).toBe("thabo mokoena");
    expect(nameKey("thabo mokoena")).toBe(nameKey("Thabo Mokoena"));
  });
  it("keeps different names apart", () => {
    expect(nameKey("Thabo Mokoena")).not.toBe(nameKey("Thabo Mokoena Jr"));
  });
  it("is null for blanks", () => {
    expect(nameKey("   ")).toBeNull();
    expect(nameKey(undefined)).toBeNull();
  });
});

describe("dedupeGroups", () => {
  it("shows a pair once, under its strongest reason", () => {
    const out = dedupeGroups([
      { reason: "phone", ids: ["a", "b"] },
      { reason: "name", ids: ["a", "b"] },
      { reason: "name", ids: ["c", "d"] },
    ]);
    expect(out.map((g) => g.reason)).toEqual(["phone", "name"]);
    expect(out[1].ids).toEqual(["c", "d"]);
  });
  it("keeps a weaker group that adds someone new", () => {
    const out = dedupeGroups([
      { reason: "phone", ids: ["a", "b"] },
      { reason: "name", ids: ["a", "b", "c"] },
    ]);
    expect(out).toHaveLength(2);
  });
});
