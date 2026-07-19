import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebaseAdmin";

const BOARDS = "jeopardyBoards";

export interface ScoreRow {
  name: string;
  score: number;
  correct: number;
  wrong: number;
  passed: number;
  durationMs: number;
  submittedAt: string | null;
}

export interface NewScore {
  name: string;
  score: number;
  correct: number;
  wrong: number;
  passed: number;
  durationMs: number;
  uid: string; // verified signed-in user — required; the API route rejects anonymous submissions
}

export interface MyScoreRow {
  date: string;
  score: number;
  correct: number;
  wrong: number;
  passed: number;
  durationMs: number;
  submittedAt: string | null;
}

// Records the score and keeps a denormalized topScore on the board doc so the
// archive list can show the day's champion without reading every scores
// subcollection. Also writes a per-user mirror at users/{uid}/scores/{date}
// so "my past scores" is a plain collection read — deliberately avoiding a
// collectionGroup query, which would need a manually-created composite
// index (the same class of bug that broke listBoards() earlier).
//
// The leaderboard doc is keyed by uid (not auto-ID), and both writes use
// tx.create() — a second submission for the same user+date fails outright
// rather than adding a duplicate entry or silently overwriting. That's the
// actual anti-cheat lever: it closes the "lose, clear localStorage, replay
// the now-familiar board, submit a better score" loophole, since a second
// attempt has nowhere to land. Throws an Error with message
// "already-submitted" in that case — the API route maps it to a 409.
export async function submitScore(date: string, entry: NewScore): Promise<void> {
  const { uid, ...entryFields } = entry;
  const boardRef = db().collection(BOARDS).doc(date);
  const scoreRef = boardRef.collection("scores").doc(uid);
  const userScoreRef = db().collection("users").doc(uid).collection("scores").doc(date);

  await db().runTransaction(async (tx) => {
    const [board, existing] = await Promise.all([tx.get(boardRef), tx.get(scoreRef)]);
    if (!board.exists) throw new Error("no-board");
    if (existing.exists) throw new Error("already-submitted");
    const top = board.get("topScore") as { score: number } | undefined;
    const submittedAt = FieldValue.serverTimestamp();
    tx.create(scoreRef, { ...entryFields, submittedAt });
    tx.create(userScoreRef, { ...entryFields, date, submittedAt });
    if (!top || entry.score > top.score) {
      tx.update(boardRef, { topScore: { name: entry.name, score: entry.score } });
    }
  });
}

export async function myScores(uid: string): Promise<MyScoreRow[]> {
  const snap = await db().collection("users").doc(uid).collection("scores").get();
  const rows: MyScoreRow[] = snap.docs.map((doc) => {
    const data = doc.data();
    const submittedAt = data.submittedAt as Timestamp | undefined;
    return {
      date: String(data.date ?? doc.id),
      score: Number(data.score ?? 0),
      correct: Number(data.correct ?? 0),
      wrong: Number(data.wrong ?? 0),
      passed: Number(data.passed ?? 0),
      durationMs: Number(data.durationMs ?? 0),
      submittedAt: submittedAt ? submittedAt.toDate().toISOString() : null,
    };
  });
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return rows;
}

export async function topScores(date: string, limit = 20): Promise<ScoreRow[]> {
  // Single-field orderBy avoids needing a composite index; ties on score are
  // broken by completion time in code. Firestore's cap is limit, not 50 — the
  // full-leaderboard page needs more than the mini-leaderboard's 20.
  const snap = await db()
    .collection(BOARDS)
    .doc(date)
    .collection("scores")
    .orderBy("score", "desc")
    .limit(limit)
    .get();

  const rows: ScoreRow[] = snap.docs.map((doc) => {
    const data = doc.data();
    const submittedAt = data.submittedAt as Timestamp | undefined;
    return {
      name: String(data.name ?? "???"),
      score: Number(data.score ?? 0),
      correct: Number(data.correct ?? 0),
      wrong: Number(data.wrong ?? 0),
      passed: Number(data.passed ?? 0),
      durationMs: Number(data.durationMs ?? 0),
      submittedAt: submittedAt ? submittedAt.toDate().toISOString() : null,
    };
  });

  rows.sort((a, b) => b.score - a.score || a.durationMs - b.durationMs);
  return rows;
}

export interface PercentileStats {
  total: number;
  beatenBy: number; // players who scored strictly higher than you
  fillFraction: number; // fraction of the field at or above your rank — drives the meter
  topPercent: number; // "Top N%" — clamped to [1, 99] for display
  isFirst: boolean; // nobody beat you
  isSolo: boolean; // you're the only player so far today
}

// Called right after submitScore, so `total` includes the just-inserted row.
// Two cheap aggregate-count queries — no document reads.
export async function percentileFor(date: string, score: number): Promise<PercentileStats> {
  const scoresRef = db().collection(BOARDS).doc(date).collection("scores");
  const [totalSnap, betterSnap] = await Promise.all([
    scoresRef.count().get(),
    scoresRef.where("score", ">", score).count().get(),
  ]);
  const total = totalSnap.data().count;
  const beatenBy = betterSnap.data().count;

  if (total <= 1) {
    return { total, beatenBy: 0, fillFraction: 1, topPercent: 1, isFirst: true, isSolo: true };
  }
  return {
    total,
    beatenBy,
    fillFraction: (total - beatenBy) / total,
    topPercent: Math.min(99, Math.max(1, Math.round((beatenBy / total) * 100))),
    isFirst: beatenBy === 0,
    isSolo: false,
  };
}
