import { describe, it, expect } from "vitest";
import {
  normalizeKey,
  normalizeWorshipPhone,
  normalizeInstruments,
  validateSongInput,
  canEditSong,
  checkLeaderChange,
  LoginLimiter,
} from "./worshipRules";

describe("normalizeKey", () => {
  it("normalizes case and accidentals", () => {
    expect(normalizeKey("g")).toBe("G");
    expect(normalizeKey("bb")).toBe("Bb");
    expect(normalizeKey(" f#m ")).toBe("F#m");
  });
  it("treats blank as cleared and junk as invalid", () => {
    expect(normalizeKey("")).toBeNull();
    expect(normalizeKey(null)).toBeNull();
    expect(normalizeKey("H")).toBeUndefined();
    expect(normalizeKey("G major")).toBeUndefined();
  });
});

describe("normalizeWorshipPhone", () => {
  it("treats formatting variants as the same number", () => {
    expect(normalizeWorshipPhone("+27 82 123 4567")).toBe("+27821234567");
    expect(normalizeWorshipPhone("082-123-4567")).toBe("+27821234567");
    expect(normalizeWorshipPhone("0027821234567")).toBe("+27821234567");
  });
  it("rejects junk", () => {
    expect(normalizeWorshipPhone("hello")).toBeNull();
    expect(normalizeWorshipPhone("12345")).toBeNull();
    expect(normalizeWorshipPhone(undefined)).toBeNull();
  });
});

describe("normalizeInstruments", () => {
  it("accepts known instruments and dedupes", () => {
    expect(normalizeInstruments(["Vocals", "keys", "vocals"])).toEqual(["vocals", "keys"]);
  });
  it("rejects unknown ones", () => {
    expect(normalizeInstruments(["kazoo"])).toBeUndefined();
  });
});

describe("validateSongInput", () => {
  it("requires a title", () => {
    expect(validateSongInput({ title: "  " }).ok).toBe(false);
  });
  it("normalizes fields", () => {
    const r = validateSongInput({
      title: " Way Maker ",
      artist: "Sinach",
      original_key: "e",
      tempo_bpm: "68",
      lyrics: "[E]You are here\r\n",
    });
    expect(r).toEqual({
      ok: true,
      value: {
        title: "Way Maker",
        artist: "Sinach",
        original_key: "E",
        tempo_bpm: 68,
        lyrics: "[E]You are here\n",
      },
    });
  });
  it("rejects a bad tempo or key", () => {
    expect(validateSongInput({ title: "x", tempo_bpm: 5 }).ok).toBe(false);
    expect(validateSongInput({ title: "x", original_key: "Z" }).ok).toBe(false);
  });
});

describe("canEditSong", () => {
  it("lets leaders edit anything and members only their own", () => {
    expect(canEditSong({ id: "a", role: "leader" }, { created_by: "b" })).toBe(true);
    expect(canEditSong({ id: "a", role: "member" }, { created_by: "a" })).toBe(true);
    expect(canEditSong({ id: "a", role: "member" }, { created_by: "b" })).toBe(false);
    expect(canEditSong({ id: "a", role: "member" }, { created_by: null })).toBe(false);
  });
});

describe("checkLeaderChange", () => {
  const leader = { role: "leader", status: "approved" };
  const member = { role: "member", status: "approved" };
  it("blocks removing or demoting the last leader", () => {
    expect(checkLeaderChange(leader, "remove", 1).ok).toBe(false);
    expect(checkLeaderChange(leader, "make_member", 1).ok).toBe(false);
  });
  it("allows it when another leader exists", () => {
    expect(checkLeaderChange(leader, "make_member", 2).ok).toBe(true);
  });
  it("allows removing members and promoting approved people", () => {
    expect(checkLeaderChange(member, "remove", 1).ok).toBe(true);
    expect(checkLeaderChange(member, "make_leader", 1).ok).toBe(true);
    expect(checkLeaderChange({ role: "member", status: "pending" }, "make_leader", 1).ok).toBe(false);
  });
});

describe("LoginLimiter", () => {
  it("blocks after max failures and unblocks after the window", () => {
    const l = new LoginLimiter(3, 1000);
    l.recordFailure("p", 0);
    l.recordFailure("p", 0);
    expect(l.isBlocked("p", 0)).toBe(false);
    l.recordFailure("p", 0);
    expect(l.isBlocked("p", 10)).toBe(true);
    expect(l.isBlocked("p", 1000)).toBe(false);
  });
  it("reset clears failures", () => {
    const l = new LoginLimiter(1, 1000);
    l.recordFailure("p", 0);
    l.reset("p");
    expect(l.isBlocked("p", 0)).toBe(false);
  });
});
