import { NextResponse } from "next/server";
import { getDailyBoard, toPublicBoard } from "@/lib/jeopardy";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
// First request of the day generates the board (~6 parallel model calls).
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!rateLimit(`board:${clientIp(request)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  try {
    const board = await getDailyBoard();
    return NextResponse.json(toPublicBoard(board));
  } catch (error) {
    console.error("Board generation failed:", error);
    return NextResponse.json(
      { error: "Couldn't build today's board. Try again in a minute." },
      { status: 500 }
    );
  }
}
