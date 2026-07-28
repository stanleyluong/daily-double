import { describe, it, expect } from "vitest";
import {
  isValidBoardKey,
  isValidDateKey,
  customBoardLabel,
  totalClueCount,
  findClue,
  type Board,
  type Clue,
} from "@/lib/jeopardy";

function clue(id: string, value: number, unrevealed = false): Clue {
  return { id, value, clue: unrevealed ? "" : `clue ${id}`, answer: unrevealed ? "" : `ans ${id}`, acceptable: [], dailyDouble: false, unrevealed };
}

// One category with the $1000 slot marked unrevealed (never aired), plus a
// Final — 4 answerable grid clues + 1 final.
function boardWithGap(): Board {
  return {
    boardId: "b1",
    date: "2000-01-01",
    rounds: [
      {
        name: "Jeopardy!",
        categories: [
          {
            title: "CATS",
            clues: [clue("0-0-0", 200), clue("0-0-1", 400), clue("0-0-2", 600), clue("0-0-3", 800), clue("0-0-4", 1000, true)],
          },
        ],
      },
    ],
    final: { category: "F", clue: "fc", answer: "fa", acceptable: [] },
  };
}

describe("isValidDateKey", () => {
  it("accepts a zero-padded date and rejects everything else", () => {
    expect(isValidDateKey("2026-07-28")).toBe(true);
    expect(isValidDateKey("2026-7-8")).toBe(false);
    expect(isValidDateKey("hist-2026-07-28")).toBe(false);
    expect(isValidDateKey("garbage")).toBe(false);
  });
});

describe("isValidBoardKey", () => {
  it("accepts dates, custom keys, and hist- collision keys", () => {
    expect(isValidBoardKey("2026-07-28")).toBe(true);
    expect(isValidBoardKey("custom-abc123")).toBe(true);
    expect(isValidBoardKey("hist-2026-07-28")).toBe(true);
  });
  it("rejects malformed keys", () => {
    expect(isValidBoardKey("custom-short")).toBe(false); // needs 6+ chars
    expect(isValidBoardKey("custom-abcdef")).toBe(true); // 6 chars ok
    expect(isValidBoardKey("custom-!!")).toBe(false);
    expect(isValidBoardKey("hist-2026-7-8")).toBe(false);
    expect(isValidBoardKey("nope")).toBe(false);
  });
});

describe("customBoardLabel", () => {
  it("prefers a given name", () => {
    expect(customBoardLabel("My Board", ["A", "B"])).toBe("My Board");
  });
  it("falls back to categories, truncating past three", () => {
    expect(customBoardLabel(null, ["A", "B"])).toBe("A · B");
    expect(customBoardLabel(undefined, ["A", "B", "C", "D"])).toBe("A · B · C …");
  });
  it("uses a sensible default when there's nothing", () => {
    expect(customBoardLabel("", [])).toBe("Custom board");
  });
});

describe("unrevealed clues are excluded from play", () => {
  it("totalClueCount ignores unrevealed slots", () => {
    // 4 answerable grid clues + 1 final = 5, not 6.
    expect(totalClueCount(boardWithGap())).toBe(5);
  });
  it("findClue returns null for an unrevealed clue's id", () => {
    expect(findClue(boardWithGap(), "0-0-4")).toBeNull();
    expect(findClue(boardWithGap(), "0-0-0")?.clue.value).toBe(200);
  });
});
