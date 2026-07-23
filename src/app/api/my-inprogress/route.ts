import { NextResponse } from "next/server";
import { authAdmin } from "@/lib/firebaseAdmin";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { inProgressLive, inProgressSolo } from "@/lib/inProgress";

export const dynamic = "force-dynamic";

// Games this account started but hasn't finished — single-player boards with
// answers but no submitted score, and unranked live games still in progress.
export async function GET(request: Request) {
  if (!rateLimit(`inprogress:${clientIp(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const header = request.headers.get("authorization") ?? "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!idToken) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let uid: string;
  try {
    uid = (await authAdmin().verifyIdToken(idToken)).uid;
  } catch {
    return NextResponse.json({ error: "Invalid or expired session." }, { status: 401 });
  }

  try {
    const [solo, live] = await Promise.all([inProgressSolo(uid), inProgressLive(uid)]);
    return NextResponse.json({ solo, live });
  } catch (error) {
    console.error("in-progress fetch failed:", error);
    return NextResponse.json({ error: "Couldn't load in-progress games." }, { status: 500 });
  }
}
