import { NextResponse } from "next/server";
import { findClue, getBoardForDate, isValidBoardKey, judgeAppeal, todayKey } from "@/lib/jeopardy";
import { claimAppeal, getAnsweredClue, hasUsedAppeal, updateClueOutcome } from "@/lib/answers";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { authAdmin } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

// Contest a "wrong" ruling. One appeal per board per account: the first one
// atomically claims the game's single appeal, then a second-opinion judge
// reconsiders generously. A granted appeal flips the recorded clue to correct
// (the score, computed from records, follows). Whether granted or not, the
// appeal is spent.
export async function POST(request: Request) {
  if (!rateLimit(`appeal:${clientIp(request)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const uid = await requireUid(request);
  if (!uid) return NextResponse.json({ error: "Sign in to play." }, { status: 401 });

  let body: { date?: string; boardId?: string; clueId?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const date = body.date ?? todayKey();
  const { boardId, clueId } = body;
  const reason = typeof body.reason === "string" ? body.reason : "";
  if (!isValidBoardKey(date) || !boardId || !clueId) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const board = await getBoardForDate(date);
    if (!board) return NextResponse.json({ error: "No board exists for that date." }, { status: 404 });
    if (board.boardId !== boardId) return NextResponse.json({ error: "board-changed" }, { status: 409 });

    const record = await getAnsweredClue(uid, date, clueId);
    if (!record || record.outcome !== "wrong" || !record.playerAnswer) {
      return NextResponse.json({ error: "You can only appeal a wrong ruling." }, { status: 400 });
    }

    if (await hasUsedAppeal(uid, date)) {
      return NextResponse.json({ error: "no-appeals-left" }, { status: 403 });
    }

    // Resolve the clue text/answer to re-judge against.
    let clue: { clue: string; answer: string; acceptable: string[] };
    let category: { title: string };
    if (clueId === "final") {
      if (!board.final) return NextResponse.json({ error: "No Final Jeopardy." }, { status: 404 });
      clue = board.final;
      category = { title: board.final.category };
    } else {
      const found = findClue(board, clueId);
      if (!found) return NextResponse.json({ error: "Unknown clue." }, { status: 404 });
      clue = found.clue;
      category = found.category;
    }

    // Claim the single appeal (atomic). If it's already spent, stop here.
    if (!(await claimAppeal(uid, date, clueId))) {
      return NextResponse.json({ error: "no-appeals-left" }, { status: 403 });
    }

    const verdict = await judgeAppeal(category, clue, record.playerAnswer, reason);
    const outcome = verdict.correct ? "correct" : "wrong";
    await updateClueOutcome(uid, date, clueId, outcome, verdict.comment);

    return NextResponse.json({
      granted: verdict.correct,
      outcome,
      comment: verdict.comment,
      correctAnswer: record.correctAnswer,
      pointValue: record.pointValue,
    });
  } catch (error) {
    console.error("Appeal failed:", error);
    return NextResponse.json({ error: "The judge stepped out. Try again." }, { status: 500 });
  }
}
