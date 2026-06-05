import { describe, it, expect } from "vitest";
import { parseMembersDirectoryQuery } from "./membersDirectoryQuery";

describe("parseMembersDirectoryQuery", () => {
  it("defaults page=1 limit=50 with no params", () => {
    expect(parseMembersDirectoryQuery({})).toEqual({
      search: undefined, role: undefined, page: 1, limit: 50, offset: 0,
    });
  });

  it("clamps limit to 100 and page to >=1", () => {
    const r = parseMembersDirectoryQuery({ limit: "500", page: "0" });
    expect(r.limit).toBe(100);
    expect(r.page).toBe(1);
  });

  it("computes offset from page and limit", () => {
    const r = parseMembersDirectoryQuery({ page: "3", limit: "20" });
    expect(r.offset).toBe(40);
  });

  it("accepts a valid role and ignores an invalid one", () => {
    expect(parseMembersDirectoryQuery({ role: "leader" }).role).toBe("leader");
    expect(parseMembersDirectoryQuery({ role: "visitor" }).role).toBeUndefined();
    expect(parseMembersDirectoryQuery({ role: "garbage" }).role).toBeUndefined();
  });

  it("passes through a trimmed non-empty search", () => {
    expect(parseMembersDirectoryQuery({ search: "  ann " }).search).toBe("ann");
    expect(parseMembersDirectoryQuery({ search: "   " }).search).toBeUndefined();
  });
});
