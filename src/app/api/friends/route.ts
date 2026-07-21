import { NextResponse } from "next/server";
import { authAdmin } from "@/lib/firebaseAdmin";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import {
  acceptFriendRequest,
  clearInvite,
  declineRequest,
  inviteToGame,
  listFriendsData,
  sendFriendRequest,
  touchPresence,
} from "@/lib/friends";

export const dynamic = "force-dynamic";

const ADD_ERRORS: Record<string, string> = {
  "no-account": "No Daily Double account uses that email.",
  self: "That's you!",
  "already-friends": "You're already friends.",
};

async function authed(request: Request): Promise<{ uid: string; name: string } | null> {
  const header = request.headers.get("authorization") ?? "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!idToken) return null;
  try {
    const t = await authAdmin().verifyIdToken(idToken);
    return { uid: t.uid, name: (t.name as string) ?? (t.email as string) ?? "Player" };
  } catch {
    return null;
  }
}

// Poll: refresh the caller's presence, return friends (+ online) and inbox.
export async function GET(request: Request) {
  if (!rateLimit(`friends-get:${clientIp(request)}`, 40, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const me = await authed(request);
  if (!me) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  try {
    await touchPresence(me.uid, me.name);
    return NextResponse.json(await listFriendsData(me.uid));
  } catch (error) {
    console.error("friends list failed:", error);
    return NextResponse.json({ error: "Couldn't load friends." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!rateLimit(`friends-post:${clientIp(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const me = await authed(request);
  if (!me) return NextResponse.json({ error: "Sign in." }, { status: 401 });

  let body: { action?: string; email?: string; fromUid?: string; friendUid?: string; gameCode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "add":
        await sendFriendRequest(me.uid, me.name, body.email ?? "");
        return NextResponse.json({ ok: true });
      case "accept":
        await acceptFriendRequest(me.uid, me.name, body.fromUid ?? "");
        return NextResponse.json({ ok: true });
      case "decline":
        await declineRequest(me.uid, body.fromUid ?? "");
        return NextResponse.json({ ok: true });
      case "invite":
        await inviteToGame(me.uid, me.name, body.friendUid ?? "", body.gameCode ?? "");
        return NextResponse.json({ ok: true });
      case "clearInvite":
        await clearInvite(me.uid, body.fromUid ?? "");
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (error) {
    const key = error instanceof Error ? error.message : "";
    return NextResponse.json({ error: ADD_ERRORS[key] ?? "Couldn't do that." }, { status: 400 });
  }
}
