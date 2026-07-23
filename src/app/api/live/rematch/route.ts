import { NextResponse } from "next/server";
import { createRematch } from "@/lib/liveGame";
import { uidFromRequest } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { gameId } = (await request.json()) as { gameId?: string };
    if (!gameId) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const code = await createRematch(gameId, uid);
    return NextResponse.json({ code });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't start a rematch." },
      { status: 400 }
    );
  }
}
