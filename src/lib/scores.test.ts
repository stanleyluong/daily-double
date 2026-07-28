import { describe, it, expect } from "vitest";
import { weekKeyFor } from "@/lib/scores";

describe("weekKeyFor", () => {
  it("produces a YYYY-Www key", () => {
    expect(weekKeyFor("2026-07-28")).toMatch(/^\d{4}-W\d{2}$/);
  });

  it("groups Monday and Tuesday of the same ISO week together", () => {
    // 2026-07-27 is a Monday, 2026-07-28 a Tuesday — same ISO week.
    expect(weekKeyFor("2026-07-27")).toBe(weekKeyFor("2026-07-28"));
  });

  it("puts the preceding Sunday in the previous ISO week", () => {
    // ISO weeks run Mon–Sun, so 2026-07-26 (Sunday) ends the prior week.
    expect(weekKeyFor("2026-07-26")).not.toBe(weekKeyFor("2026-07-27"));
  });
});
