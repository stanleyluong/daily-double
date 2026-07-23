import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebaseAdmin";

// Pairwise win/loss record between two players across all finished live
// games (any mode) they've shared. Keyed by the sorted uid pair so both
// directions land on the same doc; "A" always means the alphabetically-first
// uid, and the reader below flips the view for whichever uid is "me".
function pairDocId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join("__");
}

export async function recordHeadToHead(
  players: { uid: string; name: string }[],
  scores: Record<string, number>
): Promise<void> {
  const writes: Promise<unknown>[] = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const p1 = players[i];
      const p2 = players[j];
      const [first, second] = [p1, p2].sort((a, b) => (a.uid < b.uid ? -1 : 1));
      const s1 = scores[first.uid] ?? 0;
      const s2 = scores[second.uid] ?? 0;
      const ref = db().collection("headToHead").doc(pairDocId(first.uid, second.uid));
      writes.push(
        ref
          .set(
            {
              uidA: first.uid,
              uidB: second.uid,
              nameA: first.name,
              nameB: second.name,
              games: FieldValue.increment(1),
              winsA: FieldValue.increment(s1 > s2 ? 1 : 0),
              winsB: FieldValue.increment(s2 > s1 ? 1 : 0),
              ties: FieldValue.increment(s1 === s2 ? 1 : 0),
            },
            { merge: true }
          )
          .catch(() => {})
      );
    }
  }
  await Promise.all(writes);
}

export interface HeadToHeadRow {
  friendUid: string;
  friendName: string;
  games: number;
  myWins: number;
  theirWins: number;
  ties: number;
}

export async function headToHeadFor(uid: string, friendUid: string): Promise<HeadToHeadRow | null> {
  const snap = await db().collection("headToHead").doc(pairDocId(uid, friendUid)).get();
  if (!snap.exists) return null;
  const d = snap.data()!;
  const iAmA = d.uidA === uid;
  return {
    friendUid,
    friendName: String(iAmA ? d.nameB : d.nameA),
    games: Number(d.games ?? 0),
    myWins: Number(iAmA ? d.winsA : d.winsB) || 0,
    theirWins: Number(iAmA ? d.winsB : d.winsA) || 0,
    ties: Number(d.ties ?? 0),
  };
}

// All head-to-head records this account is in, keyed by the other uid.
export async function headToHeadAllFor(uid: string): Promise<Record<string, HeadToHeadRow>> {
  const [asA, asB] = await Promise.all([
    db().collection("headToHead").where("uidA", "==", uid).get(),
    db().collection("headToHead").where("uidB", "==", uid).get(),
  ]);
  const out: Record<string, HeadToHeadRow> = {};
  asA.forEach((doc) => {
    const d = doc.data();
    out[d.uidB] = {
      friendUid: d.uidB,
      friendName: String(d.nameB),
      games: Number(d.games ?? 0),
      myWins: Number(d.winsA ?? 0),
      theirWins: Number(d.winsB ?? 0),
      ties: Number(d.ties ?? 0),
    };
  });
  asB.forEach((doc) => {
    const d = doc.data();
    out[d.uidA] = {
      friendUid: d.uidA,
      friendName: String(d.nameA),
      games: Number(d.games ?? 0),
      myWins: Number(d.winsB ?? 0),
      theirWins: Number(d.winsA ?? 0),
      ties: Number(d.ties ?? 0),
    };
  });
  return out;
}
