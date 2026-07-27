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
  name?: string; // custom only — the creator's title for the board, when given
  categoryTitles: string[];
  createdAt?: string; // ISO timestamp — custom only, since `date` isn't a real date there
}

// Sortable key: `date` is already YYYY-MM-DD for daily/historical, but for
// custom boards it's `custom-{id}` (not chronological) — use createdAt there.
function sortKey(row: HistoricalSummary): string {
  return row.kind === "custom" ? (row.createdAt ?? "") : row.date;
}

export interface HistoricalSearchResult {
  rows: HistoricalSummary[];
  total: number;
}

export interface SearchHistoricalOptions {
  query?: string;
  kind?: ArchiveKindFilter;
  offset?: number;
  limit?: number;
  // Inclusive YYYY-MM-DD bounds, compared against the same `sortKey` used for
  // sorting — so for custom boards (keyed by createdAt, an ISO timestamp)
  // this compares calendar date against timestamp, not two calendar dates.
  dateFrom?: string;
  dateTo?: string;
}

export async function searchHistorical(opts: SearchHistoricalOptions = {}): Promise<HistoricalSearchResult> {
  const { kind = "all", offset = 0, limit = 150, dateFrom, dateTo } = opts;
  const q = (opts.query ?? "").trim().toLowerCase();

  const [historicalSnap, dailySnap, customSnap, dailyBoardIds] = await Promise.all([
    kind === "all" || kind === "historical"
      ? db().collection(HISTORICAL_BOARDS).select("showNumber", "categoryTitles", "categoriesLower").get()
      : null,
    kind === "all" || kind === "daily" ? db().collection(DAILY_BOARDS).select("categoryTitles").get() : null,
    kind === "all" || kind === "custom"
      ? db().collection(CUSTOM_BOARDS).select("name", "categoryTitles", "createdAt").get()
      : null,
    // ID-only, no per-doc read — used below to skip a historical row whose
    // date collides with a daily board's (getBoardForDate always resolves
    // that date to the daily board, so the historical one would be an
    // unreachable duplicate row with the same key). Fetched unconditionally
    // since a `kind=historical` search still needs it even when dailySnap
    // above is skipped.
    db().collection(DAILY_BOARDS).listDocuments(),
  ]);
  const dailyDates = new Set(dailyBoardIds.map((ref) => ref.id));

  const rows: HistoricalSummary[] = [];

  for (const doc of historicalSnap?.docs ?? []) {
    if (dailyDates.has(doc.id)) continue;
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
    const name = (doc.get("name") as string | null | undefined) ?? undefined;
    if (q && !cats.some((c) => c.toLowerCase().includes(q)) && !(name ?? "").toLowerCase().includes(q)) continue;
    const ts = doc.get("createdAt") as FirebaseFirestore.Timestamp | undefined;
    rows.push({
      date: `custom-${doc.id}`,
      kind: "custom",
      name,
      categoryTitles: cats,
      createdAt: ts ? ts.toDate().toISOString() : undefined,
    });
  }

  // Compare by the leading YYYY-MM-DD of `sortKey` (a calendar date for
  // daily/historical, an ISO timestamp for custom) so a bound like "2024-03-01"
  // matches the whole day regardless of which kind produced the row.
  const filtered =
    dateFrom || dateTo
      ? rows.filter((r) => {
          const day = sortKey(r).slice(0, 10);
          if (dateFrom && day < dateFrom) return false;
          if (dateTo && day > dateTo) return false;
          return true;
        })
      : rows;

  filtered.sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : sortKey(a) > sortKey(b) ? -1 : 0)); // newest first
  return { rows: filtered.slice(offset, offset + limit), total: filtered.length };
}

export async function historicalCount(): Promise<number> {
  const snap = await db().collection(HISTORICAL_BOARDS).count().get();
  return snap.data().count;
}
