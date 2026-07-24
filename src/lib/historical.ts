import { db } from "@/lib/firebaseAdmin";

// Browse/search over every playable past board: real Jeopardy! episodes
// (historicalBoards, keyed by air date) and AI-generated daily boards
// (jeopardyBoards, keyed by the date they ran). Read server-side via the
// Admin SDK. At personal scale a full projected scan of both collections is
// well inside Firestore's free read tier; if this ever sees real traffic,
// swap in a category→dates inverted index (one read per search).

const HISTORICAL_BOARDS = "historicalBoards";
const DAILY_BOARDS = "jeopardyBoards";

export type ArchiveKind = "daily" | "historical";
export type ArchiveKindFilter = "all" | ArchiveKind;

export interface HistoricalSummary {
  date: string; // air date (historical) or generation date (daily), YYYY-MM-DD
  kind: ArchiveKind;
  showNumber?: number; // historical only
  categoryTitles: string[];
}

export async function searchHistorical(
  query?: string,
  limit = 150,
  kind: ArchiveKindFilter = "all"
): Promise<HistoricalSummary[]> {
  const q = (query ?? "").trim().toLowerCase();

  const [historicalSnap, dailySnap] = await Promise.all([
    kind === "daily"
      ? null
      : db().collection(HISTORICAL_BOARDS).select("showNumber", "categoryTitles", "categoriesLower").get(),
    kind === "historical" ? null : db().collection(DAILY_BOARDS).select("categoryTitles").get(),
  ]);

  const rows: HistoricalSummary[] = [];

  for (const doc of historicalSnap?.docs ?? []) {
    const cats = (doc.get("categoryTitles") as string[] | undefined) ?? [];
    if (q) {
      const lower = (doc.get("categoriesLower") as string[] | undefined) ?? cats.map((c) => c.toLowerCase());
      if (!lower.some((c) => c.includes(q))) continue;
    }
    rows.push({
      date: doc.id,
      kind: "historical",
      showNumber: Number(doc.get("showNumber") ?? 0),
      categoryTitles: cats,
    });
  }

  for (const doc of dailySnap?.docs ?? []) {
    const cats = (doc.get("categoryTitles") as string[] | undefined) ?? [];
    if (q && !cats.some((c) => c.toLowerCase().includes(q))) continue;
    rows.push({ date: doc.id, kind: "daily", categoryTitles: cats });
  }

  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first
  return rows.slice(0, limit);
}

export async function historicalCount(): Promise<number> {
  const snap = await db().collection(HISTORICAL_BOARDS).count().get();
  return snap.data().count;
}
