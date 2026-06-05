import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
vi.mock("@workspace/db", () => ({
  db: { query: { profilesTable: { findFirst: (...a: unknown[]) => findFirst(...a) } } },
  profilesTable: {},
}));
vi.mock("drizzle-orm", () => ({ eq: (..._a: unknown[]) => ({}) }));

import { validateLeaderSession } from "./validateLeaderSession";

const future = Date.now() + 60_000;

beforeEach(() => findFirst.mockReset());

describe("validateLeaderSession", () => {
  it("returns null for non-string header", async () => {
    expect(await validateLeaderSession(undefined)).toBeNull();
  });

  it("returns null for malformed JSON", async () => {
    expect(await validateLeaderSession("not json")).toBeNull();
  });

  it("returns null when required fields missing", async () => {
    expect(await validateLeaderSession(JSON.stringify({ profile_id: "p1" }))).toBeNull();
  });

  it("returns null when expired", async () => {
    const h = JSON.stringify({ profile_id: "p1", session_token: "t", expires_at: Date.now() - 1 });
    expect(await validateLeaderSession(h)).toBeNull();
  });

  it("returns null when token does not match DB", async () => {
    findFirst.mockResolvedValue({ id: "p1", session_token: "OTHER" });
    const h = JSON.stringify({ profile_id: "p1", session_token: "t", expires_at: future });
    expect(await validateLeaderSession(h)).toBeNull();
  });

  it("returns the profile on a valid session", async () => {
    findFirst.mockResolvedValue({ id: "p1", session_token: "t", role: "leader" });
    const h = JSON.stringify({ profile_id: "p1", session_token: "t", expires_at: future });
    const result = await validateLeaderSession(h);
    expect(result).toMatchObject({ id: "p1", role: "leader" });
  });
});
