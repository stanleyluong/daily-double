import { NextResponse } from "next/server";
import { startFinalClue } from "@/lib/liveGame";
import { uidFromRequest } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

// Fired by any client when the wager window closes; opens the final clue.
// Idempotent (no-op unless still in final_wager and ready).
export async function POST(request: Request) {
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { gameId } = (await request.json()) as { gameId?: string };
    if (!gameId) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    await startFinalClue(gameId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't start." },
      { status: 400 }
    );
  }
}
