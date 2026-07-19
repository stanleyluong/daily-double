import { NextResponse } from "next/server";
import { findClue, getDailyBoard, judgeAnswer } from "@/lib/jeopardy";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface JudgeRequest {
  boardId?: string;
  clueId?: string;
  answer?: string;
  reveal?: boolean;
}

export async function POST(request: Request) {
  if (!rateLimit(`judge:${clientIp(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }

  let body: JudgeRequest;
  try {
    body = (await request.json()) as JudgeRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { boardId, clueId, answer, reveal } = body;
  if (!boardId || !clueId || (!reveal && typeof answer !== "string")) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (typeof answer === "string" && answer.length > 200) {
    return NextResponse.json({ error: "Answers are capped at 200 characters." }, { status: 400 });
  }

  try {
    const board = await getDailyBoard();
    if (board.boardId !== boardId) {
      // The cached board was regenerated (cache eviction / new day) since this
      // client loaded it — their clue IDs no longer mean anything.
      return NextResponse.json({ error: "board-changed" }, { status: 409 });
    }

    const found = findClue(board, clueId);
    if (!found) {
      return NextResponse.json({ error: "Unknown clue." }, { status: 404 });
    }

    if (reveal) {
      return NextResponse.json({
        correct: false,
        correctAnswer: found.clue.answer,
        comment: "",
      });
    }

    const verdict = await judgeAnswer(found.category, found.clue, answer!.trim());
    return NextResponse.json({
      correct: verdict.correct,
      correctAnswer: found.clue.answer,
      comment: verdict.comment,
    });
  } catch (error) {
    console.error("Judging failed:", error);
    return NextResponse.json(
      { error: "The judge stepped out. Try again." },
      { status: 500 }
    );
  }
}
