import { describe, it, expect } from "vitest";
import { computeStreak, formatBoardDate } from "@/lib/format";

describe("formatBoardDate", () => {
  it("formats a plain date key", () => {
    expect(formatBoardDate("2026-07-28")).toContain("July 28, 2026");
  });

  it("strips a hist- collision prefix and formats the real date", () => {
    // The regression the hist- work introduced: a prefixed key must render the
    // same human date as the bare one, not 'Invalid Date'.
    expect(formatBoardDate("hist-2026-07-28")).toBe(formatBoardDate("2026-07-28"));
  });
});

describe("computeStreak", () => {
  it("is zero for no plays", () => {
    expect(computeStreak([], "2026-07-28")).toEqual({ current: 0, longest: 0 });
  });

  it("counts consecutive days ending today", () => {
    const dates = ["2026-07-28", "2026-07-27", "2026-07-26"];
    expect(computeStreak(dates, "2026-07-28")).toEqual({ current: 3, longest: 3 });
  });

  it("keeps the current streak alive when today isn't played yet but yesterday was", () => {
    const dates = ["2026-07-27", "2026-07-26"];
    expect(computeStreak(dates, "2026-07-28").current).toBe(2);
  });

  it("breaks the current streak on a gap but still reports the longest past run", () => {
    const dates = ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-28"];
    const { current, longest } = computeStreak(dates, "2026-07-28");
    expect(current).toBe(1); // only today
    expect(longest).toBe(3); // the July 1–3 run
  });
});
