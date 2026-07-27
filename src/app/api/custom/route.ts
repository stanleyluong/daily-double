import { NextResponse } from "next/server";
import { createCustomBoard } from "@/lib/jeopardy";
import { uidFromRequest } from "@/lib/requestAuth";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { allowCustomBoardForIp, allowGlobalCustomBoard } from "@/lib/usageLimits";

export const dynamic = "force-dynamic";
// One or two parallel waves of clue generation plus a final — kept small so it
// fits the request window even for a two-round board.
export const maxDuration = 120;

export async function POST(request: Request) {
  // Layered spend guards for the app's most expensive path (~15 model calls per
  // board, uncached): a cheap in-memory burst filter first, then durable
  // per-IP-per-day and global-per-day ceilings (Firestore-backed, so they
  // survive restarts and span instances). Order matters — the per-IP check
  // consumes its slot before the global one, so a single IP retrying can't
  // drain the global ceiling on denied attempts. All of this sits under the
  // Anthropic Console spend cap, which is the real backstop.
  const ip = clientIp(request);
  if (!rateLimit(`custom:${ip}`, 5, 60_000)) {
    return NextResponse.json({ error: "Slow down — one custom board at a time." }, { status: 429 });
  }
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in to create a board." }, { status: 401 });

  if (!(await allowCustomBoardForIp(ip))) {
    return NextResponse.json(
      { error: "You've already created a custom board today. Try again tomorrow." },
      { status: 429 }
    );
  }
  if (!(await allowGlobalCustomBoard())) {
    return NextResponse.json(
      { error: "Custom boards are at capacity for today — please try again tomorrow." },
      { status: 503 }
    );
  }

  let categories: string[] = [];
  let roundCount: 1 | 2 = 1;
  let name = "";
  try {
    const body = (await request.json()) as { categories?: unknown; rounds?: unknown; name?: unknown };
    if (Array.isArray(body.categories)) categories = body.categories.map((c) => String(c));
    if (body.rounds === 2 || body.rounds === "2") roundCount = 2;
    if (typeof body.name === "string") name = body.name;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const clean = categories.map((c) => c.trim()).filter(Boolean).slice(0, roundCount === 2 ? 12 : 6);
  if (clean.length === 0) return NextResponse.json({ error: "Enter at least one category." }, { status: 400 });

  try {
    const key = await createCustomBoard(uid, clean, roundCount, name);
    return NextResponse.json({ key }); // "custom-{id}"
  } catch (error) {
    console.error("custom board generation failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't generate the board." },
      { status: 500 }
    );
  }
}
