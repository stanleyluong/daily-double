import { NextResponse } from "next/server";
import { searchHistorical, type ArchiveKindFilter } from "@/lib/historical";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Browse/search past boards — real Jeopardy! episodes and AI-generated daily
// boards together. Optional ?q= filters by category, ?kind= filters by type
// (all | daily | historical).
export async function GET(request: Request) {
  if (!rateLimit(`historical:${clientIp(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const params = new URL(request.url).searchParams;
  const q = params.get("q") ?? undefined;
  const kindParam = params.get("kind");
  const kind: ArchiveKindFilter = kindParam === "daily" || kindParam === "historical" ? kindParam : "all";
  try {
    return NextResponse.json({ boards: await searchHistorical(q, 150, kind) });
  } catch (error) {
    console.error("historical search failed:", error);
    return NextResponse.json({ error: "Couldn't load episodes." }, { status: 500 });
  }
}
