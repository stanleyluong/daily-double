import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebaseAdmin";

// Direct messages between friends — server-side only (Admin SDK), same as the
// friends system, so no new client-read rules are needed on the shared
// Firestore project. Clients poll GET /api/dm.
//
//   dms/{convId}/messages/{autoId}   — the thread ({fromUid, name, text, at})
//   users/{uid}/dmState/{withUid}    — per-viewer { unread, lastAt }
//
// convId is the two uids sorted and joined, so both participants map to the
// same thread regardless of who opened it.

const MAX_MESSAGES = 60;

function convId(a: string, b: string): string {
  return [a, b].sort().join("__");
}

function cleanName(name: string, fallback: string): string {
  return (name ?? "").replace(/\s+/g, " ").trim().slice(0, 24) || fallback;
}

async function areFriends(uid: string, other: string): Promise<boolean> {
  const snap = await db().collection("users").doc(uid).collection("friends").doc(other).get();
  return snap.exists;
}

export interface DmMessage {
  id: string;
  fromUid: string;
  name: string;
  text: string;
  at: number;
}

export async function sendDm(fromUid: string, fromName: string, toUid: string, text: string): Promise<void> {
  const clean = (text ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
  if (!clean) throw new Error("empty");
  if (toUid === fromUid) throw new Error("self");
  if (!(await areFriends(fromUid, toUid))) throw new Error("not-friends");

  const cid = convId(fromUid, toUid);
  const now = Date.now();
  await db()
    .collection("dms")
    .doc(cid)
    .collection("messages")
    .add({ fromUid, name: cleanName(fromName, "Friend"), text: clean, at: FieldValue.serverTimestamp() });

  // Bump the recipient's unread count; record lastAt for both sides' threads.
  await Promise.all([
    db()
      .collection("users")
      .doc(toUid)
      .collection("dmState")
      .doc(fromUid)
      .set({ unread: FieldValue.increment(1), lastAt: now }, { merge: true }),
    db()
      .collection("users")
      .doc(fromUid)
      .collection("dmState")
      .doc(toUid)
      .set({ lastAt: now }, { merge: true }),
  ]);
}

// Fetch the most recent messages of a thread (oldest→newest) and mark them read
// for the caller.
export async function listDm(uid: string, withUid: string, limit = MAX_MESSAGES): Promise<DmMessage[]> {
  if (!(await areFriends(uid, withUid))) throw new Error("not-friends");
  const cid = convId(uid, withUid);
  const snap = await db()
    .collection("dms")
    .doc(cid)
    .collection("messages")
    .orderBy("at", "desc")
    .limit(Math.min(limit, MAX_MESSAGES))
    .get();

  const messages: DmMessage[] = snap.docs
    .map((d) => {
      const at = d.get("at");
      return {
        id: d.id,
        fromUid: d.get("fromUid") as string,
        name: (d.get("name") as string) ?? "Friend",
        text: (d.get("text") as string) ?? "",
        at: at && typeof at.toMillis === "function" ? at.toMillis() : 0,
      };
    })
    .reverse();

  // Reading the thread clears the caller's unread badge for it.
  await db().collection("users").doc(uid).collection("dmState").doc(withUid).set({ unread: 0 }, { merge: true });

  return messages;
}

// Map of withUid → unread count (only entries with unread > 0), for badges.
export async function dmUnread(uid: string): Promise<Record<string, number>> {
  const snap = await db().collection("users").doc(uid).collection("dmState").get();
  const out: Record<string, number> = {};
  snap.forEach((d) => {
    const n = (d.get("unread") as number | undefined) ?? 0;
    if (n > 0) out[d.id] = n;
  });
  return out;
}
