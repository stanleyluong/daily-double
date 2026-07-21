import { NextResponse } from "next/server";
import { getBoardForDate, isValidBoardKey, todayKey, toPublicBoard } from "@/lib/jeopardy";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
// First request of the day generates the board (~6 parallel model calls).
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!rateLimit(`board:${clientIp(request)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }

  const today = todayKey();
  const date = new URL(request.url).searchParams.get("date") ?? today;
  // Custom boards have no "future date" notion; only real dates are capped at today.
  if (!isValidBoardKey(date) || (!date.startsWith("custom-") && date > today)) {
    return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  }

  try {
    const board = await getBoardForDate(date);
    if (!board) {
      return NextResponse.json({ error: "No board was played on that date." }, { status: 404 });
    }
    return NextResponse.json(toPublicBoard(board));
  } catch (error) {
    console.error("Board fetch failed:", error);
    return NextResponse.json(
      { error: "Couldn't load the board. Try again in a minute." },
      { status: 500 }
    );
  }
}
