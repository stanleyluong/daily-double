import { db } from "@/lib/firebaseAdmin";
import { answeredCluesForDate } from "@/lib/answers";

// "Resume" data: games this account started but hasn't finished — single-player
// boards with answers but no submitted score, and unranked live games still in
// progress. All server-side (Admin SDK); the /me page fetches it.

export interface InProgressSolo {
  boardKey: string;
  kind: "daily" | "historical" | "custom";
  answered: number;
}

export interface InProgressLive {
  code: string;
  boardDate: string;
  boardKey: string; // resolved playedBoards key (g.boardId ?? g.boardDate) — used to dedupe against solo
  players: number;
}

function kindOf(key: string): InProgressSolo["kind"] {
  // custom-*, pre-launch dates are real episodes, else daily.
  return key.startsWith("custom-") ? "custom" : key < "2026-07-17" ? "historical" : "daily";
}

// `excludeKeys` is the set of boardKeys already shown as a live game row
// (same board, so it'd otherwise appear twice). Every other played-but-not-
// submitted board is included, even with 0 answered clues — a board can get
// marked "played" by markPlayed() before an answer is ever recorded (e.g. the
// judge API failed on the first attempt), and that's still worth surfacing as
// resumable rather than silently disappearing.
export async function inProgressSolo(
  uid: string,
  excludeKeys: Set<string> = new Set()
): Promise<InProgressSolo[]> {
  // Candidates: boards played but not submitted. playedBoards is one cheap doc
  // per board (vs. scanning every answered clue).
  const [played, scores] = await Promise.all([
    db().collection("users").doc(uid).collection("playedBoards").get(),
    db().collection("users").doc(uid).collection("scores").get(),
  ]);
  const submitted = new Set(scores.docs.map((d) => d.id));
  const candidates = played.docs
    .map((d) => d.get("boardKey") as string)
    .filter((k) => k && !submitted.has(k) && !excludeKeys.has(k));

  const rows: InProgressSolo[] = await Promise.all(
    candidates.map(async (boardKey) => {
      const answered = (await answeredCluesForDate(uid, boardKey)).length;
      return { boardKey, kind: kindOf(boardKey), answered };
    })
  );
  rows.sort((a, b) => (a.boardKey < b.boardKey ? 1 : -1)); // newest-ish first
  return rows;
}

export async function inProgressLive(uid: string): Promise<InProgressLive[]> {
  const snap = await db().collection("liveGames").where("playerUids", "array-contains", uid).get();
  const rows: InProgressLive[] = [];
  snap.forEach((d) => {
    const g = d.data();
    if (g.status === "in_progress" && g.mode !== "ranked") {
      const boardDate = (g.boardDate as string) ?? "";
      rows.push({
        code: d.id,
        boardDate,
        boardKey: (g.boardId as string) || boardDate,
        players: (g.playerUids ?? []).length,
      });
    }
  });
  return rows;
}
