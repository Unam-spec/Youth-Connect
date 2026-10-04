import { describe, it, expect } from "vitest";
import {
  normalizeKey,
  normalizeWorshipPhone,
  normalizeInstruments,
  validateSongInput,
  canApprove,
  canEditSong,
  checkMemberChange,
  LoginLimiter,
  validateSetlistInput,
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

describe("canApprove", () => {
  it("lets the head leader and leaders accept requests, not members", () => {
    expect(canApprove({ role: "owner" })).toBe(true);
    expect(canApprove({ role: "leader" })).toBe(true);
    expect(canApprove({ role: "member" })).toBe(false);
  });
});

describe("canEditSong", () => {
  it("lets the head leader edit anything and others only their own", () => {
    expect(canEditSong({ id: "a", role: "owner" }, { created_by: "b" })).toBe(true);
    expect(canEditSong({ id: "a", role: "leader" }, { created_by: "b" })).toBe(false);
    expect(canEditSong({ id: "a", role: "member" }, { created_by: "a" })).toBe(true);
    expect(canEditSong({ id: "a", role: "member" }, { created_by: null })).toBe(false);
  });
});

describe("checkMemberChange", () => {
  const owner = { role: "owner", status: "approved" };
  const leader = { role: "leader", status: "approved" };
  const member = { role: "member", status: "approved" };
  it("never changes or removes the head leader", () => {
    expect(checkMemberChange(owner, "remove").ok).toBe(false);
    expect(checkMemberChange(owner, "make_member").ok).toBe(false);
  });
  it("allows promoting, demoting and removing others", () => {
    expect(checkMemberChange(member, "make_leader").ok).toBe(true);
    expect(checkMemberChange(leader, "make_member").ok).toBe(true);
    expect(checkMemberChange(leader, "remove").ok).toBe(true);
  });
  it("only promotes approved people", () => {
    expect(checkMemberChange({ role: "member", status: "pending" }, "make_leader").ok).toBe(false);
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

describe("validateSetlistInput", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  it("accepts a valid setlist and normalizes keys", () => {
    const r = validateSetlistInput({
      service_date: "2026-10-11",
      title: " Youth Sunday ",
      songs: [{ song_id: A, lead_id: B, song_key: "g" }, { song_id: B }],
    });
    expect(r).toEqual({
      ok: true,
      value: {
        service_date: "2026-10-11",
        title: "Youth Sunday",
        notes: null,
        songs: [
          { song_id: A, lead_id: B, song_key: "G" },
          { song_id: B, lead_id: null, song_key: null },
        ],
      },
    });
  });
  it("rejects bad dates, empty lists and duplicates", () => {
    expect(validateSetlistInput({ service_date: "2026-02-30", songs: [{ song_id: A }] }).ok).toBe(false);
    expect(validateSetlistInput({ service_date: "2026-10-11", songs: [] }).ok).toBe(false);
    expect(validateSetlistInput({ service_date: "2026-10-11", songs: [{ song_id: A }, { song_id: A }] }).ok).toBe(false);
    expect(validateSetlistInput({ service_date: "2026-10-11", songs: [{ song_id: "x" }] }).ok).toBe(false);
  });
});
