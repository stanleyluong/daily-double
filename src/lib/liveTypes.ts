// Pure types + constants shared by the live-game server logic (liveGame.ts,
// Admin SDK) and the client (useLiveGame hook, UI). No firebase-admin import
// here, so it's safe to pull into client components.

export const COUNTDOWN_MS = 3000;
export const ANSWER_MS = 10000;
export const MAX_PLAYERS = 3;

export type LiveMode = "normal" | "ranked";
export type LivePhase = "lobby" | "picking" | "active" | "reveal" | "finished";

export interface LivePlayer {
  uid: string;
  name: string;
}

export interface RevealResult {
  answer: string | null;
  outcome: "correct" | "wrong" | "none";
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
  players: LivePlayer[];
  playerUids: string[];
  scores: Record<string, number>;
  phase: LivePhase;
  roundIndex: number;
  pickerUid: string | null;
  currentClueId: string | null;
  currentSubmittedUids: string[];
  answeredClueIds: string[];
  countdownEndsAt: number | null;
  answerEndsAt: number | null;
  resolving: boolean;
  resolveClaimedAt: number | null;
  reveal: LiveReveal | null;
  // Pause (normal mode only; ranked games can't be paused). While paused, a
  // mid-clue timer is frozen by storing the remaining ms and recomputing the
  // absolute deadlines on resume.
  paused: boolean;
  pausedBy: string | null;
  pausedCountdownRemaining: number | null;
  pausedAnswerRemaining: number | null;
  // Ranked: set once when a ranked game finishes and ratings are applied, so
  // the rating update can't double-apply.
  rated: boolean;
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
