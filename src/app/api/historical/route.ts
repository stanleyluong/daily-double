import { NextResponse } from "next/server";
import { searchHistorical } from "@/lib/historical";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Browse/search real Jeopardy! episodes. Optional ?q= filters by category.
export async function GET(request: Request) {
  if (!rateLimit(`historical:${clientIp(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const q = new URL(request.url).searchParams.get("q") ?? undefined;
  try {
    return NextResponse.json({ boards: await searchHistorical(q) });
  } catch (error) {
    console.error("historical search failed:", error);
    return NextResponse.json({ error: "Couldn't load episodes." }, { status: 500 });
  }
}
