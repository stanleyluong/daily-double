import { db } from "@/lib/firebaseAdmin";

// Browse/search over every playable past board: real Jeopardy! episodes
// (historicalBoards, keyed by air date), AI-generated daily boards
// (jeopardyBoards, keyed by the date they ran), and custom boards anyone has
// generated (customBoards, keyed by a random id — no natural date, so they
// sort/display by createdAt instead). Read server-side via the Admin SDK. At
// personal scale a full projected scan of all three collections is well
// inside Firestore's free read tier; if this ever sees real traffic, swap in
// a category→dates inverted index (one read per search).

const HISTORICAL_BOARDS = "historicalBoards";
const DAILY_BOARDS = "jeopardyBoards";
const CUSTOM_BOARDS = "customBoards";

export type ArchiveKind = "daily" | "historical" | "custom";
export type ArchiveKindFilter = "all" | ArchiveKind;

export interface HistoricalSummary {
  date: string; // sort/URL key: YYYY-MM-DD (daily/historical) or custom-{id} (custom)
  kind: ArchiveKind;
  showNumber?: number; // historical only
  categoryTitles: string[];
  createdAt?: string; // ISO timestamp — custom only, since `date` isn't a real date there
}

// Sortable key: `date` is already YYYY-MM-DD for daily/historical, but for
// custom boards it's `custom-{id}` (not chronological) — use createdAt there.
function sortKey(row: HistoricalSummary): string {
  return row.kind === "custom" ? (row.createdAt ?? "") : row.date;
}

export async function searchHistorical(
  query?: string,
  limit = 150,
  kind: ArchiveKindFilter = "all"
): Promise<HistoricalSummary[]> {
  const q = (query ?? "").trim().toLowerCase();

  const [historicalSnap, dailySnap, customSnap] = await Promise.all([
    kind === "all" || kind === "historical"
      ? db().collection(HISTORICAL_BOARDS).select("showNumber", "categoryTitles", "categoriesLower").get()
      : null,
    kind === "all" || kind === "daily" ? db().collection(DAILY_BOARDS).select("categoryTitles").get() : null,
    kind === "all" || kind === "custom"
      ? db().collection(CUSTOM_BOARDS).select("categoryTitles", "createdAt").get()
      : null,
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

  for (const doc of customSnap?.docs ?? []) {
    const cats = (doc.get("categoryTitles") as string[] | undefined) ?? [];
    if (q && !cats.some((c) => c.toLowerCase().includes(q))) continue;
    const ts = doc.get("createdAt") as FirebaseFirestore.Timestamp | undefined;
    rows.push({
      date: `custom-${doc.id}`,
      kind: "custom",
      categoryTitles: cats,
      createdAt: ts ? ts.toDate().toISOString() : undefined,
    });
  }

  rows.sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : sortKey(a) > sortKey(b) ? -1 : 0)); // newest first
  return rows.slice(0, limit);
}

export async function historicalCount(): Promise<number> {
  const snap = await db().collection(HISTORICAL_BOARDS).count().get();
  return snap.data().count;
}
