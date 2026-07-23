"use client";

const TOUR_KEY = "daily-double-tour-seen";

export function hasSeenTour(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(TOUR_KEY) === "1";
}

export function markTourSeen(): void {
  if (typeof window !== "undefined") localStorage.setItem(TOUR_KEY, "1");
}

export function resetTour(): void {
  if (typeof window !== "undefined") localStorage.removeItem(TOUR_KEY);
}
