import { NextResponse } from "next/server";
import { getBoardForDate, isValidDateKey, todayKey } from "@/lib/jeopardy";
import { submitScore, topScores } from "@/lib/scores";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Highest possible score: 6 categories x (200+400+600+800+1000).
const MAX_SCORE = 18_000;
const MAX_DURATION_MS = 6 * 60 * 60 * 1000;

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
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 30;
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
    score % 200 !== 0 ||
    !isCount(correct) ||
    !isCount(wrong) ||
    !isCount(passed) ||
    correct + wrong + passed > 30 ||
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

    await submitScore(date, { name, score, correct, wrong, passed, durationMs });
    return NextResponse.json({ ok: true, scores: await topScores(date) });
  } catch (error) {
    console.error("Score submit failed:", error);
    return NextResponse.json({ error: "Couldn't save your score." }, { status: 500 });
  }
}
