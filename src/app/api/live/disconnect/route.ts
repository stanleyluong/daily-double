import { NextResponse } from "next/server";
import { pauseForDisconnect } from "@/lib/liveGame";
import { uidFromRequest } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

// A connected client reports that another player dropped; auto-pause the game.
// Idempotent, and safe in any mode (an involuntary drop isn't a manual pause).
export async function POST(request: Request) {
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { gameId, droppedUid } = (await request.json()) as { gameId?: string; droppedUid?: string };
    if (!gameId || !droppedUid) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    await pauseForDisconnect(gameId, uid, droppedUid);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed" },
      { status: 400 }
    );
  }
}
