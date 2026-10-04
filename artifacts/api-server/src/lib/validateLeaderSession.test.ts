import { describe, it, expect, vi, beforeEach } from "vitest";

const findProfile = vi.fn();
const findSession = vi.fn();
const updateSet = vi.fn();
vi.mock("@workspace/db", () => ({
  db: {
    update: () => ({
      set: (v: unknown) => {
        updateSet(v);
        return { where: async () => undefined };
      },
    }),
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
import { SESSION_TTL_MS, shouldExtendSession } from "./sessions";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const TOKEN = "33333333-3333-4333-8333-333333333333";
const future = Date.now() + 60_000;

const header = (o: Record<string, unknown>) => JSON.stringify(o);

beforeEach(() => {
  findProfile.mockReset();
  findSession.mockReset();
  updateSet.mockReset();
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

  describe("rolling 30-day expiry", () => {
    const DAY = 24 * 60 * 60 * 1000;

    it("pushes the expiry forward when a session is used", async () => {
      // Signed in 10 days ago: 20 days left.
      findSession.mockResolvedValue({ token: TOKEN, profile_id: P1, expires_at: new Date(Date.now() + 20 * DAY) });
      findProfile.mockResolvedValue({ id: P1 });
      await validateLeaderSession(header({ profile_id: P1, session_token: TOKEN }));
      expect(updateSet).toHaveBeenCalledTimes(1);
      const { expires_at } = updateSet.mock.calls[0][0] as { expires_at: Date };
      expect(expires_at.getTime()).toBeGreaterThan(Date.now() + SESSION_TTL_MS - 60_000);
    });

    it("doesn't write again when it was extended within the last day", async () => {
      findSession.mockResolvedValue({ token: TOKEN, profile_id: P1, expires_at: new Date(Date.now() + 29.5 * DAY) });
      findProfile.mockResolvedValue({ id: P1 });
      await validateLeaderSession(header({ profile_id: P1, session_token: TOKEN }));
      expect(updateSet).not.toHaveBeenCalled();
    });

    it("never extends an expired session", async () => {
      findSession.mockResolvedValue({ token: TOKEN, profile_id: P1, expires_at: new Date(Date.now() - 1) });
      expect(await validateLeaderSession(header({ profile_id: P1, session_token: TOKEN }))).toBeNull();
      expect(updateSet).not.toHaveBeenCalled();
    });

    it("shouldExtendSession: once a day at most", () => {
      const now = 1_000_000_000_000;
      expect(shouldExtendSession(new Date(now + 29.5 * DAY), now)).toBe(false);
      expect(shouldExtendSession(new Date(now + 28.9 * DAY), now)).toBe(true);
    });
  });

  it("rejects a token with no session row (old single-token logins are gone)", async () => {
    findProfile.mockResolvedValue({ id: P1, session_token: TOKEN, role: "leader" });
    const h = header({ profile_id: P1, session_token: TOKEN, expires_at: future });
    expect(await validateLeaderSession(h)).toBeNull();
  });
});
