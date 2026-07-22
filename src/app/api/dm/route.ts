import { NextResponse } from "next/server";
import { authAdmin } from "@/lib/firebaseAdmin";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { dmUnread, listDm, sendDm } from "@/lib/dm";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  "not-friends": "You can only message friends.",
  self: "That's you!",
  empty: "Type a message first.",
};

async function authed(request: Request): Promise<{ uid: string; name: string } | null> {
  const header = request.headers.get("authorization") ?? "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!idToken) return null;
  try {
    const t = await authAdmin().verifyIdToken(idToken);
    return { uid: t.uid, name: (t.name as string) ?? (t.email as string) ?? "Friend" };
  } catch {
    return null;
  }
}

// GET ?with=UID → messages of that thread (and marks them read).
// GET (no param) → { unread: {uid: count} } for badges.
export async function GET(request: Request) {
  if (!rateLimit(`dm-get:${clientIp(request)}`, 60, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const me = await authed(request);
  if (!me) return NextResponse.json({ error: "Sign in." }, { status: 401 });

  const withUid = new URL(request.url).searchParams.get("with");
  try {
    if (withUid) return NextResponse.json({ messages: await listDm(me.uid, withUid) });
    return NextResponse.json({ unread: await dmUnread(me.uid) });
  } catch (error) {
    const key = error instanceof Error ? error.message : "";
    return NextResponse.json({ error: ERRORS[key] ?? "Couldn't load messages." }, { status: 400 });
  }
}

// POST { toUid, text } → send a DM.
export async function POST(request: Request) {
  if (!rateLimit(`dm-post:${clientIp(request)}`, 40, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const me = await authed(request);
  if (!me) return NextResponse.json({ error: "Sign in." }, { status: 401 });

  let body: { toUid?: string; text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  try {
    await sendDm(me.uid, me.name, body.toUid ?? "", body.text ?? "");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const key = error instanceof Error ? error.message : "";
    return NextResponse.json({ error: ERRORS[key] ?? "Couldn't send that." }, { status: 400 });
  }
}
