import { describe, it, expect } from "vitest";
import { resolveDirectoryListParams } from "./directoryListParams";

describe("resolveDirectoryListParams", () => {
  it("maps group=leaders to leader + super_admin", () => {
    expect(resolveDirectoryListParams({ group: "leaders" }).roles).toEqual([
      "leader",
      "super_admin",
    ]);
  });
  it("maps group=members to member + visitor", () => {
    expect(resolveDirectoryListParams({ group: "members" }).roles).toEqual([
      "member",
      "visitor",
    ]);
  });
  it("falls back to a single valid role param when no group", () => {
    expect(resolveDirectoryListParams({ role: "leader" }).roles).toEqual(["leader"]);
  });
  it("leaves roles undefined when neither group nor a valid role is given", () => {
    expect(resolveDirectoryListParams({}).roles).toBeUndefined();
    expect(resolveDirectoryListParams({ role: "bogus" }).roles).toBeUndefined();
  });
  it("maps sort, defaulting to name", () => {
    expect(resolveDirectoryListParams({ sort: "newest" }).sort).toBe("newest");
    expect(resolveDirectoryListParams({ sort: "oldest" }).sort).toBe("oldest");
    expect(resolveDirectoryListParams({ sort: "bogus" }).sort).toBe("name");
    expect(resolveDirectoryListParams({}).sort).toBe("name");
  });
  it("trims search to undefined when blank", () => {
    expect(resolveDirectoryListParams({ search: "  " }).search).toBeUndefined();
    expect(resolveDirectoryListParams({ search: " ann " }).search).toBe("ann");
  });
  it("computes pagination (page -> offset, clamps pageSize)", () => {
    const p = resolveDirectoryListParams({ page: "3", pageSize: "20" });
    expect(p).toMatchObject({ page: 3, pageSize: 20, offset: 40 });
    expect(resolveDirectoryListParams({ pageSize: "9999" }).pageSize).toBe(100);
    expect(resolveDirectoryListParams({ page: "0" }).page).toBe(1);
  });
});
