import { NextResponse } from "next/server";
import { updateLobbySettings } from "@/lib/liveGame";
import { uidFromRequest } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { gameId, answerMs, scoringMode, pickMode } = (await request.json()) as {
      gameId?: string;
      answerMs?: number;
      scoringMode?: string;
      pickMode?: string;
    };
    if (!gameId) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    await updateLobbySettings(gameId, uid, {
      answerMs,
      scoringMode: scoringMode as "all_correct" | "winner_only" | undefined,
      pickMode: pickMode as "winner" | "alternating" | "loser" | undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't update settings." },
      { status: 400 }
    );
  }
}
