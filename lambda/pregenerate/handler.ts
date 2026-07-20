import { getBoardForDate, todayKey } from "../../src/lib/jeopardy";

// Fires once daily, shortly after midnight Pacific (the same rollover
// todayKey() uses), so the board for the new day is generated and persisted
// before any real visitor's request could trigger cold generation inside
// Amplify's SSR compute — which has a hard response-time cap that board
// generation (two rounds + Final Jeopardy) can exceed, causing a 504 with no
// board saved. getBoardForDate() is idempotent and race-safe (ref.create()
// backs off to whichever writer won), so this is safe to run even if a
// visitor's request beats it, or if the schedule somehow fires twice.
export const handler = async () => {
  const date = todayKey();
  const board = await getBoardForDate(date);
  const result = { date, boardId: board?.boardId, hasFinal: !!board?.final };
  console.log(JSON.stringify(result));
  return result;
};
