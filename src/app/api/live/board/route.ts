import { NextResponse } from "next/server";
import { getPublicGameBoard } from "@/lib/liveGame";

export const dynamic = "force-dynamic";

// The answer-free board for a live game (a pooled fresh board or the fallback
// daily board). Public — answers are stripped server-side.
export async function GET(request: Request) {
  const gameId = new URL(request.url).searchParams.get("gameId");
  if (!gameId) return NextResponse.json({ error: "Missing game." }, { status: 400 });
  try {
    const board = await getPublicGameBoard(gameId.toUpperCase());
    if (!board) return NextResponse.json({ error: "No board for that game." }, { status: 404 });
    return NextResponse.json(board);
  } catch (error) {
    console.error("live board fetch failed:", error);
    return NextResponse.json({ error: "Couldn't load the board." }, { status: 500 });
  }
}
