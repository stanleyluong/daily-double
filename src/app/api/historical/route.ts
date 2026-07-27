import { NextResponse } from "next/server";
import { searchHistorical, type ArchiveKindFilter } from "@/lib/historical";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Browse/search past boards — real Jeopardy! episodes, AI-generated daily
// boards, and user-generated custom boards together. Optional ?q= filters by
// category, ?kind= filters by type (all | daily | historical | custom),
// ?offset= pages through results 150 at a time (see `total` in the response).
export async function GET(request: Request) {
  if (!rateLimit(`historical:${clientIp(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const params = new URL(request.url).searchParams;
  const q = params.get("q") ?? undefined;
  const kindParam = params.get("kind");
  const kind: ArchiveKindFilter =
    kindParam === "daily" || kindParam === "historical" || kindParam === "custom" ? kindParam : "all";
  const offset = Math.max(0, parseInt(params.get("offset") ?? "0", 10) || 0);
  try {
    const { rows, total } = await searchHistorical(q, kind, offset, 150);
    return NextResponse.json({ boards: rows, total });
  } catch (error) {
    console.error("historical search failed:", error);
    return NextResponse.json({ error: "Couldn't load episodes." }, { status: 500 });
  }
}
