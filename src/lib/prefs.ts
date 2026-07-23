"use client";

// Client-only gameplay preferences, stored in localStorage (per browser).

export const AUTO_ADVANCE_KEY = "dd-auto-advance";

// After answering a clue and returning to the board:
//   off      — keep focus on the clue you just answered
//   value    — jump to the next unanswered clue of the same value (same row)
//   category — jump to the next unanswered clue in the same category (column)
export type AutoAdvance = "off" | "value" | "category";

export function readAutoAdvance(): AutoAdvance {
  if (typeof window === "undefined") return "off";
  const v = window.localStorage.getItem(AUTO_ADVANCE_KEY);
  return v === "value" || v === "category" ? v : "off";
}

export function writeAutoAdvance(v: AutoAdvance): void {
  if (typeof window !== "undefined") window.localStorage.setItem(AUTO_ADVANCE_KEY, v);
}
