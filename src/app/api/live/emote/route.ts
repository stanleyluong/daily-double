import { NextResponse } from "next/server";
import { sendEmote } from "@/lib/liveGame";
import { uidFromRequest } from "@/lib/requestAuth";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!rateLimit(`emote:${clientIp(request)}`, 30, 30_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { gameId, emoji } = (await request.json()) as { gameId?: string; emoji?: string };
    if (!gameId || !emoji) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    await sendEmote(gameId, uid, emoji);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't send that." },
      { status: 400 }
    );
  }
}
