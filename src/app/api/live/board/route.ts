import { NextResponse } from "next/server";
import { getPublicGameBoard, setGameBoard } from "@/lib/liveGame";
import { uidFromRequest } from "@/lib/requestAuth";

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

// Host-only, lobby-only: swap in a specific board picked from the Archive or
// freshly generated at /create.
export async function POST(request: Request) {
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { gameId, boardKey } = (await request.json()) as { gameId?: string; boardKey?: string };
    if (!gameId || !boardKey) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    await setGameBoard(gameId, uid, boardKey);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't change the board." },
      { status: 400 }
    );
  }
}
