import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebaseAdmin";
import { STARTING_RATING, type RankedStats } from "@/lib/liveTypes";

// Elo, adapted for a 2–3 player free-for-all. A finished ranked game is
// scored as every pairwise matchup: the player with the higher final score
// "beat" the other (a tie splits 0.5/0.5). Each player's rating delta is the
// sum of their pairwise Elo changes. This is the standard, explainable way to
// stretch 1v1 Elo over a small free-for-all without a bespoke system.
const K = 24;
const STATS = "rankedStats";

function expected(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

interface Standing {
  uid: string;
  score: number;
  rating: number;
}

// Pure: given each player's current rating and final score, return the new
// rating for each uid. Exported so it can be unit-checked in isolation.
export function computeRatingChanges(standings: Standing[]): Record<string, number> {
  const next: Record<string, number> = {};
  for (const p of standings) next[p.uid] = p.rating;

  for (let i = 0; i < standings.length; i++) {
    for (let j = i + 1; j < standings.length; j++) {
      const a = standings[i];
      const b = standings[j];
      const sa = a.score > b.score ? 1 : a.score < b.score ? 0 : 0.5;
      next[a.uid] += K * (sa - expected(a.rating, b.rating));
      next[b.uid] += K * (1 - sa - expected(b.rating, a.rating));
    }
  }
  for (const uid of Object.keys(next)) next[uid] = Math.round(next[uid]);
  return next;
}

function statsRef(uid: string) {
  return db().collection(STATS).doc(uid);
}

function fromDoc(uid: string, data: FirebaseFirestore.DocumentData | undefined): RankedStats {
  return {
    uid,
    name: data?.name ?? "Player",
    rating: data?.rating ?? STARTING_RATING,
    games: data?.games ?? 0,
    wins: data?.wins ?? 0,
    bestScore: data?.bestScore ?? 0,
    updatedAt: data?.updatedAt ?? undefined,
  };
}

// Applies ranking to a finished ranked game exactly once. Guarded by the
// game's `rated` flag inside the transaction, so concurrent/duplicate calls
// (e.g. two clients hitting "continue" into the finish) apply it a single
// time. No-op unless the game is ranked, finished, and unrated.
export async function applyRankedResults(gameId: string): Promise<void> {
  const gameRef = db().collection("liveGames").doc(gameId);

  await db().runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) return;
    const game = gameSnap.data()!;
    if (game.mode !== "ranked" || game.phase !== "finished" || game.rated) return;

    const players: { uid: string; name: string }[] = game.players ?? [];
    const scores: Record<string, number> = game.scores ?? {};

    // All reads first (transaction rule), then all writes.
    const statDocs = await Promise.all(players.map((p) => tx.get(statsRef(p.uid))));
    const current = players.map((p, i) => fromDoc(p.uid, statDocs[i].data()));

    const standings: Standing[] = players.map((p, i) => ({
      uid: p.uid,
      score: scores[p.uid] ?? 0,
      rating: current[i].rating,
    }));
    const newRatings = computeRatingChanges(standings);

    // Sole first place counts as a win; ties for the top don't.
    const top = Math.max(...standings.map((s) => s.score));
    const winners = standings.filter((s) => s.score === top);
    const soleWinner = winners.length === 1 ? winners[0].uid : null;

    players.forEach((p, i) => {
      const s = current[i];
      const nameFromGame = p.name ?? s.name;
      tx.set(
        statsRef(p.uid),
        {
          uid: p.uid,
          name: nameFromGame,
          rating: newRatings[p.uid],
          games: s.games + 1,
          wins: s.wins + (p.uid === soleWinner ? 1 : 0),
          bestScore: Math.max(s.bestScore, scores[p.uid] ?? 0),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    tx.update(gameRef, { rated: true });
  });
}

// Top of the ranked ladder, for the leaderboard page. Read server-side (Admin
// SDK), so rankedStats needs no client-read rule.
export async function topRanked(limit = 50): Promise<RankedStats[]> {
  const snap = await db().collection(STATS).orderBy("rating", "desc").limit(limit).get();
  return snap.docs.map((d) => fromDoc(d.id, d.data()));
}

export async function statsFor(uid: string): Promise<RankedStats | null> {
  const snap = await statsRef(uid).get();
  return snap.exists ? fromDoc(uid, snap.data()) : null;
}
