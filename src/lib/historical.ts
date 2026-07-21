import { db } from "@/lib/firebaseAdmin";

// Browse/search over imported real Jeopardy! episodes (historicalBoards, keyed
// by air date). Read server-side via the Admin SDK. At personal scale a full
// projected scan is well inside Firestore's free read tier; if this ever sees
// real traffic, swap in a category→dates inverted index (one read per search).

const HISTORICAL_BOARDS = "historicalBoards";

export interface HistoricalSummary {
  date: string; // air date, YYYY-MM-DD
  showNumber: number;
  categoryTitles: string[];
}

export async function searchHistorical(query?: string, limit = 150): Promise<HistoricalSummary[]> {
  const snap = await db()
    .collection(HISTORICAL_BOARDS)
    .select("showNumber", "categoryTitles", "categoriesLower")
    .get();

  const q = (query ?? "").trim().toLowerCase();
  const rows: HistoricalSummary[] = [];
  for (const doc of snap.docs) {
    const cats = (doc.get("categoryTitles") as string[] | undefined) ?? [];
    if (q) {
      const lower = (doc.get("categoriesLower") as string[] | undefined) ?? cats.map((c) => c.toLowerCase());
      if (!lower.some((c) => c.includes(q))) continue;
    }
    rows.push({
      date: doc.id,
      showNumber: Number(doc.get("showNumber") ?? 0),
      categoryTitles: cats,
    });
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first
  return rows.slice(0, limit);
}

export async function historicalCount(): Promise<number> {
  const snap = await db().collection(HISTORICAL_BOARDS).count().get();
  return snap.data().count;
}
