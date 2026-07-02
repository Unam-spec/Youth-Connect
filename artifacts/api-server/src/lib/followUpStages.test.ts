import { describe, expect, it } from "vitest";
import {
  applyTemplateVars,
  defaultFollowUpMessage,
  isStaffRole,
  stageForRole,
  templateTypeForRole,
} from "./followUpStages";

describe("stageForRole", () => {
  it("keeps the member/visitor 2/4/6/8 ladder", () => {
    for (const role of ["member", "visitor"]) {
      expect(stageForRole(role, 0)).toBeNull();
      expect(stageForRole(role, 1)).toBeNull();
      expect(stageForRole(role, 2)).toBe(2);
      expect(stageForRole(role, 3)).toBe(2);
      expect(stageForRole(role, 4)).toBe(4);
      expect(stageForRole(role, 6)).toBe(6);
      expect(stageForRole(role, 8)).toBe(8);
      expect(stageForRole(role, 52)).toBe(8);
    }
  });

  it("uses the stricter 1/2/4 ladder for leaders and super admins", () => {
    for (const role of ["leader", "super_admin"]) {
      expect(stageForRole(role, 0)).toBeNull();
      expect(stageForRole(role, 1)).toBe(1);
      expect(stageForRole(role, 2)).toBe(2);
      expect(stageForRole(role, 3)).toBe(2);
      expect(stageForRole(role, 4)).toBe(4);
      expect(stageForRole(role, 5)).toBe(4);
      expect(stageForRole(role, 52)).toBe(4);
    }
  });

  it("returns null for missing weeks", () => {
    expect(stageForRole("member", null)).toBeNull();
    expect(stageForRole("leader", undefined)).toBeNull();
  });
});

describe("isStaffRole", () => {
  it("is true only for leader and super_admin", () => {
    expect(isStaffRole("leader")).toBe(true);
    expect(isStaffRole("super_admin")).toBe(true);
    expect(isStaffRole("member")).toBe(false);
    expect(isStaffRole("visitor")).toBe(false);
  });
});

describe("templateTypeForRole", () => {
  it("maps each role to its template set", () => {
    expect(templateTypeForRole("member")).toBe("follow_up");
    expect(templateTypeForRole("visitor")).toBe("follow_up");
    expect(templateTypeForRole("leader")).toBe("follow_up_leader");
    expect(templateTypeForRole("super_admin")).toBe("follow_up_super_admin");
  });
});

describe("applyTemplateVars", () => {
  it("substitutes the documented [Square] placeholder form", () => {
    expect(
      applyTemplateVars("Hi [User]! — [Leader]", {
        User: "Thabo",
        Leader: "JG Youth Team",
      }),
    ).toBe("Hi Thabo! — JG Youth Team");
  });

  it("substitutes the legacy {{Curly}} form too", () => {
    expect(
      applyTemplateVars("Hi {{User}}! — {{Leader}}", {
        User: "Thabo",
        Leader: "JG Youth Team",
      }),
    ).toBe("Hi Thabo! — JG Youth Team");
  });

  it("replaces every occurrence and leaves unknown placeholders alone", () => {
    expect(applyTemplateVars("[User] and [User] at [Event]", { User: "T" })).toBe(
      "T and T at [Event]",
    );
  });
});

describe("defaultFollowUpMessage", () => {
  it("gives staff a leadership-toned fallback", () => {
    const msg = defaultFollowUpMessage("leader", 1, "Thabo");
    expect(msg).toContain("Thabo");
    expect(msg).toContain("(1w)");
    expect(msg).toContain("team");
  });

  it("keeps the member fallback wording", () => {
    expect(defaultFollowUpMessage("member", 2, "Karabo")).toBe(
      "Follow-up (2w): Hi Karabo, we miss you at JG Youth!",
    );
  });
});
