import { NextResponse } from "next/server";
import { startGame } from "@/lib/liveGame";
import { uidFromRequest } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { gameId } = (await request.json()) as { gameId?: string };
    if (!gameId) return NextResponse.json({ error: "Missing game." }, { status: 400 });
    await startGame(gameId, uid);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't start." },
      { status: 400 }
    );
  }
}
