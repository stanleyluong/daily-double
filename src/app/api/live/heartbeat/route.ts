import { NextResponse } from "next/server";
import { heartbeat } from "@/lib/liveGame";
import { uidFromRequest } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

// Presence ping. Fired every few seconds by each client in a running game.
export async function POST(request: Request) {
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { gameId } = (await request.json()) as { gameId?: string };
    if (!gameId) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    await heartbeat(gameId, uid);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "heartbeat failed" }, { status: 400 });
  }
}
