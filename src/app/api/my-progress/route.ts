import { NextResponse } from "next/server";
import { isValidDateKey, todayKey } from "@/lib/jeopardy";
import { answeredCluesForDate, summarize } from "@/lib/answers";
import { hasSubmittedScore } from "@/lib/scores";
import { authAdmin } from "@/lib/firebaseAdmin";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// The server-authoritative "what have I actually played today" view, keyed
// purely by account + date — independent of any browser's localStorage.
// Game.tsx calls this on load (once signed in) and treats the response as
// truth, overwriting whatever the local cache says. That's what makes the
// board correct on a new device, a different browser, after localStorage is
// cleared, or after a manual admin-side data fix — all of which previously
// left the client showing a stale or blank view of a genuinely-played board.
export async function GET(request: Request) {
  if (!rateLimit(`my-progress:${clientIp(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }

  const date = new URL(request.url).searchParams.get("date") ?? todayKey();
  if (!isValidDateKey(date)) {
    return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  }

  const header = request.headers.get("authorization") ?? "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!idToken) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let uid: string;
  try {
    uid = (await authAdmin().verifyIdToken(idToken)).uid;
  } catch {
    return NextResponse.json({ error: "Invalid or expired session." }, { status: 401 });
  }

  try {
    const [clues, submitted] = await Promise.all([
      answeredCluesForDate(uid, date),
      hasSubmittedScore(date, uid),
    ]);

    const results: Record<
      string,
      { outcome: string; correctAnswer: string; comment: string; playerAnswer?: string; pointValue: number }
    > = {};
    for (const c of clues) {
      results[c.clueId] = {
        outcome: c.outcome,
        correctAnswer: c.correctAnswer,
        comment: c.comment,
        playerAnswer: c.playerAnswer,
        pointValue: c.pointValue,
      };
    }

    return NextResponse.json({ results, score: summarize(clues).score, submitted });
  } catch (error) {
    console.error("Progress fetch failed:", error);
    return NextResponse.json({ error: "Couldn't load your progress." }, { status: 500 });
  }
}
