import { db } from "@/lib/firebaseAdmin";
import { answeredCluesForDate, summarize } from "@/lib/answers";

// One unified "everything I've ever played" list — replaces what used to be
// three separate sections (solo in-progress, live in-progress, finished
// multiplayer) with one row per session. Rows are NOT deduped by board: the
// same board played solo one day and again in a live game with a friend
// another day is genuinely two different sessions, so it's two rows. Solo is
// naturally one row per board ever (users/{uid}/playedBoards is a singleton
// per board key); live is one row per game code, so replaying the same board
// in a new live game just creates a new row automatically — no dedup logic
// needed beyond each source already being keyed the way a "session" is.

export type GameKind = "daily" | "historical" | "custom";
export type GameProgress = "in_progress" | "completed";

export interface GameHistoryRow {
  id: string;
  kind: GameKind;
  boardKey: string; // the underlying board's date, or custom-{id}
  liveCode: string | null; // set only for live (multiplayer) rows
  players: string[]; // co-players; empty means solo
  progress: GameProgress;
  createdAt: string | null; // ISO — when this session was first started
  lastPlayedAt: string | null; // ISO — most recent activity
  myScore: number;
  href: string;
}

function kindOf(key: string): GameKind {
  return key.startsWith("custom-") ? "custom" : key < "2026-07-17" ? "historical" : "daily";
}

export async function gameHistory(uid: string): Promise<GameHistoryRow[]> {
  const [playedSnap, scoresSnap, liveSnap] = await Promise.all([
    db().collection("users").doc(uid).collection("playedBoards").get(),
    db().collection("users").doc(uid).collection("scores").get(),
    db().collection("liveGames").where("playerUids", "array-contains", uid).get(),
  ]);

  const scoresByKey = new Map<string, number>();
  scoresSnap.forEach((d) => scoresByKey.set(d.id, Number(d.get("score") ?? 0)));

  const rows: GameHistoryRow[] = [];

  await Promise.all(
    playedSnap.docs.map(async (d) => {
      const boardKey = d.get("boardKey") as string | undefined;
      if (!boardKey) return;
      const firstPlayedAt = d.get("firstPlayedAt") as FirebaseFirestore.Timestamp | undefined;
      const lastPlayedAt = d.get("lastPlayedAt") as FirebaseFirestore.Timestamp | undefined;
      const submittedScore = scoresByKey.get(boardKey);
      const href = boardKey.startsWith("custom-") ? `/custom/${boardKey.slice(7)}` : `/boards/${boardKey}`;
      const myScore =
        submittedScore !== undefined ? submittedScore : summarize(await answeredCluesForDate(uid, boardKey)).score;
      rows.push({
        id: `solo-${boardKey}`,
        kind: kindOf(boardKey),
        boardKey,
        liveCode: null,
        players: [],
        progress: submittedScore !== undefined ? "completed" : "in_progress",
        createdAt: firstPlayedAt ? firstPlayedAt.toDate().toISOString() : null,
        lastPlayedAt: lastPlayedAt ? lastPlayedAt.toDate().toISOString() : null,
        myScore,
        href,
      });
    })
  );

  // Live (unranked only — ranked has its own record on /rankings; lobby-phase
  // excluded — nothing's actually been played there yet).
  liveSnap.forEach((d) => {
    const g = d.data();
    if (g.mode === "ranked") return;
    if (g.status !== "in_progress" && g.status !== "finished") return;
    const boardKey = (g.boardDate as string) ?? "";
    if (!boardKey) return;
    const players = (g.players as { uid: string; name: string }[] | undefined) ?? [];
    const scores = (g.scores as Record<string, number> | undefined) ?? {};
    const createdAt = g.createdAt as FirebaseFirestore.Timestamp | undefined;
    const updatedAt = g.updatedAt as FirebaseFirestore.Timestamp | undefined;
    rows.push({
      id: `live-${d.id}`,
      kind: kindOf(boardKey),
      boardKey,
      liveCode: d.id,
      players: players.filter((p) => p.uid !== uid).map((p) => p.name),
      progress: g.status === "finished" ? "completed" : "in_progress",
      createdAt: createdAt ? createdAt.toDate().toISOString() : null,
      lastPlayedAt: updatedAt ? updatedAt.toDate().toISOString() : null,
      myScore: Number(scores[uid] ?? 0),
      href: `/live/${d.id}`,
    });
  });

  rows.sort((a, b) => (b.lastPlayedAt ?? "").localeCompare(a.lastPlayedAt ?? ""));
  return rows;
}
