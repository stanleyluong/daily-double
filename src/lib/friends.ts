import { FieldValue } from "firebase-admin/firestore";
import { db, authAdmin } from "@/lib/firebaseAdmin";
import { headToHeadAllFor } from "@/lib/headToHead";

// Friends, presence, and invites — all server-side (Admin SDK) so no new
// client-read security rules are needed on the shared Firestore project.
// Clients poll GET /api/friends (~every 12s) for presence + inbox. Presence
// lives at presence/{uid}; friendships at users/{uid}/friends/{friendUid};
// incoming requests + game invites share users/{uid}/inbox/{id}.

const ONLINE_MS = 45_000;

function cleanName(name: string, fallback: string): string {
  return (name ?? "").replace(/\s+/g, " ").trim().slice(0, 24) || fallback;
}

export async function touchPresence(uid: string, name: string): Promise<void> {
  await db().collection("presence").doc(uid).set(
    { name: cleanName(name, "Player"), lastActive: Date.now() },
    { merge: true }
  );
}

// Piggybacks "what live game is this account currently in" onto the same
// presence doc, so the friends list can offer a direct Join button instead of
// requiring a shared code. status is null to clear it (left a game, or it
// finished) — only "lobby" is ever surfaced to friends as joinable.
export async function setPresenceGame(
  uid: string,
  gameCode: string | null,
  status: "lobby" | "in_progress" | null
): Promise<void> {
  await db()
    .collection("presence")
    .doc(uid)
    .set({ gameCode: gameCode, gameStatus: gameCode ? status : null }, { merge: true })
    .catch(() => {});
}

export interface FriendRow {
  uid: string;
  name: string;
  online: boolean;
  h2h?: { games: number; myWins: number; theirWins: number; ties: number };
  // Present only when the friend currently has an open (joinable) lobby.
  game?: { code: string };
}
export interface RequestRow {
  fromUid: string;
  fromName: string;
}
export interface InviteRow {
  fromUid: string;
  fromName: string;
  gameCode: string;
}

export async function listFriendsData(
  uid: string
): Promise<{ friends: FriendRow[]; requests: RequestRow[]; invites: InviteRow[] }> {
  const [friendsSnap, inboxSnap] = await Promise.all([
    db().collection("users").doc(uid).collection("friends").get(),
    db().collection("users").doc(uid).collection("inbox").get(),
  ]);

  const friendUids = friendsSnap.docs.map((d) => d.id);
  const [presence, h2h] = await Promise.all([
    Promise.all(friendUids.map((f) => db().collection("presence").doc(f).get())),
    headToHeadAllFor(uid),
  ]);
  const now = Date.now();
  const friends: FriendRow[] = friendsSnap.docs.map((d, i) => {
    const last = (presence[i].get("lastActive") as number | undefined) ?? 0;
    const rec = h2h[d.id];
    const gameCode = presence[i].get("gameCode") as string | undefined;
    const gameStatus = presence[i].get("gameStatus") as string | undefined;
    return {
      uid: d.id,
      name: (presence[i].get("name") as string | undefined) ?? (d.get("name") as string) ?? "Player",
      online: now - last < ONLINE_MS,
      ...(rec ? { h2h: { games: rec.games, myWins: rec.myWins, theirWins: rec.theirWins, ties: rec.ties } } : {}),
      ...(gameCode && gameStatus === "lobby" ? { game: { code: gameCode } } : {}),
    };
  });
  friends.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));

  const requests: RequestRow[] = [];
  const invites: InviteRow[] = [];
  for (const doc of inboxSnap.docs) {
    const d = doc.data();
    if (d.type === "request") requests.push({ fromUid: d.fromUid, fromName: d.fromName ?? "Someone" });
    else if (d.type === "invite")
      invites.push({ fromUid: d.fromUid, fromName: d.fromName ?? "A friend", gameCode: d.gameCode });
  }
  return { friends, requests, invites };
}

export async function sendFriendRequest(fromUid: string, fromName: string, toEmail: string): Promise<void> {
  let toUid: string;
  try {
    toUid = (await authAdmin().getUserByEmail(toEmail.trim())).uid;
  } catch {
    throw new Error("no-account"); // don't confirm/deny beyond this
  }
  if (toUid === fromUid) throw new Error("self");

  // Already friends? no-op.
  const existing = await db().collection("users").doc(fromUid).collection("friends").doc(toUid).get();
  if (existing.exists) throw new Error("already-friends");

  await db()
    .collection("users")
    .doc(toUid)
    .collection("inbox")
    .doc(`req_${fromUid}`)
    .set({ type: "request", fromUid, fromName: cleanName(fromName, "Someone"), at: FieldValue.serverTimestamp() });
}

export async function acceptFriendRequest(uid: string, uidName: string, fromUid: string): Promise<void> {
  const reqRef = db().collection("users").doc(uid).collection("inbox").doc(`req_${fromUid}`);
  const req = await reqRef.get();
  if (!req.exists) throw new Error("no-request");
  const fromName = (req.get("fromName") as string) ?? "Friend";

  const batch = db().batch();
  batch.set(db().collection("users").doc(uid).collection("friends").doc(fromUid), {
    name: fromName,
    since: FieldValue.serverTimestamp(),
  });
  batch.set(db().collection("users").doc(fromUid).collection("friends").doc(uid), {
    name: cleanName(uidName, "Friend"),
    since: FieldValue.serverTimestamp(),
  });
  batch.delete(reqRef);
  await batch.commit();
}

export async function declineRequest(uid: string, fromUid: string): Promise<void> {
  await db().collection("users").doc(uid).collection("inbox").doc(`req_${fromUid}`).delete();
}

export async function inviteToGame(
  fromUid: string,
  fromName: string,
  toUid: string,
  gameCode: string
): Promise<void> {
  const friend = await db().collection("users").doc(fromUid).collection("friends").doc(toUid).get();
  if (!friend.exists) throw new Error("not-friends");
  await db()
    .collection("users")
    .doc(toUid)
    .collection("inbox")
    .doc(`inv_${fromUid}`)
    .set({
      type: "invite",
      fromUid,
      fromName: cleanName(fromName, "A friend"),
      gameCode: gameCode.toUpperCase(),
      at: FieldValue.serverTimestamp(),
    });
}

export async function clearInvite(uid: string, fromUid: string): Promise<void> {
  await db().collection("users").doc(uid).collection("inbox").doc(`inv_${fromUid}`).delete();
}
