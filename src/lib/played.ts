import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebaseAdmin";

// Tracks which boards a user has played, at users/{uid}/playedBoards/{key}.
// A "key" is a board key: a date (daily/historical) or a custom-{id}. Used to
// pick an unplayed historical episode in multiplayer, and by inProgressSolo
// (src/lib/inProgress.ts) to find boards started but not yet submitted.

function keyDocId(boardKey: string): string {
  // Board keys (dates, custom-xxx) are already Firestore-doc-id safe.
  return boardKey;
}

export async function markPlayed(uid: string, boardKey: string): Promise<void> {
  await db()
    .collection("users")
    .doc(uid)
    .collection("playedBoards")
    .doc(keyDocId(boardKey))
    .set({ boardKey, lastPlayedAt: FieldValue.serverTimestamp() }, { merge: true });
}

export async function playedKeys(uid: string): Promise<Set<string>> {
  const snap = await db().collection("users").doc(uid).collection("playedBoards").get();
  return new Set(snap.docs.map((d) => d.id));
}

// Picks a random historical episode the user hasn't played, for multiplayer's
// "fresh real episode" option. Falls back to any historical date if they've
// somehow played them all (or to null if none imported).
export async function pickUnplayedHistorical(uid: string): Promise<string | null> {
  const [refs, played] = await Promise.all([
    db().collection("historicalBoards").listDocuments(), // ids only, no doc reads
    playedKeys(uid),
  ]);
  const all = refs.map((r) => r.id);
  if (all.length === 0) return null;
  const unplayed = all.filter((d) => !played.has(d));
  const pool = unplayed.length > 0 ? unplayed : all;
  return pool[Math.floor(Math.random() * pool.length)];
}
