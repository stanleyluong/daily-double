import { NextResponse } from "next/server";
import { getBoardForDate, isValidBoardKey, todayKey, type Board } from "@/lib/jeopardy";
import { uidFromRequest } from "@/lib/requestAuth";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
// Today's board may still be generated on first load of the day.
export const maxDuration = 60;

// The board a classroom host runs on a projector. Unlike /api/board (which
// returns toPublicBoard — answers stripped), the host marks answers manually,
// so this returns the FULL board WITH answers. That's safe: it's a single
// host-controlled screen, host mode posts no leaderboard score, and /api/scores
// recomputes from server-recorded answers — daily-leaderboard integrity is
// untouched. Auth-gated + rate-limited to match the rest of the app anyway.
export async function GET(request: Request) {
  if (!rateLimit(`host-board:${clientIp(request)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }

  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in to host a board." }, { status: 401 });

  const today = todayKey();
  const date = new URL(request.url).searchParams.get("date") ?? today;
  // custom-/hist- keys have no "future date" notion; only plain dates are
  // capped at today (see /api/board for the full rationale).
  const skipFutureCheck = date.startsWith("custom-") || date.startsWith("hist-");
  if (!isValidBoardKey(date) || (!skipFutureCheck && date > today)) {
    return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  }

  try {
    const board: Board | null = await getBoardForDate(date);
    if (!board) {
      return NextResponse.json({ error: "No board was played on that date." }, { status: 404 });
    }
    return NextResponse.json({ board });
  } catch (error) {
    console.error("Host board fetch failed:", error);
    return NextResponse.json(
      { error: "Couldn't load the board. Try again in a minute." },
      { status: 500 }
    );
  }
}
