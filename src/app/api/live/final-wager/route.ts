import { NextResponse } from "next/server";
import { submitFinalWager } from "@/lib/liveGame";
import { uidFromRequest } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { gameId, wager } = (await request.json()) as { gameId?: string; wager?: number };
    if (!gameId || typeof wager !== "number") {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    await submitFinalWager(gameId, uid, wager);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't wager." },
      { status: 400 }
    );
  }
}
