import { NextResponse } from "next/server";
import { pickUnplayedHistorical } from "@/lib/played";
import { uidFromRequest } from "@/lib/requestAuth";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Returns a random real episode the signed-in user hasn't played yet (falling
// back to any episode once they've played them all), for the Archive's
// "Surprise me" button. No model calls — just a listDocuments + the player's
// played set — so a light rate limit is plenty.
export async function GET(request: Request) {
  if (!rateLimit(`surprise:${clientIp(request)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in to play." }, { status: 401 });

  try {
    const key = await pickUnplayedHistorical(uid);
    if (!key) return NextResponse.json({ error: "No episodes available." }, { status: 404 });
    return NextResponse.json({ key });
  } catch (error) {
    console.error("surprise-board failed:", error);
    return NextResponse.json({ error: "Couldn't pick a board." }, { status: 500 });
  }
}
