import { NextResponse } from "next/server";
import { pauseGame, resumeGame } from "@/lib/liveGame";
import { uidFromRequest } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  "ranked-no-pause": "Ranked games can't be paused.",
  "not-a-player": "You're not in this game.",
  "no-game": "Game not found.",
};

// One endpoint toggles pause: { gameId, paused: boolean }.
export async function POST(request: Request) {
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { gameId, paused } = (await request.json()) as { gameId?: string; paused?: boolean };
    if (!gameId || typeof paused !== "boolean") {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    if (paused) await pauseGame(gameId, uid);
    else await resumeGame(gameId, uid);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const key = error instanceof Error ? error.message : "";
    return NextResponse.json({ error: MESSAGES[key] ?? "Couldn't change pause state." }, { status: 400 });
  }
}
