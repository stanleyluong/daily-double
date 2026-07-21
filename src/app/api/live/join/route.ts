import { NextResponse } from "next/server";
import { joinGame } from "@/lib/liveGame";
import { uidFromRequest } from "@/lib/requestAuth";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  "no-game": "No game found with that code.",
  "already-started": "That game has already started.",
  "game-full": "That game is full (3 players max).",
};

export async function POST(request: Request) {
  if (!rateLimit(`live-join:${clientIp(request)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in to join a game." }, { status: 401 });

  let code = "";
  let name = "";
  try {
    ({ code = "", name = "" } = (await request.json()) as { code?: string; name?: string });
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  code = code.trim().toUpperCase();
  if (!code) return NextResponse.json({ error: "Enter a game code." }, { status: 400 });

  try {
    const game = await joinGame(code, uid, name);
    return NextResponse.json({ code: game.id });
  } catch (error) {
    const key = error instanceof Error ? error.message : "";
    const status = key === "no-game" ? 404 : 400;
    return NextResponse.json({ error: MESSAGES[key] ?? "Couldn't join the game." }, { status });
  }
}
