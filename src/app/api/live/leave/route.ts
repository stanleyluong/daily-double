import { NextResponse } from "next/server";
import { leaveGame } from "@/lib/liveGame";
import { uidFromRequest } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

// Explicit leave — marks the player's heartbeat stale so others notice at once.
export async function POST(request: Request) {
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { gameId } = (await request.json()) as { gameId?: string };
    if (!gameId) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    await leaveGame(gameId, uid);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "leave failed" }, { status: 400 });
  }
}
