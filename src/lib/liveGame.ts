import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebaseAdmin";
import {
  findClue,
  getBoardForDate,
  judgeAnswer,
  listBoards,
  todayKey,
  type Board,
} from "@/lib/jeopardy";
import {
  ANSWER_MS,
  COUNTDOWN_MS,
  MAX_PLAYERS,
  type LiveGame,
  type LiveMode,
  type LivePhase,
  type LivePlayer,
  type LiveReveal,
  type RevealResult,
} from "@/lib/liveTypes";
import { applyRankedResults } from "@/lib/ranking";

export { ANSWER_MS, COUNTDOWN_MS } from "@/lib/liveTypes";
export type { LiveGame, LiveMode, LivePhase, LivePlayer, LiveReveal, RevealResult } from "@/lib/liveTypes";

// ---------------------------------------------------------------------------
// Live (multiplayer) games. Server-authoritative, exactly like the single-
// player judge path: every mutation here runs through the Admin SDK from an
// API route; clients only ever READ the game doc over a Firestore listener.
//
// Deliberately isolated from the daily game: a live game uses its own board
// (a random past board) and NEVER calls recordAnsweredClue(), so playing live
// can't mark anyone's personal daily board as played or touch the real
// leaderboard. See src/lib/answers.ts for the daily path it stays clear of.
//
// Phases: lobby → active ⇄ reveal → … → finished. "picking" is represented by
// phase==="active" with currentClueId===null (a picker is choosing). While a
// clue is live, clients derive the 3-2-1 countdown vs. the 10s answer window
// from the absolute `countdownEndsAt` / `answerEndsAt` timestamps themselves.
// ---------------------------------------------------------------------------

const RESOLVE_GRACE_MS = 15000; // reclaim a stalled resolve after this
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars

const GAMES = "liveGames";

function gameRef(id: string) {
  return db().collection(GAMES).doc(id);
}

function randomCode(len = 5): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

async function pickBoardDate(): Promise<string> {
  // A live game plays a random *past* board so it's a fresh challenge and
  // never collides with today's live-generated daily board. Falls back to
  // today only if nothing else exists yet.
  const boards = await listBoards().catch(() => []);
  const today = todayKey();
  const past = boards.map((b) => b.date).filter((d) => d < today);
  if (past.length === 0) return today;
  return past[Math.floor(Math.random() * past.length)];
}

function cleanName(name: string, fallback: string): string {
  const n = (name ?? "").replace(/\s+/g, " ").trim().slice(0, 24);
  return n || fallback;
}

// The whole doc is client-readable, so it must never contain answers. The
// only answer-bearing field is `reveal`, written after a clue resolves — by
// which point revealing is the point.
function toGame(id: string, data: FirebaseFirestore.DocumentData): LiveGame {
  return {
    id,
    status: data.status,
    mode: data.mode ?? "normal",
    hostUid: data.hostUid,
    boardDate: data.boardDate,
    players: data.players ?? [],
    playerUids: data.playerUids ?? [],
    scores: data.scores ?? {},
    phase: data.phase,
    roundIndex: data.roundIndex ?? 0,
    pickerUid: data.pickerUid ?? null,
    currentClueId: data.currentClueId ?? null,
    currentSubmittedUids: data.currentSubmittedUids ?? [],
    answeredClueIds: data.answeredClueIds ?? [],
    countdownEndsAt: data.countdownEndsAt ?? null,
    answerEndsAt: data.answerEndsAt ?? null,
    resolving: data.resolving ?? false,
    resolveClaimedAt: data.resolveClaimedAt ?? null,
    reveal: data.reveal ?? null,
    paused: data.paused ?? false,
    pausedBy: data.pausedBy ?? null,
    pausedCountdownRemaining: data.pausedCountdownRemaining ?? null,
    pausedAnswerRemaining: data.pausedAnswerRemaining ?? null,
    rated: data.rated ?? false,
  };
}

export async function getGame(id: string): Promise<LiveGame | null> {
  const snap = await gameRef(id).get();
  return snap.exists ? toGame(id, snap.data()!) : null;
}

export async function createGame(uid: string, name: string, mode: LiveMode = "normal"): Promise<string> {
  const boardDate = await pickBoardDate();
  const player: LivePlayer = { uid, name: cleanName(name, "Player 1") };

  // Retry on the astronomically-unlikely code collision.
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomCode();
    try {
      await gameRef(code).create({
        status: "lobby",
        mode: mode === "ranked" ? "ranked" : "normal",
        hostUid: uid,
        boardDate,
        players: [player],
        playerUids: [uid],
        scores: { [uid]: 0 },
        phase: "lobby",
        roundIndex: 0,
        pickerUid: null,
        currentClueId: null,
        currentSubmittedUids: [],
        answeredClueIds: [],
        countdownEndsAt: null,
        answerEndsAt: null,
        resolving: false,
        resolveClaimedAt: null,
        reveal: null,
        paused: false,
        pausedBy: null,
        pausedCountdownRemaining: null,
        pausedAnswerRemaining: null,
        rated: false,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return code;
    } catch {
      // code taken — try another
    }
  }
  throw new Error("Could not allocate a game code, try again.");
}

export async function joinGame(code: string, uid: string, name: string): Promise<LiveGame> {
  const ref = gameRef(code);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("no-game");
    const game = toGame(code, snap.data()!);

    if (game.playerUids.includes(uid)) return game; // idempotent rejoin
    if (game.status !== "lobby") throw new Error("already-started");
    if (game.players.length >= MAX_PLAYERS) throw new Error("game-full");

    const player: LivePlayer = { uid, name: cleanName(name, `Player ${game.players.length + 1}`) };
    tx.update(ref, {
      players: [...game.players, player],
      playerUids: [...game.playerUids, uid],
      scores: { ...game.scores, [uid]: 0 },
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ...game, players: [...game.players, player], playerUids: [...game.playerUids, uid] };
  });
}

export async function startGame(gameId: string, uid: string): Promise<void> {
  const ref = gameRef(gameId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("no-game");
    const game = toGame(gameId, snap.data()!);
    if (game.hostUid !== uid) throw new Error("not-host");
    if (game.status !== "lobby") throw new Error("already-started");
    // Ranked games affect ratings, so they need a real opponent.
    if (game.mode === "ranked" && game.players.length < 2) throw new Error("ranked-needs-2");

    tx.update(ref, {
      status: "in_progress",
      phase: "picking",
      pickerUid: game.playerUids[0],
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

function currentRoundClueIds(board: Board, roundIndex: number): string[] {
  const round = board.rounds[roundIndex];
  if (!round) return [];
  return round.categories.flatMap((c) => c.clues.map((cl) => cl.id));
}

export async function pickClue(gameId: string, uid: string, clueId: string): Promise<void> {
  const ref = gameRef(gameId);
  const game = await getGame(gameId);
  if (!game) throw new Error("no-game");
  if (game.status !== "in_progress" || game.phase !== "picking") throw new Error("bad-phase");
  if (game.pickerUid !== uid) throw new Error("not-your-pick");

  const board = await getBoardForDate(game.boardDate);
  if (!board) throw new Error("no-board");
  const roundIds = currentRoundClueIds(board, game.roundIndex);
  if (!roundIds.includes(clueId)) throw new Error("bad-clue");
  if (game.answeredClueIds.includes(clueId)) throw new Error("already-answered");

  const now = Date.now();
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const g = toGame(gameId, snap.data()!);
    if (g.phase !== "picking" || g.pickerUid !== uid) throw new Error("bad-phase");
    tx.update(ref, {
      phase: "active",
      currentClueId: clueId,
      currentSubmittedUids: [],
      countdownEndsAt: now + COUNTDOWN_MS,
      answerEndsAt: now + COUNTDOWN_MS + ANSWER_MS,
      resolving: false,
      resolveClaimedAt: null,
      reveal: null,
      paused: false,
      pausedBy: null,
      pausedCountdownRemaining: null,
      pausedAnswerRemaining: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

export async function submitAnswer(
  gameId: string,
  uid: string,
  clueId: string,
  answer: string
): Promise<void> {
  const ref = gameRef(gameId);
  const game = await getGame(gameId);
  if (!game) throw new Error("no-game");
  if (!game.playerUids.includes(uid)) throw new Error("not-a-player");
  if (game.phase !== "active" || game.currentClueId !== clueId) throw new Error("bad-phase");
  if (game.paused) throw new Error("paused");
  if (game.answerEndsAt !== null && Date.now() > game.answerEndsAt) throw new Error("too-late");

  const clean = (answer ?? "").trim().slice(0, 200);
  // Submissions live in a subcollection the security rules keep clients OUT
  // of — only the resolver (Admin SDK) reads them. The doc only ever learns
  // *that* a player answered (for the "answered" ticks), never what.
  await ref.collection("submissions").doc(`${clueId}__${uid}`).set({
    uid,
    clueId,
    answer: clean,
    submittedAt: FieldValue.serverTimestamp(),
  });
  await ref.update({
    currentSubmittedUids: FieldValue.arrayUnion(uid),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

// Any client fires this at the buzzer; the transaction below makes only the
// first caller do the work, so redundant calls are harmless (idempotent).
export async function resolveClue(gameId: string): Promise<void> {
  const ref = gameRef(gameId);
  const now = Date.now();

  // 1. Atomically claim the resolve. Reclaimable if a prior claimer stalled.
  const claim = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const g = toGame(gameId, snap.data()!);
    if (g.phase !== "active" || !g.currentClueId) return null;
    if (g.paused) return null; // clock is frozen; don't resolve while paused
    if (g.answerEndsAt !== null && now < g.answerEndsAt) return null; // not time yet
    const stalled = g.resolveClaimedAt !== null && now - g.resolveClaimedAt > RESOLVE_GRACE_MS;
    if (g.resolving && !stalled) return null; // someone else owns it
    tx.update(ref, { resolving: true, resolveClaimedAt: now });
    return g;
  });
  if (!claim) return;

  const clueId = claim.currentClueId!;
  try {
    const board = await getBoardForDate(claim.boardDate);
    if (!board) throw new Error("no-board");
    const found = findClue(board, clueId);
    if (!found) throw new Error("no-clue");

    const subsSnap = await ref.collection("submissions").where("clueId", "==", clueId).get();
    const submissions = subsSnap.docs.map((d) => d.data() as { uid: string; answer: string });

    // Judge every submission (parallel). Non-submitters score nothing.
    const judged = await Promise.all(
      submissions.map(async (s) => {
        if (!s.answer) return { uid: s.uid, answer: s.answer, correct: false, comment: "" };
        const verdict = await judgeAnswer(
          { title: found.category.title },
          { clue: found.clue.clue, answer: found.clue.answer, acceptable: found.clue.acceptable },
          s.answer
        );
        return { uid: s.uid, answer: s.answer, correct: verdict.correct, comment: verdict.comment };
      })
    );

    const results: Record<string, RevealResult> = {};
    for (const uid of claim.playerUids) results[uid] = { answer: null, outcome: "none" };
    for (const j of judged) {
      results[j.uid] = { answer: j.answer, outcome: j.correct ? "correct" : "wrong" };
    }
    const firstComment = judged.find((j) => j.comment)?.comment ?? "";

    // 2. Commit the ruling: bump scores, write reveal, advance phase — all in
    //    a transaction, guarded by `resolved` so this can't double-apply.
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const g = toGame(gameId, snap.data()!);
      if (g.answeredClueIds.includes(clueId)) return; // already committed
      const scores = { ...g.scores };
      for (const j of judged) {
        if (j.correct) scores[j.uid] = (scores[j.uid] ?? 0) + found.clue.value;
      }
      const reveal: LiveReveal = {
        clueId,
        categoryTitle: found.category.title,
        value: found.clue.value,
        correctAnswer: found.clue.answer,
        comment: firstComment,
        results,
      };
      tx.update(ref, {
        scores,
        reveal,
        phase: "reveal",
        answeredClueIds: FieldValue.arrayUnion(clueId),
        resolving: false,
        resolveClaimedAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (err) {
    // Release the claim so another client can retry rather than stalling.
    await ref.update({ resolving: false, resolveClaimedAt: null }).catch(() => {});
    throw err;
  }
}

// Pause / resume — normal mode only, any player. A mid-clue pause freezes the
// running timer by storing how much of the countdown and the answer window
// were left; resume recomputes the absolute deadlines from "now" so no wall-
// clock time is lost while paused. Pausing outside an active clue (lobby,
// picking, reveal) just sets the flag.
export async function pauseGame(gameId: string, uid: string): Promise<void> {
  const ref = gameRef(gameId);
  const now = Date.now();
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("no-game");
    const g = toGame(gameId, snap.data()!);
    if (!g.playerUids.includes(uid)) throw new Error("not-a-player");
    if (g.mode === "ranked") throw new Error("ranked-no-pause");
    if (g.status === "finished") throw new Error("bad-phase");
    if (g.paused) return; // already paused, idempotent

    const patch: Record<string, unknown> = {
      paused: true,
      pausedBy: uid,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (g.phase === "active") {
      patch.pausedCountdownRemaining = g.countdownEndsAt !== null ? Math.max(0, g.countdownEndsAt - now) : 0;
      patch.pausedAnswerRemaining = g.answerEndsAt !== null ? Math.max(0, g.answerEndsAt - now) : 0;
    }
    tx.update(ref, patch);
  });
}

export async function resumeGame(gameId: string, uid: string): Promise<void> {
  const ref = gameRef(gameId);
  const now = Date.now();
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("no-game");
    const g = toGame(gameId, snap.data()!);
    if (!g.playerUids.includes(uid)) throw new Error("not-a-player");
    if (!g.paused) return; // already running, idempotent

    const patch: Record<string, unknown> = {
      paused: false,
      pausedBy: null,
      pausedCountdownRemaining: null,
      pausedAnswerRemaining: null,
      updatedAt: FieldValue.serverTimestamp(),
    };
    // Re-anchor a frozen mid-clue timer to the current wall clock.
    if (g.phase === "active" && g.pausedAnswerRemaining !== null) {
      patch.countdownEndsAt = now + (g.pausedCountdownRemaining ?? 0);
      patch.answerEndsAt = now + g.pausedAnswerRemaining;
      patch.resolveClaimedAt = null;
      patch.resolving = false;
    }
    tx.update(ref, patch);
  });
}

// After the reveal, advance: rotate the pick, cross into round 2 when the
// current round is done, or finish when the whole board is answered.
export async function continueGame(gameId: string, uid: string): Promise<void> {
  const ref = gameRef(gameId);
  const game = await getGame(gameId);
  if (!game) throw new Error("no-game");
  if (!game.playerUids.includes(uid)) throw new Error("not-a-player");
  if (game.phase !== "reveal") throw new Error("bad-phase");

  const board = await getBoardForDate(game.boardDate);
  if (!board) throw new Error("no-board");

  let roundIndex = game.roundIndex;
  let roundIds = currentRoundClueIds(board, roundIndex);
  const roundDone = roundIds.every((id) => game.answeredClueIds.includes(id));

  let phase: LivePhase = "picking";
  if (roundDone) {
    if (roundIndex + 1 < board.rounds.length) {
      roundIndex += 1;
      roundIds = currentRoundClueIds(board, roundIndex);
    } else {
      phase = "finished";
    }
  }

  // Rotate the pick to the next player in join order.
  const order = game.playerUids;
  const curIdx = game.pickerUid ? order.indexOf(game.pickerUid) : -1;
  const nextPicker = order[(curIdx + 1) % order.length];

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const g = toGame(gameId, snap.data()!);
    if (g.phase !== "reveal") return; // someone already continued
    tx.update(ref, {
      phase,
      status: phase === "finished" ? "finished" : "in_progress",
      roundIndex,
      pickerUid: phase === "finished" ? null : nextPicker,
      currentClueId: null,
      currentSubmittedUids: [],
      countdownEndsAt: null,
      answerEndsAt: null,
      reveal: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  // On a ranked game finishing, apply Elo — idempotent (guarded by the game's
  // `rated` flag), so a redundant continue into the finish is safe.
  if (phase === "finished" && game.mode === "ranked") {
    await applyRankedResults(gameId).catch((e) => console.error("ranked apply failed:", e));
  }
}
