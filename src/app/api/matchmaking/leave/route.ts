import { NextResponse } from "next/server";
import { leaveQueue } from "@/lib/matchmaking";
import { uidFromRequest } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const uid = await uidFromRequest(request);
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  await leaveQueue(uid);
  return NextResponse.json({ ok: true });
}
