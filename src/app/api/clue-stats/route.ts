import { NextResponse } from "next/server";
import { isValidBoardKey } from "@/lib/jeopardy";
import { clueStatsForBoard } from "@/lib/answers";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Board-wide per-clue difficulty: how many players got each clue right, so
// the post-game recap can show "62% got this right." No auth required — this
// is aggregate, non-identifying data, same visibility as the leaderboard.
export async function GET(request: Request) {
  if (!rateLimit(`clue-stats:${clientIp(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const boardKey = new URL(request.url).searchParams.get("boardKey");
  if (!boardKey || !isValidBoardKey(boardKey)) {
    return NextResponse.json({ error: "Invalid board key." }, { status: 400 });
  }
  try {
    const stats = await clueStatsForBoard(boardKey);
    return NextResponse.json({ stats });
  } catch (error) {
    console.error("Clue stats fetch failed:", error);
    return NextResponse.json({ error: "Couldn't load clue stats." }, { status: 500 });
  }
}
