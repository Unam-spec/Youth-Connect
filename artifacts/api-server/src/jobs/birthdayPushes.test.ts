import { describe, it, expect, vi, beforeEach } from "vitest";

const people = vi.fn();
const sent: { ids: string[]; body: string }[] = [];
vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: async () => people() }) }) },
  profilesTable: {},
  attendanceTable: {},
  pushSendLogTable: {},
  autoMessageLogTable: {},
  pendingEmailsTable: {},
  whatsappAutomationSettingsTable: {},
}));
vi.mock("../lib/pushSender", () => ({
  sendPushToProfiles: async (ids: string[], p: { body: string }) => {
    sent.push({ ids, body: p.body });
    return ids.length;
  },
}));
vi.mock("drizzle-orm", () => ({ eq: () => ({}), inArray: () => ({}), sql: () => ({}) }));

import { sendBirthdayPushes } from "./autoMessenger";

const person = (id: string, full_name: string, date_of_birth: string | null) => ({
  id,
  full_name,
  avatar_url: null,
  date_of_birth,
});

beforeEach(() => {
  sent.length = 0;
});

describe("sendBirthdayPushes", () => {
  it("wishes the birthday person and tells everyone else", async () => {
    people.mockReturnValue([
      person("a", "Thabo Mokoena", "2008-10-04"),
      person("b", "Lerato Dube", "2007-03-01"),
      person("c", "Sipho", null),
    ]);
    await sendBirthdayPushes("2026-10-04");
    expect(sent).toEqual([
      { ids: ["a"], body: "Happy birthday, Thabo! From all of us at JG Youth 🎂" },
      { ids: ["b", "c"], body: "It's Thabo Mokoena's birthday today! Wish them a happy birthday 🎉" },
    ]);
  });

  it("sends nothing when it's nobody's birthday", async () => {
    people.mockReturnValue([person("b", "Lerato Dube", "2007-03-01")]);
    expect(await sendBirthdayPushes("2026-10-04")).toBe(0);
    expect(sent).toEqual([]);
  });
});
