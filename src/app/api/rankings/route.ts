import { NextResponse } from "next/server";
import { topRanked } from "@/lib/ranking";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Public ranked leaderboard. Read server-side (Admin SDK), so rankedStats
// needs no client-read security rule.
export async function GET(request: Request) {
  if (!rateLimit(`rankings:${clientIp(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  try {
    return NextResponse.json({ players: await topRanked(50) });
  } catch (error) {
    console.error("rankings fetch failed:", error);
    return NextResponse.json({ error: "Couldn't load rankings." }, { status: 500 });
  }
}
