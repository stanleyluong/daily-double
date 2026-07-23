import { NextResponse } from "next/server";
import { joinQueue } from "@/lib/matchmaking";
import { uidFromRequest } from "@/lib/requestAuth";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!rateLimit(`mm-join:${clientIp(request)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { name } = (await request.json().catch(() => ({}))) as { name?: string };
    const status = await joinQueue(uid, (name ?? "Player").slice(0, 24));
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Couldn't join the queue." },
      { status: 400 }
    );
  }
}
