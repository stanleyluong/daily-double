// Pure types + constants shared by the live-game server logic (liveGame.ts,
// Admin SDK) and the client (useLiveGame hook, UI). No firebase-admin import
// here, so it's safe to pull into client components.

export const COUNTDOWN_MS = 3000;
export const ANSWER_MS = 10000; // default answer window
export const ANSWER_MS_OPTIONS = [5000, 10000, 15000, 20000, 30000] as const;
export const FINAL_WAGER_MS = 25000; // time to place a Final Jeopardy wager
export const FINAL_ANSWER_MS = 30000; // Final Jeopardy answer window
export const MAX_PLAYERS = 3;

// Quick in-game reactions. Fixed set (not free text) — cheap to moderate and
// fast to tap during a live round.
export const EMOTES = ["👏", "😂", "😱", "🔥", "🤔", "😭"] as const;
export type Emote = (typeof EMOTES)[number];

export type LiveMode = "normal" | "ranked";
// "final_wager" collects Final Jeopardy wagers; the final clue itself reuses
// the "active" phase with currentClueId === "final".
export type LivePhase = "lobby" | "picking" | "active" | "reveal" | "final_wager" | "finished";
export type PauseReason = "manual" | "disconnect";

// House rules, chosen before the game and fixed for its duration.
//   all_correct → every correct answer scores the clue's value (default).
//   winner_only → only the fastest correct answer scores; slower correct
//                 answers earn nothing (real-buzzer semantics).
export type ScoringMode = "all_correct" | "winner_only";
//   winner      → the fastest correct answerer picks next; if nobody's right,
//                 the current picker keeps control (default).
//   alternating → the pick rotates through players in seat order, regardless
//                 of who got it right.
//   loser       → whoever is in last place (lowest score) picks next.
export type PickMode = "winner" | "alternating" | "loser";

// A player is considered disconnected if their last heartbeat is older than
// this. Clients heartbeat every HEARTBEAT_MS while in a running game.
export const HEARTBEAT_MS = 4000;
export const DISCONNECT_MS = 12000;

export interface LivePlayer {
  uid: string;
  name: string;
}

// In-game group chat. Kept as a capped array right on the game doc, which
// every member already live-subscribes to via onSnapshot — so messages arrive
// in real time without any new client-read surface.
export const MAX_CHAT = 40;
export interface LiveChatMessage {
  id: string;
  uid: string;
  name: string;
  text: string;
  at: number; // epoch ms
}

export interface RevealResult {
  answer: string | null;
  outcome: "correct" | "wrong" | "none";
  wager?: number; // Final Jeopardy only: the ± applied to this player's score
  ms?: number; // grid clues: time from the answer window opening to submission
}

export interface LiveReveal {
  clueId: string;
  categoryTitle: string;
  value: number;
  correctAnswer: string;
  comment: string;
  results: Record<string, RevealResult>; // uid -> result
}

export interface LiveGame {
  id: string;
  status: "lobby" | "in_progress" | "finished";
  mode: LiveMode;
  hostUid: string;
  boardDate: string;
  // A pre-generated fresh board from the pool (liveBoards/{boardId}). Older
  // games (and the fallback) instead use boardDate against jeopardyBoards.
  boardId: string | null;
  // Game setting: length of each answer window in ms (default ANSWER_MS).
  answerMs: number;
  // House rules (see ScoringMode / PickMode). Older games without these fields
  // fall back to the original behavior (all_correct / winner).
  scoringMode: ScoringMode;
  pickMode: PickMode;
  // In-game group chat (last MAX_CHAT messages).
  chat: LiveChatMessage[];
  players: LivePlayer[];
  playerUids: string[];
  scores: Record<string, number>;
  phase: LivePhase;
  roundIndex: number;
  pickerUid: string | null;
  // Who picks next, decided at reveal time: the fastest correct answerer.
  // Null → nobody was right, so the current picker keeps control.
  nextPickerUid: string | null;
  currentClueId: string | null;
  currentSubmittedUids: string[];
  answeredClueIds: string[];
  countdownEndsAt: number | null;
  answerEndsAt: number | null;
  // Final Jeopardy: per-player wagers, and the deadline to place them.
  finalWagers: Record<string, number>;
  finalWagerEndsAt: number | null;
  resolving: boolean;
  resolveClaimedAt: number | null;
  reveal: LiveReveal | null;
  // Pause. Manual pause is normal-mode-only; a "disconnect" pause is
  // triggered automatically when a player drops and applies in any mode.
  // While paused, a mid-clue timer is frozen by storing the remaining ms.
  paused: boolean;
  pausedBy: string | null;
  pausedReason: PauseReason | null;
  pausedCountdownRemaining: number | null;
  pausedAnswerRemaining: number | null;
  // Presence: uid -> last heartbeat (server epoch ms). 0 means "left".
  lastSeen: Record<string, number>;
  // Ranked: set once when a ranked game finishes and ratings are applied, so
  // the rating update can't double-apply.
  rated: boolean;
  // Set by the host once a rematch is created from this (finished) game —
  // every connected client sees it via the live snapshot and can jump to the
  // new game without a fresh invite.
  rematchCode: string | null;
  // Best-of-series tally, carried forward across a chain of rematches: each
  // finish increments the sole winner's count on this field before the next
  // rematch copies it as the new game's starting value. {} for a standalone
  // game with no rematch history.
  seriesWins: Record<string, number>;
  // Most recent quick reaction. Last-write-wins (no history) — clients show it
  // briefly and clear it locally on a timer; not re-fetched from Firestore.
  emote: { uid: string; emoji: string; at: number } | null;
}

// Per-player ranked ladder stats, stored at rankedStats/{uid}. Updated only
// after a ranked game finishes. Rating is Elo (start 1000), computed pairwise
// across the game's final scores. See src/lib/ranking.ts.
export interface RankedStats {
  uid: string;
  name: string;
  rating: number;
  games: number;
  wins: number;
  bestScore: number;
  updatedAt?: number;
}

export const STARTING_RATING = 1000;
