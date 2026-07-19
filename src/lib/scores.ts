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
}

// Records the score and keeps a denormalized topScore on the board doc so the
// archive list can show the day's champion without reading every scores
// subcollection.
export async function submitScore(date: string, entry: NewScore): Promise<void> {
  const boardRef = db().collection(BOARDS).doc(date);
  const scoreRef = boardRef.collection("scores").doc();
  await db().runTransaction(async (tx) => {
    const board = await tx.get(boardRef);
    if (!board.exists) throw new Error("no-board");
    const top = board.get("topScore") as { score: number } | undefined;
    tx.create(scoreRef, { ...entry, submittedAt: FieldValue.serverTimestamp() });
    if (!top || entry.score > top.score) {
      tx.update(boardRef, { topScore: { name: entry.name, score: entry.score } });
    }
  });
}

export async function topScores(date: string, limit = 20): Promise<ScoreRow[]> {
  // Single-field orderBy avoids needing a composite index; ties on score are
  // broken by completion time in code.
  const snap = await db()
    .collection(BOARDS)
    .doc(date)
    .collection("scores")
    .orderBy("score", "desc")
    .limit(50)
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
  return rows.slice(0, limit);
}
