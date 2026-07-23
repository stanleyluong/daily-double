import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebaseAdmin";

// Per-user, per-clue judged-answer records — the server-side source of truth
// for "what has this account actually played today," not just "what did it
// last submit." Judging a clue writes one of these; re-opening the same
// clue (even after localStorage is wiped) returns the existing record
// instead of judging again. This is what actually closes the "learn the
// answers, then replay clean" loophole — the account-level one-submission
// rule alone only guarded the final POST, not practice runs before it.
//
// Path: users/{uid}/answeredClues/{date}_{clueId} — a deterministic ID, so
// the idempotency check is a single doc read, and the same-date query below
// is a plain equality filter (no composite index needed).

export interface AnsweredClue {
  clueId: string;
  outcome: "correct" | "wrong" | "passed";
  correctAnswer: string;
  comment: string;
  pointValue: number;
  playerAnswer?: string;
  judgedAt: string | null;
}

function docId(date: string, clueId: string): string {
  return `${date}_${clueId}`;
}

function fromDoc(data: FirebaseFirestore.DocumentData): AnsweredClue {
  const judgedAt = data.judgedAt as Timestamp | undefined;
  return {
    clueId: String(data.clueId),
    outcome: data.outcome,
    correctAnswer: String(data.correctAnswer ?? ""),
    comment: String(data.comment ?? ""),
    pointValue: Number(data.pointValue ?? 0),
    playerAnswer: data.playerAnswer,
    judgedAt: judgedAt ? judgedAt.toDate().toISOString() : null,
  };
}

export async function getAnsweredClue(
  uid: string,
  date: string,
  clueId: string
): Promise<AnsweredClue | null> {
  const snap = await db().collection("users").doc(uid).collection("answeredClues").doc(docId(date, clueId)).get();
  return snap.exists ? fromDoc(snap.data()!) : null;
}

export interface NewAnsweredClue {
  outcome: "correct" | "wrong" | "passed";
  correctAnswer: string;
  comment: string;
  pointValue: number;
  playerAnswer?: string;
}

// Idempotent: if another request already recorded this exact clue (a race
// between two tabs, or a retried request), returns the winner's record
// rather than throwing — the caller doesn't need to care who won.
export async function recordAnsweredClue(
  uid: string,
  date: string,
  clueId: string,
  entry: NewAnsweredClue
): Promise<AnsweredClue> {
  const ref = db().collection("users").doc(uid).collection("answeredClues").doc(docId(date, clueId));
  try {
    await ref.create({ ...entry, date, clueId, judgedAt: FieldValue.serverTimestamp() });
  } catch {
    const existing = await ref.get();
    if (existing.exists) return fromDoc(existing.data()!);
    throw new Error("Failed to record answer");
  }
  const written = await ref.get();
  return fromDoc(written.data()!);
}

export async function answeredCluesForDate(uid: string, date: string): Promise<AnsweredClue[]> {
  const snap = await db()
    .collection("users")
    .doc(uid)
    .collection("answeredClues")
    .where("date", "==", date)
    .get();
  return snap.docs.map((doc) => fromDoc(doc.data()));
}

// Per-game appeal: each account gets one appeal per board (keyed by date),
// stored in its own subcollection so it never mixes into the answeredClues
// score computation. claimAppeal atomically reserves the single appeal —
// create() fails if it already exists, so two attempts can't both win.
export async function hasUsedAppeal(uid: string, date: string): Promise<boolean> {
  const snap = await db().collection("users").doc(uid).collection("appeals").doc(date).get();
  return snap.exists;
}

export async function claimAppeal(uid: string, date: string, clueId: string): Promise<boolean> {
  const ref = db().collection("users").doc(uid).collection("appeals").doc(date);
  try {
    await ref.create({ clueId, at: FieldValue.serverTimestamp() });
    return true;
  } catch {
    return false; // already used this game
  }
}

// Flip a recorded clue's outcome/comment — used when an appeal is granted.
export async function updateClueOutcome(
  uid: string,
  date: string,
  clueId: string,
  outcome: "correct" | "wrong" | "passed",
  comment: string
): Promise<void> {
  await db()
    .collection("users")
    .doc(uid)
    .collection("answeredClues")
    .doc(docId(date, clueId))
    .set({ outcome, comment }, { merge: true });
}

export interface SessionTotals {
  score: number;
  correct: number;
  wrong: number;
  passed: number;
  answeredCount: number;
}

export function summarize(clues: AnsweredClue[]): SessionTotals {
  const totals: SessionTotals = { score: 0, correct: 0, wrong: 0, passed: 0, answeredCount: clues.length };
  for (const c of clues) {
    if (c.outcome === "correct") {
      totals.correct++;
      totals.score += c.pointValue;
    } else if (c.outcome === "wrong") {
      totals.wrong++;
      totals.score -= c.pointValue;
    } else {
      totals.passed++;
    }
  }
  return totals;
}

// Used to clamp a Daily Double wager to what the account has actually
// earned so far today, rather than trusting a client-reported "current
// score." Cheap: reuses the same date-scoped query as final submission.
export async function scoreSoFar(uid: string, date: string): Promise<number> {
  return summarize(await answeredCluesForDate(uid, date)).score;
}
