import { NextResponse } from "next/server";
import { authAdmin } from "@/lib/firebaseAdmin";
import { statsFor } from "@/lib/ranking";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// The caller's own ranked stats (rating/games/wins), or null if they haven't
// played a ranked game.
export async function GET(request: Request) {
  if (!rateLimit(`my-rank:${clientIp(request)}`, 20, 60_000)) {
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
    return NextResponse.json({ stats: await statsFor(uid) });
  } catch (error) {
    console.error("my-rank failed:", error);
    return NextResponse.json({ error: "Couldn't load rank." }, { status: 500 });
  }
}
