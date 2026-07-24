import { NextResponse } from "next/server";
import { authAdmin, db } from "@/lib/firebaseAdmin";
import { playedKeys } from "@/lib/played";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Cheap per-account status for the Archive's status column: which boards are
// completed (submitted score) vs merely started (touched, no score yet).
// Two collection reads regardless of how many boards the Archive lists —
// classification happens client-side via Set membership, not a query per row.
export async function GET(request: Request) {
  if (!rateLimit(`board-status:${clientIp(request)}`, 30, 60_000)) {
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
    const [started, scoresSnap] = await Promise.all([
      playedKeys(uid),
      db().collection("users").doc(uid).collection("scores").get(),
    ]);
    return NextResponse.json({
      started: Array.from(started),
      completed: scoresSnap.docs.map((d) => d.id),
    });
  } catch (error) {
    console.error("board-status fetch failed:", error);
    return NextResponse.json({ error: "Couldn't load your progress." }, { status: 500 });
  }
}
