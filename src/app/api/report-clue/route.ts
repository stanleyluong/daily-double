import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebaseAdmin";
import { uidFromRequest } from "@/lib/requestAuth";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Player-flagged clue reports — a quality signal for the AI-written boards.
// Writes to the `flaggedClues` collection (reviewable in the Firestore console
// or a future admin view). Captures the clue's text/answer inline so a report
// is self-contained even if the board later changes. No sign-in required (the
// flag is low-stakes and best-effort), just an IP rate limit.
export async function POST(request: Request) {
  const ip = clientIp(request);
  if (!rateLimit(`report:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const date = typeof body.date === "string" ? body.date : "";
  const clueId = typeof body.clueId === "string" ? body.clueId : "";
  if (!date || !clueId) {
    return NextResponse.json({ error: "Missing clue reference." }, { status: 400 });
  }

  const uid = await uidFromRequest(request).catch(() => null);
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

  try {
    await db().collection("flaggedClues").add({
      boardKey: date.slice(0, 120),
      clueId: clueId.slice(0, 60),
      category: str(body.category, 120),
      clue: str(body.clue, 600),
      correctAnswer: str(body.correctAnswer, 200),
      reason: str(body.reason, 500),
      uid: uid ?? null,
      ip,
      resolved: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("report-clue write failed:", error);
    return NextResponse.json({ error: "Couldn't submit the report." }, { status: 500 });
  }
}
