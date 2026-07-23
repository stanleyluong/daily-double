import { NextResponse } from "next/server";
import { readyUp } from "@/lib/matchmaking";
import { uidFromRequest } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { matchId } = (await request.json()) as { matchId?: string };
    if (!matchId) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const result = await readyUp(matchId, uid);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't ready up." },
      { status: 400 }
    );
  }
}
