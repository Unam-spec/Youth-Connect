import { describe, it, expect } from "vitest";
import { checkinGroupNudgePayload, newFollowUpsPayload, pendingFollowUpsPayload } from "./leaderNudges";

describe("leader nudges", () => {
  it("points the check-in nudge at the group message", () => {
    expect(checkinGroupNudgePayload().url).toBe("/dashboard/follow-ups?send=checkin");
  });
  it("counts people and messages naturally", () => {
    expect(newFollowUpsPayload(1).body).toBe("📨 1 person has been away for weeks. Open Messages to follow up.");
    expect(newFollowUpsPayload(5).body).toBe("📨 5 people have been away for weeks. Open Messages to follow up.");
    expect(pendingFollowUpsPayload(1).body).toContain("1 follow-up message waiting");
    expect(pendingFollowUpsPayload(3).body).toContain("3 follow-up messages waiting");
  });
});
