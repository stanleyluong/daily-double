import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebaseAdmin";
import { ANSWER_MS, type LivePlayer } from "@/lib/liveTypes";
import { claimLiveBoard, gameRef, pickBoardDate, randomCode } from "@/lib/liveGame";

// 1v1 ranked matchmaking. Two collections:
//   matchQueue/{uid}    — one doc per queued player: status "waiting" | "matched"
//   matches/{matchId}   — a proposed pairing: ready_check -> ready | expired
//
// Flow: joinQueue() upserts the caller's queue doc, then immediately tries to
// pair with the longest-waiting other "waiting" doc via a transaction (so two
// simultaneous joins can't double-claim the same opponent — the loser of the
// race just falls back to waiting). Both players poll their queue doc; once
// matched, they poll the match doc, call readyUp(), and the second player to
// ready creates the actual ranked game and writes its code onto the match.

const READY_WINDOW_MS = 20_000;

function queueRef(uid: string) {
  return db().collection("matchQueue").doc(uid);
}
function matchRef(matchId: string) {
  return db().collection("matches").doc(matchId);
}
function randomMatchId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export interface QueueStatus {
  state: "idle" | "waiting" | "matched" | "expired";
  matchId: string | null;
}

export async function joinQueue(uid: string, name: string): Promise<QueueStatus> {
  await queueRef(uid).set({ uid, name, status: "waiting", matchId: null, queuedAt: Date.now() });
  return tryMatch(uid, name);
}

export async function leaveQueue(uid: string): Promise<void> {
  await queueRef(uid).delete();
}

export async function myQueueStatus(uid: string): Promise<QueueStatus> {
  const snap = await queueRef(uid).get();
  if (!snap.exists) return { state: "idle", matchId: null };
  const status = snap.get("status") as string;
  return { state: status === "matched" ? "matched" : "waiting", matchId: snap.get("matchId") ?? null };
}

// Looks for another waiting player and atomically claims a pairing with them.
// Tries a handful of candidates (oldest first) in case a race loses one.
async function tryMatch(uid: string, name: string): Promise<QueueStatus> {
  const candidates = await db()
    .collection("matchQueue")
    .where("status", "==", "waiting")
    .orderBy("queuedAt", "asc")
    .limit(6)
    .get();

  for (const doc of candidates.docs) {
    if (doc.id === uid) continue;
    const opponentUid = doc.id;
    const matchId = randomMatchId();
    try {
      const claimed = await db().runTransaction(async (tx) => {
        const [meSnap, oppSnap] = await Promise.all([tx.get(queueRef(uid)), tx.get(queueRef(opponentUid))]);
        if (!meSnap.exists || meSnap.get("status") !== "waiting") return false;
        if (!oppSnap.exists || oppSnap.get("status") !== "waiting") return false;
        const opponentName = String(oppSnap.get("name") ?? "Player");
        tx.set(queueRef(uid), { status: "matched", matchId }, { merge: true });
        tx.set(queueRef(opponentUid), { status: "matched", matchId }, { merge: true });
        tx.set(matchRef(matchId), {
          players: [
            { uid, name },
            { uid: opponentUid, name: opponentName },
          ],
          status: "ready_check",
          readyUids: [],
          gameCode: null,
          createdAt: Date.now(),
          expiresAt: Date.now() + READY_WINDOW_MS,
        });
        return true;
      });
      if (claimed) return { state: "matched", matchId };
    } catch {
      // race lost to a concurrent match — try the next candidate
    }
  }
  return { state: "waiting", matchId: null };
}

export interface MatchStatus {
  matchId: string;
  players: LivePlayer[];
  status: "ready_check" | "ready" | "expired";
  readyUids: string[];
  gameCode: string | null;
  expiresAt: number;
}

export async function getMatch(matchId: string): Promise<MatchStatus | null> {
  const snap = await matchRef(matchId).get();
  if (!snap.exists) return null;
  const d = snap.data()!;
  return {
    matchId,
    players: d.players ?? [],
    status: d.status,
    readyUids: d.readyUids ?? [],
    gameCode: d.gameCode ?? null,
    expiresAt: d.expiresAt,
  };
}

// Marks the caller ready. The player who completes the pair (both ready)
// creates the ranked game and writes its code onto the match doc, which both
// clients pick up on their next poll.
export async function readyUp(matchId: string, uid: string): Promise<{ gameCode: string | null }> {
  const ref = matchRef(matchId);
  const result = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("no-match");
    const d = snap.data()!;
    if (d.status === "expired") throw new Error("expired");
    if (Date.now() > d.expiresAt && d.status === "ready_check") {
      tx.update(ref, { status: "expired" });
      throw new Error("expired");
    }
    const players: LivePlayer[] = d.players ?? [];
    if (!players.some((p) => p.uid === uid)) throw new Error("not-in-match");
    const readyUids: string[] = Array.from(new Set([...(d.readyUids ?? []), uid]));
    const bothReady = players.every((p) => readyUids.includes(p.uid));
    if (!bothReady) {
      tx.update(ref, { readyUids });
      return { gameCode: null, shouldCreate: false, players: [] as LivePlayer[] };
    }
    if (d.gameCode) return { gameCode: d.gameCode as string, shouldCreate: false, players: [] as LivePlayer[] };
    tx.update(ref, { readyUids, status: "ready" });
    return { gameCode: null, shouldCreate: true, players };
  });

  if (!result.shouldCreate) return { gameCode: result.gameCode };

  const code = await createRankedMatchGame(result.players);
  await ref.update({ gameCode: code }).catch(() => {});
  // Clear both players' queue docs now that they have a game.
  await Promise.all(result.players.map((p) => queueRef(p.uid).delete().catch(() => {})));
  return { gameCode: code };
}

// Give up on a pending ready-check (or the caller navigated away): mark the
// match expired and clear both queue docs so both players land back at idle
// rather than stuck "matched" with a dead match.
export async function declineMatch(matchId: string, uid: string): Promise<void> {
  const snap = await matchRef(matchId).get();
  if (!snap.exists) return;
  const players: LivePlayer[] = snap.get("players") ?? [];
  if (!players.some((p) => p.uid === uid)) return;
  await matchRef(matchId).update({ status: "expired" }).catch(() => {});
  await Promise.all(players.map((p) => queueRef(p.uid).delete().catch(() => {})));
}

// Builds the actual ranked live game once both players are ready — same fixed
// ranked configuration createGame() enforces (fresh AI board, 10s timer,
// winner-only scoring, winner picks), seeded with both players directly
// (mirrors createRematch's seeding, since matchmaking already has consent).
async function createRankedMatchGame(players: LivePlayer[]): Promise<string> {
  const boardDate = await pickBoardDate();
  const scores: Record<string, number> = {};
  const lastSeen: Record<string, number> = {};
  for (const p of players) {
    scores[p.uid] = 0;
    lastSeen[p.uid] = Date.now();
  }

  let newCode: string | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomCode();
    try {
      await gameRef(code).create({
        status: "lobby",
        mode: "ranked",
        hostUid: players[0].uid,
        boardDate,
        boardId: null,
        answerMs: ANSWER_MS,
        scoringMode: "winner_only",
        pickMode: "winner",
        chat: [],
        players,
        playerUids: players.map((p) => p.uid),
        scores,
        phase: "lobby",
        roundIndex: 0,
        pickerUid: null,
        nextPickerUid: null,
        currentClueId: null,
        currentSubmittedUids: [],
        answeredClueIds: [],
        countdownEndsAt: null,
        answerEndsAt: null,
        finalWagers: {},
        finalWagerEndsAt: null,
        resolving: false,
        resolveClaimedAt: null,
        reveal: null,
        paused: false,
        pausedBy: null,
        pausedReason: null,
        pausedCountdownRemaining: null,
        pausedAnswerRemaining: null,
        lastSeen,
        rated: false,
        rematchCode: null,
        seriesWins: {},
        emote: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      newCode = code;
      break;
    } catch {
      // code taken — try another
    }
  }
  if (!newCode) throw new Error("Could not allocate a game code, try again.");
  const boardId = await claimLiveBoard(newCode);
  if (boardId) await gameRef(newCode).update({ boardId });
  return newCode;
}
