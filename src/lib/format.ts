export function formatMoney(n: number): string {
  return `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString()}`;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatBoardDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function addDays(dateKey: string, delta: number): string {
  const d = new Date(`${dateKey}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

// Current + longest daily-play streak from a set of dates (YYYY-MM-DD) a user
// has posted a score on. "Current" tolerates today not yet being played (the
// streak is still alive until a day is skipped entirely) but breaks once
// yesterday is also missing.
export function computeStreak(dateKeys: string[], todayKey: string): { current: number; longest: number } {
  const set = new Set(dateKeys);
  if (set.size === 0) return { current: 0, longest: 0 };

  let current = 0;
  const startsToday = set.has(todayKey);
  let cursor = startsToday ? todayKey : addDays(todayKey, -1);
  if (set.has(cursor)) {
    while (set.has(cursor)) {
      current++;
      cursor = addDays(cursor, -1);
    }
  }

  const sorted = [...set].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev !== null && addDays(prev, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }

  return { current, longest: Math.max(longest, current) };
}
