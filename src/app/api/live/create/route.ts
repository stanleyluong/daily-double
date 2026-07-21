import { NextResponse } from "next/server";
import { createGame } from "@/lib/liveGame";
import { uidFromRequest } from "@/lib/requestAuth";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!rateLimit(`live-create:${clientIp(request)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in to start a game." }, { status: 401 });

  let name = "";
  try {
    ({ name = "" } = (await request.json()) as { name?: string });
  } catch {
    /* name is optional */
  }

  try {
    const code = await createGame(uid, name);
    return NextResponse.json({ code });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't create the game." },
      { status: 400 }
    );
  }
}
