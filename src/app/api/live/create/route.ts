import { NextResponse } from "next/server";
import { createGame } from "@/lib/liveGame";
import { isValidBoardKey } from "@/lib/jeopardy";
import { uidFromRequest } from "@/lib/requestAuth";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!rateLimit(`live-create:${clientIp(request)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in to start a game." }, { status: 401 });

  let name = "";
  let mode: "normal" | "ranked" = "normal";
  let boardKey: string | undefined;
  try {
    const body = (await request.json()) as { name?: string; mode?: string; boardKey?: string };
    name = body.name ?? "";
    if (body.mode === "ranked") mode = "ranked";
    if (typeof body.boardKey === "string" && body.boardKey) {
      // Accept "pool", a date, or a custom key; ignore anything else.
      if (body.boardKey === "pool" || isValidBoardKey(body.boardKey)) boardKey = body.boardKey;
    }
  } catch {
    /* all optional */
  }

  try {
    const code = await createGame(uid, name, mode, boardKey);
    return NextResponse.json({ code });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't create the game." },
      { status: 400 }
    );
  }
}
