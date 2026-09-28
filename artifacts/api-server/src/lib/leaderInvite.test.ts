import { describe, it, expect } from "vitest";
import { buildLeaderInviteMessage } from "./leaderInvite";

describe("buildLeaderInviteMessage", () => {
  const base = { phone: "+27821234567", pin: "4829", appUrl: "https://jgyouth.site" };

  it("greets by first name and includes link, phone and PIN", () => {
    const msg = buildLeaderInviteMessage({ ...base, fullName: "Thabo Mokoena" });
    expect(msg.startsWith("Hi Thabo!")).toBe(true);
    expect(msg).toContain("https://jgyouth.site/leader-login");
    expect(msg).toContain("+27821234567");
    expect(msg).toContain("PIN 4829");
    expect(msg).toContain("Add to Home Screen");
  });

  it("falls back to a neutral greeting without a name", () => {
    expect(buildLeaderInviteMessage({ ...base, fullName: null }).startsWith("Hi there!")).toBe(true);
    expect(buildLeaderInviteMessage({ ...base, fullName: "   " }).startsWith("Hi there!")).toBe(true);
  });
});
