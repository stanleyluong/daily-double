import { NextResponse } from "next/server";
import { searchHistorical, type ArchiveKindFilter } from "@/lib/historical";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Browse/search past boards — real Jeopardy! episodes, AI-generated daily
// boards, and user-generated custom boards together. Optional ?q= filters by
// category, ?kind= filters by type (all | daily | historical | custom),
// ?dateFrom=/?dateTo= (YYYY-MM-DD, inclusive) filter by air/creation date,
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
  const dateFromParam = params.get("dateFrom");
  const dateToParam = params.get("dateTo");
  const dateFrom = dateFromParam && DATE_RE.test(dateFromParam) ? dateFromParam : undefined;
  const dateTo = dateToParam && DATE_RE.test(dateToParam) ? dateToParam : undefined;
  try {
    const { rows, total } = await searchHistorical({ query: q, kind, offset, limit: 150, dateFrom, dateTo });
    return NextResponse.json({ boards: rows, total });
  } catch (error) {
    console.error("historical search failed:", error);
    return NextResponse.json({ error: "Couldn't load episodes." }, { status: 500 });
  }
}
