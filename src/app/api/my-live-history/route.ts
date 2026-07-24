import { NextResponse } from "next/server";
import { authAdmin } from "@/lib/firebaseAdmin";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { finishedLiveGames } from "@/lib/liveHistory";

export const dynamic = "force-dynamic";

// Recently finished unranked multiplayer games — who you played with, your
// score, and whether you won.
export async function GET(request: Request) {
  if (!rateLimit(`live-history:${clientIp(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const header = request.headers.get("authorization") ?? "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!idToken) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let uid: string;
  try {
    uid = (await authAdmin().verifyIdToken(idToken)).uid;
  } catch {
    return NextResponse.json({ error: "Invalid or expired session." }, { status: 401 });
  }

  try {
    return NextResponse.json({ games: await finishedLiveGames(uid) });
  } catch (error) {
    console.error("live history fetch failed:", error);
    return NextResponse.json({ error: "Couldn't load your game history." }, { status: 500 });
  }
}
