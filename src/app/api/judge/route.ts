import { NextResponse } from "next/server";
import {
  findClue,
  getBoardForDate,
  isValidBoardKey,
  judgeAnswer,
  roundTopValue,
  todayKey,
} from "@/lib/jeopardy";
import { getAnsweredClue, recordAnsweredClue, scoreSoFar } from "@/lib/answers";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { authAdmin } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface JudgeRequest {
  date?: string;
  boardId?: string;
  clueId?: string;
  answer?: string;
  reveal?: boolean;
  wager?: number; // only meaningful for a Daily Double or Final Jeopardy clue; server clamps it
}

async function requireUid(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!idToken) return null;
  try {
    return (await authAdmin().verifyIdToken(idToken)).uid;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!rateLimit(`judge:${clientIp(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }

  // Sign-in is required to play, not just to submit — this is what closes
  // the "learn the answers anonymously, then replay signed in" loophole.
  // Anonymous play has no identity for the per-clue record below to key on.
  const uid = await requireUid(request);
  if (!uid) {
    return NextResponse.json({ error: "Sign in to play." }, { status: 401 });
  }

  let body: JudgeRequest;
  try {
    body = (await request.json()) as JudgeRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { boardId, clueId, answer, reveal, wager } = body;
  const date = body.date ?? todayKey();
  if (!isValidBoardKey(date) || !boardId || !clueId || (!reveal && typeof answer !== "string")) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (typeof answer === "string" && answer.length > 200) {
    return NextResponse.json({ error: "Answers are capped at 200 characters." }, { status: 400 });
  }

  try {
    const board = await getBoardForDate(date);
    if (!board) {
      return NextResponse.json({ error: "No board exists for that date." }, { status: 404 });
    }
    if (board.boardId !== boardId) {
      // The client is holding a board the server no longer recognizes.
      return NextResponse.json({ error: "board-changed" }, { status: 409 });
    }

    // Resolve the clue + category + this clue's point value, branching on
    // Final Jeopardy vs a grid clue. Both converge on the same shape
    // (structural subsets judgeAnswer/recordAnsweredClue accept), so
    // everything from here down — idempotency, judging, recording — is
    // identical for both.
    let clue: { clue: string; answer: string; acceptable: string[] };
    let category: { title: string };
    let pointValue: number;

    if (clueId === "final") {
      if (!board.final) {
        return NextResponse.json(
          { error: "This board has no Final Jeopardy round." },
          { status: 404 }
        );
      }
      clue = board.final;
      category = { title: board.final.category };
      // Real rule: wager $0 to your current total; never below $0 even if
      // your score is negative.
      const earnedSoFar = await scoreSoFar(uid, date);
      const maxWager = Math.max(0, earnedSoFar);
      const requested = typeof wager === "number" && Number.isFinite(wager) ? Math.round(wager) : 0;
      pointValue = Math.min(maxWager, Math.max(0, requested));
    } else {
      const found = findClue(board, clueId);
      if (!found) {
        return NextResponse.json({ error: "Unknown clue." }, { status: 404 });
      }
      clue = found.clue;
      category = found.category;
      pointValue = found.clue.value;
      if (found.clue.dailyDouble) {
        const earnedSoFar = await scoreSoFar(uid, date);
        const maxWager = Math.max(earnedSoFar, roundTopValue(board, found.roundIndex));
        const requested = typeof wager === "number" && Number.isFinite(wager) ? Math.round(wager) : 5;
        pointValue = Math.min(maxWager, Math.max(5, requested));
      }
    }

    // Idempotent: a clue already judged for this account+date returns the
    // recorded verdict — right, wrong, or revealed — instead of judging
    // again. Wiping localStorage and reopening it changes nothing.
    const cached = await getAnsweredClue(uid, date, clueId);
    if (cached) {
      return NextResponse.json({
        outcome: cached.outcome,
        correctAnswer: cached.correctAnswer,
        comment: cached.comment,
        pointValue: cached.pointValue,
        cached: true,
      });
    }

    if (reveal) {
      const recorded = await recordAnsweredClue(uid, date, clueId, {
        outcome: "passed",
        correctAnswer: clue.answer,
        comment: "",
        pointValue,
      });
      return NextResponse.json({
        outcome: recorded.outcome,
        correctAnswer: recorded.correctAnswer,
        comment: recorded.comment,
        pointValue: recorded.pointValue,
        cached: false,
      });
    }

    const verdict = await judgeAnswer(category, clue, answer!.trim());
    const recorded = await recordAnsweredClue(uid, date, clueId, {
      outcome: verdict.correct ? "correct" : "wrong",
      correctAnswer: clue.answer,
      comment: verdict.comment,
      pointValue,
      playerAnswer: answer!.trim(),
    });
    return NextResponse.json({
      outcome: recorded.outcome,
      correctAnswer: recorded.correctAnswer,
      comment: recorded.comment,
      pointValue: recorded.pointValue,
      cached: false,
    });
  } catch (error) {
    console.error("Judging failed:", error);
    return NextResponse.json(
      { error: "The judge stepped out. Try again." },
      { status: 500 }
    );
  }
}
