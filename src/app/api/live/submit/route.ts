import { NextResponse } from "next/server";
import { submitAnswer } from "@/lib/liveGame";
import { uidFromRequest } from "@/lib/requestAuth";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!rateLimit(`live-submit:${clientIp(request)}`, 60, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { gameId, clueId, answer } = (await request.json()) as {
      gameId?: string;
      clueId?: string;
      answer?: string;
    };
    if (!gameId || !clueId || typeof answer !== "string") {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    await submitAnswer(gameId, uid, clueId, answer);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't submit." },
      { status: 400 }
    );
  }
}
