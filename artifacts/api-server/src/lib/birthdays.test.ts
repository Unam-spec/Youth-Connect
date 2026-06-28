import { describe, it, expect } from "vitest";
import { selectBirthdays } from "./birthdays";

const p = (id: string, full_name: string, dob: string | null) => ({
  id,
  full_name,
  avatar_url: null,
  date_of_birth: dob,
});

describe("selectBirthdays", () => {
  const today = "2026-06-29";
  const rows = [
    p("a", "Alice", "2008-06-29"), // today, turning 18
    p("b", "Bob", "2010-07-02"),   // +3, this week
    p("c", "Cara", "2010-07-05"),  // +6, this week
    p("d", "Dan", "2010-07-06"),   // +7, NOT this week
    p("e", "Eve", null),           // no dob, excluded
    p("f", "Fin", "1999-06-29"),   // today, turning 27
  ];

  it("buckets today vs this-week and excludes no-dob / out-of-range", () => {
    const out = selectBirthdays(rows, today);
    expect(out.today.map((x) => x.id)).toEqual(["a", "f"]);
    expect(out.this_week.map((x) => x.id)).toEqual(["b", "c"]);
  });

  it("computes age_turning", () => {
    const out = selectBirthdays(rows, today);
    expect(out.today.find((x) => x.id === "a")?.age_turning).toBe(18);
    expect(out.this_week.find((x) => x.id === "b")?.age_turning).toBe(16);
  });

  it("sorts today by name and this_week by days then name", () => {
    const out = selectBirthdays(rows, today);
    expect(out.today.map((x) => x.full_name)).toEqual(["Alice", "Fin"]);
    expect(out.this_week.map((x) => x.full_name)).toEqual(["Bob", "Cara"]);
  });
});
