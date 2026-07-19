import { NextResponse } from "next/server";
import { getBoardForDate, isValidDateKey, todayKey } from "@/lib/jeopardy";
import { percentileFor, submitScore, topScores } from "@/lib/scores";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { authAdmin } from "@/lib/firebaseAdmin";

// Sign-in is required to submit a score (not to play) — this is the identity
// the one-submission-per-day rule in submitScore() keys on. An invalid or
// missing token means POST returns 401 rather than falling back to anonymous.
async function uidFromRequest(request: Request): Promise<string | undefined> {
  const header = request.headers.get("authorization") ?? "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!idToken) return undefined;
  try {
    return (await authAdmin().verifyIdToken(idToken)).uid;
  } catch {
    return undefined;
  }
}

export const dynamic = "force-dynamic";

// Generous safety cap, not a tight gameplay bound: face values alone total
// 18,000 (round 1) + 36,000 (round 2) = 54,000, but a Daily Double wager can
// exceed its clue's face value up to the player's current score, so the true
// ceiling depends on play. This just catches obviously-fabricated numbers.
const MAX_SCORE = 200_000;
const MAX_DURATION_MS = 6 * 60 * 60 * 1000;
// Two 30-clue rounds.
const TOTAL_CLUES = 60;

export async function GET(request: Request) {
  if (!rateLimit(`scores-get:${clientIp(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const date = new URL(request.url).searchParams.get("date") ?? todayKey();
  if (!isValidDateKey(date)) {
    return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  }
  try {
    return NextResponse.json({ scores: await topScores(date) });
  } catch (error) {
    console.error("Score fetch failed:", error);
    return NextResponse.json({ error: "Couldn't load scores." }, { status: 500 });
  }
}

interface SubmitRequest {
  date?: string;
  boardId?: string;
  name?: string;
  score?: number;
  correct?: number;
  wrong?: number;
  passed?: number;
  durationMs?: number;
}

function isCount(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= TOTAL_CLUES;
}

export async function POST(request: Request) {
  if (!rateLimit(`scores-post:${clientIp(request)}`, 5, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }

  let body: SubmitRequest;
  try {
    body = (await request.json()) as SubmitRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { date, boardId, score, correct, wrong, passed, durationMs } = body;
  const name = (body.name ?? "").replace(/\s+/g, " ").trim().slice(0, 24);

  if (!date || !isValidDateKey(date) || !boardId || name.length === 0) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (
    typeof score !== "number" ||
    !Number.isInteger(score) ||
    Math.abs(score) > MAX_SCORE ||
    score % 100 !== 0 || // face values are multiples of 200/400; wagers are multiples of 100
    !isCount(correct) ||
    !isCount(wrong) ||
    !isCount(passed) ||
    correct + wrong + passed > TOTAL_CLUES ||
    typeof durationMs !== "number" ||
    !Number.isInteger(durationMs) ||
    durationMs < 0 ||
    durationMs > MAX_DURATION_MS
  ) {
    return NextResponse.json({ error: "That score doesn't look right." }, { status: 400 });
  }

  try {
    const board = await getBoardForDate(date);
    if (!board) {
      return NextResponse.json({ error: "No board exists for that date." }, { status: 404 });
    }
    if (board.boardId !== boardId) {
      return NextResponse.json({ error: "board-changed" }, { status: 409 });
    }

    const uid = await uidFromRequest(request);
    if (!uid) {
      return NextResponse.json({ error: "Sign in to post your score." }, { status: 401 });
    }

    await submitScore(date, { name, score, correct, wrong, passed, durationMs, uid });
    const [scores, stats] = await Promise.all([topScores(date), percentileFor(date, score)]);
    return NextResponse.json({ ok: true, scores, stats });
  } catch (error) {
    if (error instanceof Error && error.message === "already-submitted") {
      return NextResponse.json({ error: "already-submitted" }, { status: 409 });
    }
    console.error("Score submit failed:", error);
    return NextResponse.json({ error: "Couldn't save your score." }, { status: 500 });
  }
}
