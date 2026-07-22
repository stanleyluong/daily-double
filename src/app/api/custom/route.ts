import { NextResponse } from "next/server";
import { createCustomBoard } from "@/lib/jeopardy";
import { uidFromRequest } from "@/lib/requestAuth";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
// One or two parallel waves of clue generation plus a final — kept small so it
// fits the request window even for a two-round board.
export const maxDuration = 120;

export async function POST(request: Request) {
  // Generation costs real model calls, so gate it to signed-in users and rate-limit.
  if (!rateLimit(`custom:${clientIp(request)}`, 5, 60_000)) {
    return NextResponse.json({ error: "Slow down — one custom board at a time." }, { status: 429 });
  }
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in to create a board." }, { status: 401 });

  let categories: string[] = [];
  let roundCount: 1 | 2 = 1;
  try {
    const body = (await request.json()) as { categories?: unknown; rounds?: unknown };
    if (Array.isArray(body.categories)) categories = body.categories.map((c) => String(c));
    if (body.rounds === 2 || body.rounds === "2") roundCount = 2;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const clean = categories.map((c) => c.trim()).filter(Boolean).slice(0, roundCount === 2 ? 12 : 6);
  if (clean.length === 0) return NextResponse.json({ error: "Enter at least one category." }, { status: 400 });

  try {
    const key = await createCustomBoard(uid, clean, roundCount);
    return NextResponse.json({ key }); // "custom-{id}"
  } catch (error) {
    console.error("custom board generation failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't generate the board." },
      { status: 500 }
    );
  }
}
