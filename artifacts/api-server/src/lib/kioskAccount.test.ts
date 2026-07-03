import { describe, it, expect } from "vitest";
import { usernameFromName, usernameCandidates, generatePin } from "./kioskAccount";
import { validateUsername } from "./username";
import { validatePin } from "./pin";

describe("usernameFromName", () => {
  it("slugifies a full name to a valid username base", () => {
    expect(usernameFromName("Thandi Khumalo")).toBe("thandi_khumalo");
  });

  it("strips accents and punctuation", () => {
    expect(usernameFromName("Léa-Marie O'Neil")).toBe("leamarie_oneil");
  });

  it("caps at 20 characters and stays valid", () => {
    const u = usernameFromName("Bartholomew Montgomery Fitzgerald");
    expect(u.length).toBeLessThanOrEqual(20);
    expect(validateUsername(u).ok).toBe(true);
  });

  it("pads very short or empty names to a valid username", () => {
    for (const name of ["Al", "李", ""]) {
      const u = usernameFromName(name);
      expect(validateUsername(u).ok).toBe(true);
    }
  });
});

describe("usernameCandidates", () => {
  it("yields the base first, then numeric suffixes", () => {
    const gen = usernameCandidates("thandi_khumalo");
    expect(gen.next().value).toBe("thandi_khumalo");
    expect(gen.next().value).toBe("thandi_khumalo2");
    expect(gen.next().value).toBe("thandi_khumalo3");
  });

  it("trims a max-length base so suffixed candidates stay within 20 chars and valid", () => {
    const gen = usernameCandidates("abcdefghij_klmnopqrs"); // 20 chars
    const first = gen.next().value as string;
    const second = gen.next().value as string;
    expect(first.length).toBeLessThanOrEqual(20);
    expect(second.length).toBeLessThanOrEqual(20);
    expect(second.endsWith("2")).toBe(true);
    expect(validateUsername(second).ok).toBe(true);
  });
});

describe("generatePin", () => {
  it("always produces a 4-digit PIN accepted by validatePin", () => {
    for (let i = 0; i < 50; i++) {
      const pin = generatePin();
      expect(pin).toMatch(/^\d{4}$/);
      expect(validatePin(pin).ok).toBe(true);
    }
  });
});
