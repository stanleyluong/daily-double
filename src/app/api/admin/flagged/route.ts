import { NextResponse } from "next/server";
import type { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebaseAdmin";
import { isOwnerRequest } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

// Owner-only: read and resolve player-submitted clue reports (flaggedClues,
// written by /api/report-clue). Backs the /admin/flagged review page.

export async function GET(request: Request) {
  if (!(await isOwnerRequest(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const snap = await db().collection("flaggedClues").orderBy("createdAt", "desc").limit(300).get();
    const flags = snap.docs.map((d) => {
      const data = d.data();
      const createdAt = data.createdAt as Timestamp | undefined;
      return {
        id: d.id,
        boardKey: (data.boardKey as string) ?? "",
        clueId: (data.clueId as string) ?? "",
        category: (data.category as string) ?? "",
        clue: (data.clue as string) ?? "",
        correctAnswer: (data.correctAnswer as string) ?? "",
        reason: (data.reason as string) ?? "",
        resolved: Boolean(data.resolved),
        createdAt: createdAt ? createdAt.toDate().toISOString() : null,
      };
    });
    return NextResponse.json({ flags });
  } catch (error) {
    console.error("admin/flagged GET failed:", error);
    return NextResponse.json({ error: "Couldn't load reports." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await isOwnerRequest(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: { id?: unknown; resolved?: unknown };
  try {
    body = (await request.json()) as { id?: unknown; resolved?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: "Missing report id." }, { status: 400 });
  }
  try {
    await db().collection("flaggedClues").doc(body.id).update({ resolved: body.resolved !== false });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("admin/flagged POST failed:", error);
    return NextResponse.json({ error: "Couldn't update the report." }, { status: 500 });
  }
}
