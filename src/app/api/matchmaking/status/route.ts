import { NextResponse } from "next/server";
import { getMatch, myQueueStatus } from "@/lib/matchmaking";
import { uidFromRequest } from "@/lib/requestAuth";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Poll target: queue state, and (once matched) the match's ready-check state.
export async function GET(request: Request) {
  if (!rateLimit(`mm-status:${clientIp(request)}`, 60, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const queue = await myQueueStatus(uid);
  if (queue.state !== "matched" || !queue.matchId) return NextResponse.json({ queue, match: null });
  const match = await getMatch(queue.matchId);
  return NextResponse.json({ queue, match });
}
