import { NextResponse } from "next/server";
import { declineMatch } from "@/lib/matchmaking";
import { uidFromRequest } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { matchId } = (await request.json()) as { matchId?: string };
    if (!matchId) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    await declineMatch(matchId, uid);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't decline." },
      { status: 400 }
    );
  }
}
