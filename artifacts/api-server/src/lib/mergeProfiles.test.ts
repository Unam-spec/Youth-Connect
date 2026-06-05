import { describe, it, expect, vi } from "vitest";

// planRsvpMerge is pure, but importing the module pulls in @workspace/db, which
// throws at load without DATABASE_URL. Mock the data layer so the import is safe.
vi.mock("@workspace/db", () => ({
  db: {},
  profilesTable: {},
  attendanceTable: {},
  rsvpsTable: {},
  membershipRequestsTable: {},
  checkInRequestsTable: {},
  leaderPermissionsTable: {},
}));
vi.mock("drizzle-orm", () => ({ eq: () => ({}), inArray: () => ({}) }));

import { planRsvpMerge } from "./mergeProfiles";

describe("planRsvpMerge", () => {
  it("reassigns merge rsvps for events the keep profile has no rsvp for", () => {
    const keep = [{ id: "k1", event_id: "e1" }];
    const merge = [{ id: "m1", event_id: "e2" }];
    expect(planRsvpMerge(keep, merge)).toEqual({ reassignIds: ["m1"], deleteIds: [] });
  });

  it("deletes merge rsvps that collide with an existing keep rsvp on the same event", () => {
    const keep = [{ id: "k1", event_id: "e1" }];
    const merge = [{ id: "m1", event_id: "e1" }, { id: "m2", event_id: "e3" }];
    expect(planRsvpMerge(keep, merge)).toEqual({ reassignIds: ["m2"], deleteIds: ["m1"] });
  });

  it("handles empty inputs", () => {
    expect(planRsvpMerge([], [])).toEqual({ reassignIds: [], deleteIds: [] });
  });
});
