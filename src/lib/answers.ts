import { createHash } from "crypto";
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

// Board-wide per-clue difficulty stats — how many players got each clue
// right/wrong/passed, aggregated across everyone who's played that board.
// Keyed by boardKey (a date or custom-{id}) + clueId, not per-user, so this is
// a single collection with a plain equality filter (no composite index, same
// pattern as answeredCluesForDate). Incremented once per single-player judge
// call; multiplayer doesn't feed this (it judges through a different path).
export interface ClueStat {
  correct: number;
  wrong: number;
  passed: number;
}

function clueStatDocId(boardKey: string, clueId: string): string {
  return `${boardKey}_${clueId}`;
}

export async function incrementClueStat(
  boardKey: string,
  clueId: string,
  outcome: "correct" | "wrong" | "passed"
): Promise<void> {
  await db()
    .collection("clueStats")
    .doc(clueStatDocId(boardKey, clueId))
    .set({ boardKey, clueId, [outcome]: FieldValue.increment(1) }, { merge: true });
}

export async function clueStatsForBoard(boardKey: string): Promise<Record<string, ClueStat>> {
  const snap = await db().collection("clueStats").where("boardKey", "==", boardKey).get();
  const out: Record<string, ClueStat> = {};
  snap.forEach((d) => {
    const data = d.data();
    out[String(data.clueId)] = {
      correct: Number(data.correct ?? 0),
      wrong: Number(data.wrong ?? 0),
      passed: Number(data.passed ?? 0),
    };
  });
  return out;
}

// Shared verdict cache: the correct answer to a given clue never changes, so
// if someone already typed (near enough) the same response, reuse that
// judgment instead of spending an API call to re-ask Claude something it's
// already answered. Keyed by boardKey + clueId + a normalized form of the
// answer text (trimmed, lowercased, whitespace-collapsed, "what/who is/are"
// framing and trailing punctuation stripped — the same equivalences Claude's
// own judging prompt already treats as identical) — deliberately NOT fuzzy
// beyond that: two different-but-similar answers (e.g. a genuine typo) still
// get their own fresh judgment rather than silently inheriting someone
// else's ruling on close-but-not-equal text.
export interface CachedVerdict {
  correct: boolean;
  comment: string;
}

function normalizeAnswerForCache(answer: string): string {
  return answer
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^(what|whats|who|whos)('s|\s+is|\s+are|\s+was|\s+were)?\s+/i, "")
    .replace(/[?.!,]+$/g, "")
    .trim();
}

function verdictDocId(boardKey: string, clueId: string, normalized: string): string {
  const hash = createHash("sha1").update(normalized).digest("hex").slice(0, 20);
  return `${boardKey}_${clueId}_${hash}`;
}

export async function getCachedVerdict(
  boardKey: string,
  clueId: string,
  answer: string
): Promise<CachedVerdict | null> {
  const normalized = normalizeAnswerForCache(answer);
  if (!normalized) return null;
  const snap = await db().collection("answerVerdicts").doc(verdictDocId(boardKey, clueId, normalized)).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  return { correct: Boolean(data.correct), comment: String(data.comment ?? "") };
}

export async function cacheVerdict(
  boardKey: string,
  clueId: string,
  answer: string,
  verdict: CachedVerdict
): Promise<void> {
  const normalized = normalizeAnswerForCache(answer);
  if (!normalized) return;
  await db()
    .collection("answerVerdicts")
    .doc(verdictDocId(boardKey, clueId, normalized))
    .set(
      {
        boardKey,
        clueId,
        normalizedAnswer: normalized,
        correct: verdict.correct,
        comment: verdict.comment,
        cachedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

// A granted appeal means the original cached verdict for this exact answer
// text was wrong — rather than overwrite it with the appeal's comment (which
// is worded as an appeal response, not a first-time verdict, and would read
// strangely to the next player who never appealed), just drop the entry so
// the next lookup gets a fresh judgeAnswer() call.
export async function invalidateCachedVerdict(boardKey: string, clueId: string, answer: string): Promise<void> {
  const normalized = normalizeAnswerForCache(answer);
  if (!normalized) return;
  await db().collection("answerVerdicts").doc(verdictDocId(boardKey, clueId, normalized)).delete();
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
