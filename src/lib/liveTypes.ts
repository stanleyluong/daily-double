// Pure types + constants shared by the live-game server logic (liveGame.ts,
// Admin SDK) and the client (useLiveGame hook, UI). No firebase-admin import
// here, so it's safe to pull into client components.

export const COUNTDOWN_MS = 3000;
export const ANSWER_MS = 10000;
export const MAX_PLAYERS = 3;

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
}
