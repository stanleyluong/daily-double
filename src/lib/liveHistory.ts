import { db } from "@/lib/firebaseAdmin";

// Recently finished (unranked) multiplayer games — who you played with and
// how it went. Ranked games are deliberately excluded; those have their own
// win/loss record on /rankings, and this is meant for casual games with
// friends rather than the ladder.

export interface FinishedLive {
  code: string;
  otherPlayerNames: string[];
  myScore: number;
  opponentScores: { name: string; score: number }[];
  result: "win" | "lose" | "tie";
  finishedAt: string | null; // ISO
}

export async function finishedLiveGames(uid: string, limit = 20): Promise<FinishedLive[]> {
  const snap = await db().collection("liveGames").where("playerUids", "array-contains", uid).get();
  const rows: FinishedLive[] = [];
  snap.forEach((d) => {
    const g = d.data();
    if (g.status !== "finished" || g.mode === "ranked") return;

    const players = (g.players as { uid: string; name: string }[] | undefined) ?? [];
    const scores = (g.scores as Record<string, number> | undefined) ?? {};
    const others = players.filter((p) => p.uid !== uid);
    const myScore = scores[uid] ?? 0;
    const opponentScores = others.map((p) => ({ name: p.name, score: scores[p.uid] ?? 0 }));
    const bestOpponent = opponentScores.length > 0 ? Math.max(...opponentScores.map((o) => o.score)) : -Infinity;
    const result: FinishedLive["result"] = myScore > bestOpponent ? "win" : myScore === bestOpponent ? "tie" : "lose";
    const updatedAt = g.updatedAt as FirebaseFirestore.Timestamp | undefined;

    rows.push({
      code: d.id,
      otherPlayerNames: others.map((p) => p.name),
      myScore,
      opponentScores,
      result,
      finishedAt: updatedAt ? updatedAt.toDate().toISOString() : null,
    });
  });
  rows.sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""));
  return rows.slice(0, limit);
}
