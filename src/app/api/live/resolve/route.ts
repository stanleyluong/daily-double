import { NextResponse } from "next/server";
import { resolveClue } from "@/lib/liveGame";
import { uidFromRequest } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

// Any player's client fires this at the buzzer; resolveClue() is idempotent
// (transaction-guarded), so redundant near-simultaneous calls are harmless.
export async function POST(request: Request) {
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { gameId } = (await request.json()) as { gameId?: string };
    if (!gameId) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    await resolveClue(gameId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't resolve." },
      { status: 400 }
    );
  }
}
