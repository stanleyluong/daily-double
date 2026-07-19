import { NextResponse } from "next/server";
import { getBoardForDate, isValidDateKey, todayKey, totalClueCount } from "@/lib/jeopardy";
import { percentileFor, submitScore, topScores } from "@/lib/scores";
import { answeredCluesForDate, summarize } from "@/lib/answers";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { authAdmin } from "@/lib/firebaseAdmin";

// Sign-in is required to submit — this is the identity the
// one-submission-per-day rule in submitScore() keys on. An invalid or
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
  durationMs?: number;
}

// Score, and the correct/wrong/passed counts, are no longer taken from the
// client — they're computed here from this account's server-recorded
// answeredClues (see src/lib/answers.ts). That's what makes the leaderboard
// number trustworthy: it's a sum of judgments the server itself made, not an
// assertion the client is free to fabricate. Duration is still client-timed
// (only affects tie-breaking/display, not the score), so it's kept
// plausibility-checked rather than reconstructed from judgedAt timestamps.
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

  const { date, boardId, durationMs } = body;
  const name = (body.name ?? "").replace(/\s+/g, " ").trim().slice(0, 24);

  if (
    !date ||
    !isValidDateKey(date) ||
    !boardId ||
    name.length === 0 ||
    typeof durationMs !== "number" ||
    !Number.isInteger(durationMs) ||
    durationMs < 0 ||
    durationMs > MAX_DURATION_MS
  ) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
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

    const answered = await answeredCluesForDate(uid, date);
    const total = totalClueCount(board);
    if (answered.length < total) {
      return NextResponse.json(
        { error: "You haven't finished today's board yet." },
        { status: 400 }
      );
    }

    const totals = summarize(answered);
    await submitScore(date, {
      name,
      score: totals.score,
      correct: totals.correct,
      wrong: totals.wrong,
      passed: totals.passed,
      durationMs,
      uid,
    });
    const [scores, stats] = await Promise.all([topScores(date), percentileFor(date, totals.score)]);
    return NextResponse.json({ ok: true, scores, stats, final: totals });
  } catch (error) {
    if (error instanceof Error && error.message === "already-submitted") {
      return NextResponse.json({ error: "already-submitted" }, { status: 409 });
    }
    console.error("Score submit failed:", error);
    return NextResponse.json({ error: "Couldn't save your score." }, { status: 500 });
  }
}
