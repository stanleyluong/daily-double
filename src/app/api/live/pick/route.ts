import { NextResponse } from "next/server";
import { pickClue } from "@/lib/liveGame";
import { uidFromRequest } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { gameId, clueId } = (await request.json()) as { gameId?: string; clueId?: string };
    if (!gameId || !clueId) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    await pickClue(gameId, uid, clueId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't pick that clue." },
      { status: 400 }
    );
  }
}
