import { NextResponse } from "next/server";
import { getGame } from "@/lib/liveGame";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Read-only, no-auth game state for spectators — polled instead of a live
// Firestore listener (which requires playerUids membership under the current
// security rules). The game doc is already client-safe as-is (no answer text
// outside `reveal`, same as what players see), so this is a plain passthrough.
export async function GET(request: Request) {
  if (!rateLimit(`spectate:${clientIp(request)}`, 60, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const code = new URL(request.url).searchParams.get("code")?.toUpperCase();
  if (!code) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    const game = await getGame(code);
    if (!game) return NextResponse.json({ error: "Game not found." }, { status: 404 });
    return NextResponse.json({ game });
  } catch (error) {
    console.error("Spectate fetch failed:", error);
    return NextResponse.json({ error: "Couldn't load the game." }, { status: 500 });
  }
}
