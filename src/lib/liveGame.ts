import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebaseAdmin";
import {
  findClue,
  getBoardForDate,
  isValidBoardKey,
  judgeAnswer,
  listBoards,
  toPublicBoard,
  todayKey,
  type Board,
  type PublicBoard,
} from "@/lib/jeopardy";
import {
  ANSWER_MS,
  ANSWER_MS_OPTIONS,
  COUNTDOWN_MS,
  FINAL_ANSWER_MS,
  FINAL_WAGER_MS,
  EMOTES,
  MAX_CHAT,
  MAX_PLAYERS,
  type LiveChatMessage,
  type LiveGame,
  type LiveMode,
  type LivePhase,
  type LivePlayer,
  type LiveReveal,
  type PickMode,
  type RevealResult,
  type ScoringMode,
} from "@/lib/liveTypes";
import { applyRankedResults } from "@/lib/ranking";
import { markPlayed, pickUnplayedHistorical } from "@/lib/played";
import { recordHeadToHead } from "@/lib/headToHead";
import { setPresenceGame } from "@/lib/friends";

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

// Exposed for matchmaking.ts, which builds a ranked game doc directly (both
// players already matched/ready — no separate create+join flow needed) and
// reuses this module's game-code allocation and board-pool claiming.
export { gameRef, randomCode };

export async function pickBoardDate(): Promise<string> {
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
    boardId: data.boardId ?? null,
    answerMs: data.answerMs ?? ANSWER_MS,
    scoringMode: data.scoringMode ?? "all_correct",
    pickMode: data.pickMode ?? "winner",
    chat: data.chat ?? [],
    players: data.players ?? [],
    playerUids: data.playerUids ?? [],
    scores: data.scores ?? {},
    phase: data.phase,
    roundIndex: data.roundIndex ?? 0,
    pickerUid: data.pickerUid ?? null,
    nextPickerUid: data.nextPickerUid ?? null,
    currentClueId: data.currentClueId ?? null,
    currentSubmittedUids: data.currentSubmittedUids ?? [],
    answeredClueIds: data.answeredClueIds ?? [],
    countdownEndsAt: data.countdownEndsAt ?? null,
    answerEndsAt: data.answerEndsAt ?? null,
    finalWagers: data.finalWagers ?? {},
    finalWagerEndsAt: data.finalWagerEndsAt ?? null,
    resolving: data.resolving ?? false,
    resolveClaimedAt: data.resolveClaimedAt ?? null,
    reveal: data.reveal ?? null,
    paused: data.paused ?? false,
    pausedBy: data.pausedBy ?? null,
    pausedReason: data.pausedReason ?? null,
    pausedCountdownRemaining: data.pausedCountdownRemaining ?? null,
    pausedAnswerRemaining: data.pausedAnswerRemaining ?? null,
    lastSeen: data.lastSeen ?? {},
    rated: data.rated ?? false,
    rematchCode: data.rematchCode ?? null,
    seriesWins: data.seriesWins ?? {},
    emote: data.emote ?? null,
  };
}

const LIVE_BOARDS = "liveBoards";

// Claim an unused pre-generated board from the pool so a live game gets fresh,
// non-repeating questions. Returns its id, or null if the pool is empty (the
// caller then falls back to a past daily board). Generation happens ahead of
// time — never in the request path, which can't fit board generation inside
// Amplify's SSR timeout (see the pregenerate Lambda).
export async function claimLiveBoard(gameId: string): Promise<string | null> {
  const snap = await db().collection(LIVE_BOARDS).where("usedBy", "==", null).limit(5).get();
  for (const doc of snap.docs) {
    const ok = await db().runTransaction(async (tx) => {
      const d = await tx.get(doc.ref);
      if (!d.exists || d.get("usedBy") != null) return false;
      tx.update(doc.ref, { usedBy: gameId, usedAt: FieldValue.serverTimestamp() });
      return true;
    });
    if (ok) return doc.id;
  }
  return null;
}

// The board a game is played on: a pooled fresh board if it has one, else a
// stored daily board by date (fallback when the pool was empty at creation).
async function getGameBoard(game: LiveGame): Promise<Board | null> {
  if (game.boardId) {
    const d = await db().collection(LIVE_BOARDS).doc(game.boardId).get();
    if (d.exists) {
      const data = d.data()!;
      return {
        boardId: game.boardId,
        date: data.date ?? game.boardDate ?? "",
        rounds: data.rounds,
        final: data.final,
      };
    }
  }
  return getBoardForDate(game.boardDate);
}

export async function getGame(id: string): Promise<LiveGame | null> {
  const snap = await gameRef(id).get();
  return snap.exists ? toGame(id, snap.data()!) : null;
}

// The answer-free public board for a game, for the client to render. Answers
// are stripped by toPublicBoard, so this is safe to serve to any player.
export async function getPublicGameBoard(gameId: string): Promise<PublicBoard | null> {
  const game = await getGame(gameId);
  if (!game) return null;
  const board = await getGameBoard(game);
  return board ? toPublicBoard(board) : null;
}

// boardKey chooses the board source:
//   undefined / "pool" → a fresh pre-generated AI board from the pool
//   "YYYY-MM-DD"        → a specific daily or real historical episode
//   "custom-{id}"       → a user-built custom board
// A specific board skips the pool claim; getGameBoard() resolves it via
// getBoardForDate() (which handles daily, historical, and custom keys).
export async function createGame(
  uid: string,
  name: string,
  mode: LiveMode = "normal",
  boardKey?: string,
  answerMs?: number,
  scoringMode: ScoringMode = "all_correct",
  pickMode: PickMode = "winner"
): Promise<string> {
  const ranked = mode === "ranked";
  // Ranked games ignore host settings and use one fixed, fair configuration so
  // every rated game is the same contest: a fresh AI board (never a custom or
  // real episode either side could have prepped), a 10s timer, only the fastest
  // correct answer scores, and the winner picks. Enforced here, server-side, so
  // it can't be spoofed from the client.
  const effBoardKey = ranked ? "pool" : boardKey;
  const effAnswerMs = ranked ? ANSWER_MS : answerMs;
  const effScoring: ScoringMode = ranked ? "winner_only" : scoringMode;
  const effPick: PickMode = ranked ? "winner" : pickMode;

  // "unplayed" → a real historical episode the host hasn't played yet.
  let resolvedKey = effBoardKey;
  if (effBoardKey === "unplayed") resolvedKey = (await pickUnplayedHistorical(uid)) ?? "pool";
  const useSpecific = !!resolvedKey && resolvedKey !== "pool";
  const boardDate = useSpecific ? resolvedKey! : await pickBoardDate();
  const window = ANSWER_MS_OPTIONS.includes(effAnswerMs as (typeof ANSWER_MS_OPTIONS)[number]) ? effAnswerMs! : ANSWER_MS;
  const scoring: ScoringMode = effScoring === "winner_only" ? "winner_only" : "all_correct";
  const picking: PickMode =
    effPick === "alternating" || effPick === "loser" ? effPick : "winner";
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
        boardId: null,
        answerMs: window,
        scoringMode: scoring,
        pickMode: picking,
        chat: [],
        players: [player],
        playerUids: [uid],
        scores: { [uid]: 0 },
        phase: "lobby",
        roundIndex: 0,
        pickerUid: null,
        nextPickerUid: null,
        currentClueId: null,
        currentSubmittedUids: [],
        answeredClueIds: [],
        countdownEndsAt: null,
        answerEndsAt: null,
        finalWagers: {},
        finalWagerEndsAt: null,
        resolving: false,
        resolveClaimedAt: null,
        reveal: null,
        paused: false,
        pausedBy: null,
        pausedReason: null,
        pausedCountdownRemaining: null,
        pausedAnswerRemaining: null,
        lastSeen: { [uid]: Date.now() },
        rated: false,
        rematchCode: null,
        seriesWins: {},
        emote: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      // Only the default "fresh AI" source draws from the pool; a specific
      // board (historical episode or custom) plays exactly what was chosen.
      if (!useSpecific) {
        const boardId = await claimLiveBoard(code);
        if (boardId) await gameRef(code).update({ boardId });
      }
      setPresenceGame(uid, code, "lobby").catch(() => {});
      return code;
    } catch {
      // code taken — try another
    }
  }
  throw new Error("Could not allocate a game code, try again.");
}

// Rematch: the host of a finished game spins up a fresh game with the same
// players, mode, and house rules — a new random AI board — and writes the new
// code onto the OLD game's `rematchCode` so every connected client (via its
// existing live listener on the old game) can jump straight in, no re-invite
// needed. Idempotent: a second call returns the already-created rematch.
export async function createRematch(gameId: string, hostUid: string): Promise<string> {
  const old = await getGame(gameId);
  if (!old) throw new Error("no-game");
  if (old.hostUid !== hostUid) throw new Error("not-host");
  if (old.status !== "finished") throw new Error("bad-phase");
  if (old.rematchCode) return old.rematchCode;

  const boardDate = await pickBoardDate();
  const scores: Record<string, number> = {};
  const lastSeen: Record<string, number> = {};
  for (const uid of old.playerUids) {
    scores[uid] = 0;
    lastSeen[uid] = Date.now();
  }

  let newCode: string | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomCode();
    try {
      await gameRef(code).create({
        status: "lobby",
        mode: old.mode,
        hostUid,
        boardDate,
        boardId: null,
        answerMs: old.answerMs,
        scoringMode: old.scoringMode,
        pickMode: old.pickMode,
        chat: [],
        players: old.players,
        playerUids: old.playerUids,
        scores,
        phase: "lobby",
        roundIndex: 0,
        pickerUid: null,
        nextPickerUid: null,
        currentClueId: null,
        currentSubmittedUids: [],
        answeredClueIds: [],
        countdownEndsAt: null,
        answerEndsAt: null,
        finalWagers: {},
        finalWagerEndsAt: null,
        resolving: false,
        resolveClaimedAt: null,
        reveal: null,
        paused: false,
        pausedBy: null,
        pausedReason: null,
        pausedCountdownRemaining: null,
        pausedAnswerRemaining: null,
        lastSeen,
        rated: false,
        rematchCode: null,
        seriesWins: old.seriesWins, // carry the running tally forward
        emote: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      newCode = code;
      break;
    } catch {
      // code taken — try another
    }
  }
  if (!newCode) throw new Error("Could not allocate a game code, try again.");

  const boardId = await claimLiveBoard(newCode);
  if (boardId) await gameRef(newCode).update({ boardId });

  // Idempotent claim on the old doc: if two rematch calls race, only the
  // first write sticks (arrayUnion-free plain update is fine here since we
  // only ever set this field once, guarded by the `old.rematchCode` check
  // above for the common case; a genuine race is astronomically unlikely
  // given the host is a single browser tab).
  await gameRef(gameId).update({ rematchCode: newCode, updatedAt: FieldValue.serverTimestamp() });
  await Promise.all(old.playerUids.map((u) => setPresenceGame(u, newCode, "lobby")));
  return newCode;
}

export async function joinGame(code: string, uid: string, name: string): Promise<LiveGame> {
  const ref = gameRef(code);
  const result = await db().runTransaction(async (tx) => {
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
  setPresenceGame(uid, code, "lobby").catch(() => {});
  return result;
}

// Host-only, lobby-only: adjust the house rules before the game starts —
// timer, scoring, pick order. Board choice is a separate action, setGameBoard
// below. Ranked games ignore this entirely (their rules are fixed server-side).
export async function updateLobbySettings(
  gameId: string,
  uid: string,
  patch: { answerMs?: number; scoringMode?: ScoringMode; pickMode?: PickMode }
): Promise<void> {
  const ref = gameRef(gameId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("no-game");
    const g = toGame(gameId, snap.data()!);
    if (g.hostUid !== uid) throw new Error("not-host");
    if (g.status !== "lobby") throw new Error("bad-phase");
    if (g.mode === "ranked") throw new Error("ranked-fixed");

    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (patch.answerMs !== undefined && ANSWER_MS_OPTIONS.includes(patch.answerMs as (typeof ANSWER_MS_OPTIONS)[number])) {
      update.answerMs = patch.answerMs;
    }
    if (patch.scoringMode === "all_correct" || patch.scoringMode === "winner_only") {
      update.scoringMode = patch.scoringMode;
    }
    if (patch.pickMode === "winner" || patch.pickMode === "alternating" || patch.pickMode === "loser") {
      update.pickMode = patch.pickMode;
    }
    tx.update(ref, update);
  });
}

// Host-only, lobby-only: swap in a specific board — a real historical
// episode, a past AI daily board, or a custom board — picked from the
// Archive or freshly generated at /create, instead of the random pool pick
// createGame() made by default. Verifies the board actually exists before
// committing so a bad key can't strand the game once it starts. Ranked games
// can't use this — their board is always a fresh AI pool pick, fixed
// server-side, so every rated game is the same contest.
export async function setGameBoard(gameId: string, hostUid: string, boardKey: string): Promise<void> {
  if (!isValidBoardKey(boardKey)) throw new Error("bad-board");
  const board = await getBoardForDate(boardKey);
  if (!board) throw new Error("board-not-found");

  const ref = gameRef(gameId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("no-game");
    const g = toGame(gameId, snap.data()!);
    if (g.hostUid !== hostUid) throw new Error("not-host");
    if (g.status !== "lobby") throw new Error("bad-phase");
    if (g.mode === "ranked") throw new Error("ranked-fixed");
    tx.update(ref, { boardDate: boardKey, boardId: null, updatedAt: FieldValue.serverTimestamp() });
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

  // Mark this board as played for everyone in the game (best-effort) so
  // "unplayed episode" picks skip it next time. Uses the real board identity
  // (a pool board's id, or the date/custom key otherwise).
  const g = await getGame(gameId);
  if (g) {
    const key = g.boardId ?? g.boardDate;
    await Promise.all(g.playerUids.map((u) => markPlayed(u, key).catch(() => {})));
    // No longer a joinable lobby — clear the friends-list Join affordance.
    await Promise.all(g.playerUids.map((u) => setPresenceGame(u, gameId, "in_progress")));
  }
}

function currentRoundClueIds(board: Board, roundIndex: number): string[] {
  const round = board.rounds[roundIndex];
  if (!round) return [];
  return round.categories.flatMap((c) => c.clues.map((cl) => cl.id));
}

// Decide who picks the next clue, per the game's pickMode. `scores` is the
// post-clue tally (used by "loser"); `fastestCorrectUid` is the buzzer winner.
// Returning null means "leave the pick with the current picker" (continueGame
// falls back to game.pickerUid) — only the "winner" rule does that, when no one
// answered correctly.
function nextPicker(
  g: LiveGame,
  scores: Record<string, number>,
  fastestCorrectUid: string | null
): string | null {
  const order = g.playerUids;
  if (order.length === 0) return null;
  switch (g.pickMode) {
    case "alternating": {
      const cur = g.pickerUid ? order.indexOf(g.pickerUid) : -1;
      return order[(cur + 1) % order.length];
    }
    case "loser": {
      // Last place picks; ties break by seat order (first lowest wins).
      let pick = order[0];
      let min = scores[pick] ?? 0;
      for (const uid of order) {
        const s = scores[uid] ?? 0;
        if (s < min) {
          min = s;
          pick = uid;
        }
      }
      return pick;
    }
    case "winner":
    default:
      return fastestCorrectUid;
  }
}

// Post a message to the in-game group chat. Members only. Appends to the
// capped `chat` array on the game doc (which every member live-subscribes to),
// trimming to the most recent MAX_CHAT so the doc can't grow unbounded.
export async function postChat(gameId: string, uid: string, text: string): Promise<void> {
  const clean = (text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!clean) throw new Error("empty");
  const ref = gameRef(gameId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("no-game");
    const g = toGame(gameId, snap.data()!);
    if (!g.playerUids.includes(uid)) throw new Error("not-a-player");
    // Use the player's in-game name so chat matches the scoreboard.
    const name = g.players.find((p) => p.uid === uid)?.name ?? "Player";
    const msg: LiveChatMessage = {
      id: `${Date.now().toString(36)}-${uid.slice(0, 6)}`,
      uid,
      name,
      text: clean,
      at: Date.now(),
    };
    const chat = [...g.chat, msg].slice(-MAX_CHAT);
    tx.update(ref, { chat, updatedAt: FieldValue.serverTimestamp() });
  });
}

export async function sendEmote(gameId: string, uid: string, emoji: string): Promise<void> {
  if (!(EMOTES as readonly string[]).includes(emoji)) throw new Error("bad-emote");
  const ref = gameRef(gameId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("no-game");
  const g = toGame(gameId, snap.data()!);
  if (!g.playerUids.includes(uid)) throw new Error("not-a-player");
  await ref.update({ emote: { uid, emoji, at: Date.now() } });
}

export async function pickClue(gameId: string, uid: string, clueId: string): Promise<void> {
  const ref = gameRef(gameId);
  const game = await getGame(gameId);
  if (!game) throw new Error("no-game");
  if (game.status !== "in_progress" || game.phase !== "picking") throw new Error("bad-phase");
  if (game.pickerUid !== uid) throw new Error("not-your-pick");

  const board = await getGameBoard(game);
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
      answerEndsAt: now + COUNTDOWN_MS + (game.answerMs ?? ANSWER_MS),
      resolving: false,
      resolveClaimedAt: null,
      reveal: null,
      nextPickerUid: null,
      paused: false,
      pausedBy: null,
      pausedReason: null,
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
  // Record the "answered" tick in a transaction so two near-simultaneous
  // submits can't each miss that they were the last one in. Once everyone has
  // answered we pull answerEndsAt to now, so clients resolve immediately
  // instead of watching the clock tick down for nothing.
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const g = toGame(gameId, snap.data()!);
    if (g.phase !== "active" || g.currentClueId !== clueId) return;
    const submitted = Array.from(new Set([...g.currentSubmittedUids, uid]));
    const everyoneIn = g.playerUids.every((u) => submitted.includes(u));
    tx.update(ref, {
      currentSubmittedUids: submitted,
      updatedAt: FieldValue.serverTimestamp(),
      ...(everyoneIn && !g.paused && g.answerEndsAt !== null && Date.now() < g.answerEndsAt
        ? { answerEndsAt: Date.now() }
        : {}),
    });
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
    const board = await getGameBoard(claim);
    if (!board) throw new Error("no-board");
    const isFinal = clueId === "final";
    // Resolve the clue from the grid, or from board.final for Final Jeopardy.
    const clue = isFinal
      ? board.final
        ? { clue: board.final.clue, answer: board.final.answer, acceptable: board.final.acceptable, value: 0 }
        : null
      : findClue(board, clueId)?.clue ?? null;
    const categoryTitle = isFinal
      ? board.final?.category ?? "Final Jeopardy!"
      : findClue(board, clueId)?.category.title ?? "";
    if (!clue) throw new Error("no-clue");

    const subsSnap = await ref.collection("submissions").where("clueId", "==", clueId).get();
    const submissions = subsSnap.docs.map((d) => {
      const data = d.data() as { uid: string; answer: string; submittedAt?: FirebaseFirestore.Timestamp };
      return { uid: data.uid, answer: data.answer, at: data.submittedAt ? data.submittedAt.toMillis() : Infinity };
    });

    // Judge every submission (parallel). Non-submitters score nothing.
    const judged = await Promise.all(
      submissions.map(async (s) => {
        if (!s.answer) return { uid: s.uid, answer: s.answer, at: s.at, correct: false, comment: "" };
        const verdict = await judgeAnswer(
          { title: categoryTitle },
          { clue: clue.clue, answer: clue.answer, acceptable: clue.acceptable },
          s.answer
        );
        return { uid: s.uid, answer: s.answer, at: s.at, correct: verdict.correct, comment: verdict.comment };
      })
    );
    const byUid = new Map(judged.map((j) => [j.uid, j]));

    const firstComment = judged.find((j) => j.comment)?.comment ?? "";

    // Fastest correct answerer, by submission time.
    const correct = judged.filter((j) => j.correct).sort((a, b) => a.at - b.at);
    const fastestCorrectUid = correct.length > 0 ? correct[0].uid : null;

    // 2. Commit the ruling: bump scores, write reveal, advance phase — all in
    //    a transaction, guarded so this can't double-apply.
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const g = toGame(gameId, snap.data()!);
      if (g.answeredClueIds.includes(clueId)) return; // already committed
      const scores = { ...g.scores };
      const results: Record<string, RevealResult> = {};

      if (isFinal) {
        // Every player wins or loses their wager; a non-answer loses it too.
        for (const uid of g.playerUids) {
          const j = byUid.get(uid);
          const wager = g.finalWagers[uid] ?? 0;
          const win = !!j?.correct;
          scores[uid] = (scores[uid] ?? 0) + (win ? wager : -wager);
          results[uid] = { answer: j?.answer ?? null, outcome: win ? "correct" : "wrong", wager: win ? wager : -wager };
        }
      } else {
        // Time from the answer window opening (countdown end) to submission.
        const answerStart = claim.countdownEndsAt;
        for (const uid of g.playerUids) results[uid] = { answer: null, outcome: "none" };
        for (const j of judged) {
          const ms =
            answerStart !== null && Number.isFinite(j.at) ? Math.max(0, j.at - answerStart) : undefined;
          const passed = !j.answer; // empty submission = a Pass
          results[j.uid] = {
            answer: j.answer || null,
            outcome: passed ? "none" : j.correct ? "correct" : "wrong",
            ...(ms !== undefined ? { ms } : {}),
          };
          if (passed || !j.correct) continue;
          // Scoring house rule: everyone correct scores, or only the fastest.
          const earnsMoney = g.scoringMode !== "winner_only" || j.uid === fastestCorrectUid;
          if (earnsMoney) {
            scores[j.uid] = (scores[j.uid] ?? 0) + (clue.value ?? 0);
          } else {
            // Right but too slow under winner-only rules — mark it as +$0 so the
            // reveal shows they were correct without awarding money.
            results[j.uid] = { answer: j.answer, outcome: "correct", wager: 0, ...(ms !== undefined ? { ms } : {}) };
          }
        }
      }

      // Who controls the next pick, per the pickMode house rule (grid only).
      const nextPickerUid = isFinal ? null : nextPicker(g, scores, fastestCorrectUid);

      const reveal: LiveReveal = {
        clueId,
        categoryTitle,
        value: clue.value ?? 0,
        correctAnswer: clue.answer,
        comment: firstComment,
        results,
      };
      tx.update(ref, {
        scores,
        reveal,
        nextPickerUid,
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
      pausedReason: "manual",
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (g.phase === "active") {
      patch.pausedCountdownRemaining = g.countdownEndsAt !== null ? Math.max(0, g.countdownEndsAt - now) : 0;
      patch.pausedAnswerRemaining = g.answerEndsAt !== null ? Math.max(0, g.answerEndsAt - now) : 0;
    }
    tx.update(ref, patch);
  });
}

// Auto-pause triggered by a connected client when it detects a player has
// dropped (stale heartbeat). Applies in ANY mode — an involuntary disconnect
// isn't a strategic pause, so it bypasses the ranked no-pause rule. Idempotent
// while already paused.
export async function pauseForDisconnect(gameId: string, byUid: string, droppedUid: string): Promise<void> {
  const ref = gameRef(gameId);
  const now = Date.now();
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("no-game");
    const g = toGame(gameId, snap.data()!);
    if (!g.playerUids.includes(byUid)) throw new Error("not-a-player");
    if (g.status !== "in_progress" || g.paused) return;

    const patch: Record<string, unknown> = {
      paused: true,
      pausedBy: droppedUid,
      pausedReason: "disconnect",
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (g.phase === "active") {
      patch.pausedCountdownRemaining = g.countdownEndsAt !== null ? Math.max(0, g.countdownEndsAt - now) : 0;
      patch.pausedAnswerRemaining = g.answerEndsAt !== null ? Math.max(0, g.answerEndsAt - now) : 0;
    }
    tx.update(ref, patch);
  });
}

// Presence heartbeat — a player pings while they're in a running game so the
// others can tell they're still connected. Written server-side (Admin SDK)
// because clients can't write the game doc.
export async function heartbeat(gameId: string, uid: string): Promise<void> {
  const ref = gameRef(gameId);
  await ref.update({ [`lastSeen.${uid}`]: Date.now() });
  // Auto-resume: if this player's own drop was what paused the game, their
  // heartbeat coming back is the reconnect signal — resume without making
  // anyone click a button. Read-then-write outside the update above (a stale
  // read just means we skip resuming this tick; the next heartbeat catches it).
  const snap = await ref.get();
  if (!snap.exists) return;
  const g = toGame(gameId, snap.data()!);
  if (g.paused && g.pausedReason === "disconnect" && g.pausedBy === uid) {
    await resumeGame(gameId, uid).catch(() => {});
  }
  // Self-heal the friends-list "current game" indicator each tick, in case an
  // earlier explicit sync (join/start) was missed.
  setPresenceGame(uid, gameId, g.status === "lobby" ? "lobby" : "in_progress").catch(() => {});
}

// Explicit leave: mark this player's heartbeat as stale immediately so the
// others detect the drop right away (rather than waiting out the timeout).
export async function leaveGame(gameId: string, uid: string): Promise<void> {
  await gameRef(gameId).update({ [`lastSeen.${uid}`]: 0 });
  await setPresenceGame(uid, null, null);
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
      pausedReason: null,
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

  const board = await getGameBoard(game);
  if (!board) throw new Error("no-board");

  let roundIndex = game.roundIndex;
  let roundIds = currentRoundClueIds(board, roundIndex);
  const roundDone = roundIds.every((id) => game.answeredClueIds.includes(id));
  const finalDone = game.answeredClueIds.includes("final");

  // picking (grid continues) → final_wager (all grid rounds done, board has a
  // Final and it hasn't been played) → finished.
  let phase: LivePhase = "picking";
  if (roundDone) {
    if (roundIndex + 1 < board.rounds.length) {
      roundIndex += 1;
      roundIds = currentRoundClueIds(board, roundIndex);
    } else if (board.final && !finalDone) {
      phase = "final_wager";
    } else {
      phase = "finished";
    }
  }

  const nextPicker = game.nextPickerUid ?? game.pickerUid ?? game.playerUids[0];
  const now = Date.now();

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const g = toGame(gameId, snap.data()!);
    if (g.phase !== "reveal") return; // someone already continued

    const base = {
      status: phase === "finished" ? "finished" : "in_progress",
      currentClueId: null,
      currentSubmittedUids: [],
      countdownEndsAt: null,
      answerEndsAt: null,
      reveal: null,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (phase === "final_wager") {
      tx.update(ref, {
        ...base,
        phase: "final_wager",
        pickerUid: null,
        nextPickerUid: null,
        finalWagers: {},
        finalWagerEndsAt: now + FINAL_WAGER_MS,
      });
    } else {
      const extra: Record<string, unknown> = {};
      if (phase === "finished") {
        // Best-of-series tally: sole top score wins this game; ties add
        // nothing. Starts from whatever this game inherited (a rematch copies
        // its parent's tally as its starting point).
        const top = Math.max(...g.playerUids.map((u) => g.scores[u] ?? 0));
        const winners = g.playerUids.filter((u) => (g.scores[u] ?? 0) === top);
        if (winners.length === 1) {
          extra.seriesWins = { ...g.seriesWins, [winners[0]]: (g.seriesWins[winners[0]] ?? 0) + 1 };
        }
      }
      tx.update(ref, {
        ...base,
        ...extra,
        phase,
        roundIndex,
        pickerUid: phase === "finished" ? null : nextPicker,
        nextPickerUid: null,
      });
    }
  });

  // On a ranked game finishing, apply Elo — idempotent (guarded by the game's
  // `rated` flag), so a redundant continue into the finish is safe.
  if (phase === "finished" && game.mode === "ranked") {
    await applyRankedResults(gameId).catch((e) => console.error("ranked apply failed:", e));
  }
  // Head-to-head is best-effort and not idempotency-guarded like ranked Elo —
  // a redundant continue() into an already-finished game re-increments it.
  // continueGame is normally only reachable from "reveal", so in practice this
  // fires once; accept the small risk rather than add another guard field.
  if (phase === "finished" && game.playerUids.length >= 2) {
    const finalScores = (await getGame(gameId))?.scores ?? game.scores;
    await recordHeadToHead(game.players, finalScores).catch((e) =>
      console.error("head-to-head record failed:", e)
    );
  }
  if (phase === "finished") {
    await Promise.all(game.playerUids.map((u) => setPresenceGame(u, null, null)));
  }
}

// Final Jeopardy: each player wagers 0..(their current score). Once everyone
// has wagered (or the wager deadline passes), the final clue opens.
export async function submitFinalWager(gameId: string, uid: string, wager: number): Promise<void> {
  const ref = gameRef(gameId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("no-game");
    const g = toGame(gameId, snap.data()!);
    if (!g.playerUids.includes(uid)) throw new Error("not-a-player");
    if (g.phase !== "final_wager") throw new Error("bad-phase");
    const max = Math.max(0, g.scores[uid] ?? 0);
    const w = Math.min(max, Math.max(0, Math.round(Number(wager) || 0)));
    tx.update(ref, { [`finalWagers.${uid}`]: w, updatedAt: FieldValue.serverTimestamp() });
  });
  await startFinalClue(gameId); // opens the clue if that was the last wager
}

// Transitions final_wager → the final clue once all wagers are in or the wager
// window closes (missing wagers default to 0). Idempotent; any client may fire
// it when the wager deadline passes.
export async function startFinalClue(gameId: string): Promise<void> {
  const ref = gameRef(gameId);
  const now = Date.now();
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const g = toGame(gameId, snap.data()!);
    if (g.phase !== "final_wager") return;
    const allWagered = g.playerUids.every((u) => u in g.finalWagers);
    const deadlinePassed = g.finalWagerEndsAt !== null && now > g.finalWagerEndsAt;
    if (!allWagered && !deadlinePassed) return;

    const wagers = { ...g.finalWagers };
    for (const u of g.playerUids) if (!(u in wagers)) wagers[u] = 0;
    tx.update(ref, {
      finalWagers: wagers,
      phase: "active",
      currentClueId: "final",
      currentSubmittedUids: [],
      countdownEndsAt: now + COUNTDOWN_MS,
      answerEndsAt: now + COUNTDOWN_MS + FINAL_ANSWER_MS,
      finalWagerEndsAt: null,
      resolving: false,
      resolveClaimedAt: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}
