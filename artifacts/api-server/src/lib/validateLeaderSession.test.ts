import { describe, it, expect, vi, beforeEach } from "vitest";

const findProfile = vi.fn();
const findSession = vi.fn();
vi.mock("@workspace/db", () => ({
  db: {
    query: {
      profilesTable: { findFirst: (...a: unknown[]) => findProfile(...a) },
      authSessionsTable: { findFirst: (...a: unknown[]) => findSession(...a) },
    },
  },
  profilesTable: {},
  authSessionsTable: {},
}));
vi.mock("drizzle-orm", () => ({ eq: (..._a: unknown[]) => ({}) }));

import { validateLeaderSession } from "./validateLeaderSession";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const TOKEN = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const future = Date.now() + 60_000;

const header = (o: Record<string, unknown>) => JSON.stringify(o);

beforeEach(() => {
  findProfile.mockReset();
  findSession.mockReset();
  findSession.mockResolvedValue(undefined);
});

describe("validateLeaderSession", () => {
  it("returns null for non-string header", async () => {
    expect(await validateLeaderSession(undefined)).toBeNull();
  });

  it("returns null for malformed JSON", async () => {
    expect(await validateLeaderSession("not json")).toBeNull();
  });

  it("returns null when required fields missing", async () => {
    expect(await validateLeaderSession(header({ profile_id: P1 }))).toBeNull();
  });

  it("returns null for non-uuid ids without querying the DB", async () => {
    expect(await validateLeaderSession(header({ profile_id: "p1", session_token: "t", expires_at: future }))).toBeNull();
    expect(findSession).not.toHaveBeenCalled();
  });

  describe("multi-device sessions", () => {
    it("accepts a live session row, ignoring the client's expires_at", async () => {
      findSession.mockResolvedValue({ token: TOKEN, profile_id: P1, expires_at: new Date(future) });
      findProfile.mockResolvedValue({ id: P1, role: "leader" });
      // Client claims it's expired; the server-side row is what counts.
      const h = header({ profile_id: P1, session_token: TOKEN, expires_at: Date.now() - 1 });
      expect(await validateLeaderSession(h)).toMatchObject({ id: P1 });
    });

    it("rejects an expired session row", async () => {
      findSession.mockResolvedValue({ token: TOKEN, profile_id: P1, expires_at: new Date(Date.now() - 1) });
      const h = header({ profile_id: P1, session_token: TOKEN, expires_at: future });
      expect(await validateLeaderSession(h)).toBeNull();
    });

    it("rejects a session row that belongs to someone else", async () => {
      findSession.mockResolvedValue({ token: TOKEN, profile_id: P2, expires_at: new Date(future) });
      const h = header({ profile_id: P1, session_token: TOKEN, expires_at: future });
      expect(await validateLeaderSession(h)).toBeNull();
      expect(findProfile).not.toHaveBeenCalled();
    });
  });

  describe("legacy single-token sessions", () => {
    it("returns null when expired", async () => {
      const h = header({ profile_id: P1, session_token: TOKEN, expires_at: Date.now() - 1 });
      expect(await validateLeaderSession(h)).toBeNull();
    });

    it("returns null when token does not match DB", async () => {
      findProfile.mockResolvedValue({ id: P1, session_token: OTHER });
      const h = header({ profile_id: P1, session_token: TOKEN, expires_at: future });
      expect(await validateLeaderSession(h)).toBeNull();
    });

    it("returns the profile on a valid session", async () => {
      findProfile.mockResolvedValue({ id: P1, session_token: TOKEN, role: "leader" });
      const h = header({ profile_id: P1, session_token: TOKEN, expires_at: future });
      expect(await validateLeaderSession(h)).toMatchObject({ id: P1, role: "leader" });
    });
  });
});
