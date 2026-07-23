import { NextResponse } from "next/server";
import { topWeeklyScores, weekKeyFor } from "@/lib/scores";
import { todayKey } from "@/lib/jeopardy";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!rateLimit(`weekly-rankings:${clientIp(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  try {
    const weekKey = weekKeyFor(todayKey());
    return NextResponse.json({ weekKey, players: await topWeeklyScores(weekKey, 50) });
  } catch (error) {
    console.error("weekly-rankings fetch failed:", error);
    return NextResponse.json({ error: "Couldn't load weekly rankings." }, { status: 500 });
  }
}
