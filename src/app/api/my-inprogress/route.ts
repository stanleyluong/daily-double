import { NextResponse } from "next/server";
import { authAdmin } from "@/lib/firebaseAdmin";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { inProgressLive, inProgressSolo } from "@/lib/inProgress";

export const dynamic = "force-dynamic";

// Games this account started but hasn't finished — single-player boards with
// answers but no submitted score, and unranked live games still in progress.
export async function GET(request: Request) {
  if (!rateLimit(`inprogress:${clientIp(request)}`, 30, 60_000)) {
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
    // Live first — its resolved board keys are excluded from solo so a board
    // being played in an active multiplayer match doesn't also show as a
    // separate (likely 0-answered) solo row for the same board.
    const live = await inProgressLive(uid);
    const solo = await inProgressSolo(uid, new Set(live.map((g) => g.boardKey)));
    return NextResponse.json({ solo, live });
  } catch (error) {
    console.error("in-progress fetch failed:", error);
    return NextResponse.json({ error: "Couldn't load in-progress games." }, { status: 500 });
  }
}
