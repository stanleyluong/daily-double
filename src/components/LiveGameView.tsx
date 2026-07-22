"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublicBoard } from "@/lib/jeopardy";
import { useAuth } from "@/components/AuthProvider";
import { useLiveGame } from "@/lib/useLiveGame";
import {
  liveContinue,
  liveFinalWager,
  liveHeartbeat,
  liveLeave,
  livePause,
  livePick,
  liveReportDrop,
  liveJoin,
  liveResolve,
  liveStart,
  liveStartFinal,
  liveSubmit,
  liveChat,
} from "@/lib/liveActions";
import { formatMoney } from "@/lib/format";
import { DISCONNECT_MS, HEARTBEAT_MS, type LiveChatMessage, type LiveReveal } from "@/lib/liveTypes";
import { isMuted, playSound, setMuted, type SoundName } from "@/lib/sounds";
import { useFriends } from "@/components/FriendsProvider";
import { inviteFriend } from "@/lib/friendsClient";

// Derived sub-phase of an "active" clue, computed from the absolute deadlines
// on the game doc against the local clock (good enough for a casual game; a
// server-time offset estimate is the future hardening).
type SubPhase = "countdown" | "answering" | "timeup";

// Terse server error codes → messages worth showing a human. Codes not listed
// here (and the benign race codes handled in `run`) fall back to a generic
// message rather than leaking an internal code into a toast.
const FRIENDLY_ERROR: Record<string, string> = {
  paused: "The game is paused.",
  "not-a-player": "You're not in this game.",
  "no-game": "This game no longer exists.",
  "game-full": "This game is full.",
  "already-started": "This game has already started.",
};

export default function LiveGameView({ gameId }: { gameId: string }) {
  const { user } = useAuth();
  // Auto-join on arrival (idempotent for existing members) BEFORE subscribing,
  // so someone who followed an invite/link becomes a game member and the
  // Firestore listener isn't immediately permission-denied.
  const [joined, setJoined] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const joinTriedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user) return;
    if (joinTriedRef.current === gameId) return;
    joinTriedRef.current = gameId;
    liveJoin(user, gameId, user.displayName ?? "")
      .then(() => setJoined(true))
      .catch((e) => setJoinError(e instanceof Error ? e.message : "Couldn't join this game."));
  }, [user, gameId]);

  const { game, error, loading } = useLiveGame(gameId, joined);
  const [board, setBoard] = useState<PublicBoard | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [input, setInput] = useState("");
  const [submittedClue, setSubmittedClue] = useState<string | null>(null);
  const [seenClueId, setSeenClueId] = useState<string | null | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [muted, setMutedState] = useState(() => (typeof window !== "undefined" ? isMuted() : false));
  const [viewBoard, setViewBoard] = useState(false); // non-picker chose to watch the board
  const resolvedFiredFor = useRef<string | null>(null);
  const droppedFlaggedRef = useRef<Set<string>>(new Set());

  const sfx = useCallback((name: SoundName) => playSound(name), []);

  // Reset the answer box when a new clue opens — render-time reset rather
  // than an effect (avoids a cascading render for a render-time decision).
  if (game?.currentClueId !== seenClueId) {
    setSeenClueId(game?.currentClueId ?? null);
    setInput("");
    setSubmittedClue(null);
    setViewBoard(false); // start each waiting period on the last results
  }

  // Keep the most recent reveal so non-pickers can keep viewing the last
  // results after someone hits Continue (the game doc clears reveal on
  // continue). game changes only on snapshot, so this doesn't loop.
  const [lastReveal, setLastReveal] = useState<LiveReveal | null>(null);
  if (game?.reveal && game.reveal !== lastReveal) setLastReveal(game.reveal);

  const uid = user?.uid ?? null;

  // Tick a local clock while a clue is live, to drive the countdown/timer.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  // Fetch the (answer-free) public board for this game once it exists. Uses
  // the game-scoped endpoint so it works for a pooled fresh board or the
  // fallback daily board alike.
  useEffect(() => {
    if (!game) return;
    let cancelled = false;
    fetch(`/api/live/board?gameId=${gameId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d && !d.error) setBoard(d as PublicBoard);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Only refetch when the underlying board identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, game?.boardId, game?.boardDate]);

  const showToast = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        const code = e instanceof Error ? e.message : "";
        // Realtime races: you acted a beat after the game moved on. The live
        // snapshot already shows the right screen, so don't nag with a toast.
        if (code === "bad-phase" || code === "too-late" || code === "resolving") return;
        showToast(FRIENDLY_ERROR[code] ?? "Something went wrong.");
      }
    },
    [showToast]
  );

  const subPhase: SubPhase | null = useMemo(() => {
    if (!game || game.phase !== "active" || game.countdownEndsAt === null || game.answerEndsAt === null) {
      return null;
    }
    if (game.paused) return "answering"; // frozen; overlay covers it, resolve is gated
    if (now < game.countdownEndsAt) return "countdown";
    if (now < game.answerEndsAt) return "answering";
    return "timeup";
  }, [game, now]);

  // Any client fires resolve once, when the answer window closes (never while paused).
  useEffect(() => {
    if (!game || !user || game.paused) return;
    if (game.phase === "active" && subPhase === "timeup" && resolvedFiredFor.current !== game.currentClueId) {
      resolvedFiredFor.current = game.currentClueId;
      run(() => liveResolve(user, game.id));
    }
    if (game.phase !== "active") resolvedFiredFor.current = null;
  }, [game, subPhase, user, run]);

  // Open the final clue once the wager window closes (any client fires it).
  const finalStartFiredRef = useRef(false);
  useEffect(() => {
    if (!game || !user) return;
    if (
      game.phase === "final_wager" &&
      game.finalWagerEndsAt !== null &&
      now > game.finalWagerEndsAt &&
      !finalStartFiredRef.current
    ) {
      finalStartFiredRef.current = true;
      run(() => liveStartFinal(user, game.id));
    }
    if (game.phase !== "final_wager") finalStartFiredRef.current = false;
  }, [game, now, user, run]);

  // Presence heartbeat — ping while the game is running so others can see
  // this player is still connected. Depends only on status (not the whole
  // game object) so heartbeat writes don't restart the interval and loop.
  const gameStatus = game?.status;
  useEffect(() => {
    if (!user || gameStatus !== "in_progress") return;
    const ping = () => liveHeartbeat(user, gameId).catch(() => {});
    ping();
    const t = setInterval(ping, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [user, gameStatus, gameId]);

  // Disconnect detection: a connected client watches the others' heartbeats.
  // On a drop it reports it (auto-pausing the game) and notifies; on a return
  // it notifies. Edge-triggered via droppedFlaggedRef so it fires once each.
  useEffect(() => {
    if (!game || !user || game.status !== "in_progress") return;
    const flagged = droppedFlaggedRef.current;
    for (const p of game.players) {
      if (p.uid === uid) continue;
      const seen = game.lastSeen?.[p.uid] ?? 0;
      const stale = now - seen > DISCONNECT_MS;
      if (stale && !flagged.has(p.uid)) {
        flagged.add(p.uid);
        // Edge-triggered notification + auto-pause on a real drop.
        showToast(`${p.name} disconnected — game paused.`);
        if (!game.paused) run(() => liveReportDrop(user, game.id, p.uid));
      } else if (!stale && flagged.has(p.uid)) {
        flagged.delete(p.uid);
        showToast(`${p.name} reconnected.`);
      }
    }
  }, [game, now, uid, user, run, showToast]);

  // Sound cues, edge-triggered off game transitions.
  const soundStateRef = useRef({ countdownSec: -1, revealClue: "", finished: false, pickForMe: false });
  useEffect(() => {
    if (!game || muted) return;
    const s = soundStateRef.current;
    // Countdown 3-2-1 ticks, then "go" when the clue opens.
    if (game.phase === "active" && !game.paused && game.countdownEndsAt) {
      if (now < game.countdownEndsAt) {
        const sec = Math.ceil((game.countdownEndsAt - now) / 1000);
        if (sec !== s.countdownSec && sec > 0) {
          s.countdownSec = sec;
          sfx("tick");
        }
      } else if (s.countdownSec !== 0) {
        s.countdownSec = 0;
        sfx("go");
      }
    } else {
      s.countdownSec = -1;
    }
    // Reveal — play based on my own outcome.
    if (game.phase === "reveal" && game.reveal && s.revealClue !== game.reveal.clueId) {
      s.revealClue = game.reveal.clueId;
      const mine = uid ? game.reveal.results[uid]?.outcome : "none";
      sfx(mine === "correct" ? "correct" : mine === "wrong" ? "wrong" : "timeup");
    }
    if (game.phase !== "reveal") s.revealClue = "";
    // My turn to pick.
    const myPick = game.phase === "picking" && game.pickerUid === uid;
    if (myPick && !s.pickForMe) {
      s.pickForMe = true;
      sfx("pick");
    } else if (!myPick) {
      s.pickForMe = false;
    }
    // Game over.
    if (game.phase === "finished" && !s.finished) {
      s.finished = true;
      const ranked = [...game.players].sort((a, b) => (game.scores[b.uid] ?? 0) - (game.scores[a.uid] ?? 0));
      sfx(ranked[0]?.uid === uid ? "win" : "lose");
    }
  }, [game, now, uid, muted, sfx]);

  if (joinError) {
    const friendly =
      joinError === "already-started"
        ? "That game has already started."
        : joinError === "game-full"
          ? "That game is full (3 players)."
          : joinError === "no-game"
            ? "That game doesn't exist."
            : joinError;
    return (
      <Centered>
        <p className="text-red-300 mb-4">{friendly}</p>
        <Link href="/live" className="text-gold underline">
          Back to Play with Friends
        </Link>
      </Centered>
    );
  }
  if (!user) {
    return <Centered>Sign in to join this game.</Centered>;
  }
  if (!joined || loading) {
    return <Centered>Joining game…</Centered>;
  }
  if (error || !game) {
    return (
      <Centered>
        <p className="text-red-300 mb-4">{error ?? "Game not found."}</p>
        <Link href="/live" className="text-gold underline">
          Back to Play with Friends
        </Link>
      </Centered>
    );
  }

  const isMember = uid !== null && game.playerUids.includes(uid);
  const isHost = uid === game.hostUid;
  const isPicker = uid === game.pickerUid;
  const nameFor = (id: string) => game.players.find((p) => p.uid === id)?.name ?? "Player";
  const round = board?.rounds[game.roundIndex];

  const share = async () => {
    try {
      await navigator.clipboard.writeText(game.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-8">
        {/* Header + scoreboard */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3">
              <Link
                href="/live"
                onClick={() => {
                  if (user) liveLeave(user, game.id).catch(() => {});
                }}
                className="text-xs text-blue-200/50 hover:text-gold"
              >
                ← Leave
              </Link>
              <button
                onClick={() => {
                  const next = !muted;
                  setMuted(next);
                  setMutedState(next);
                }}
                className="text-xs text-blue-200/50 hover:text-gold"
                title={muted ? "Unmute" : "Mute"}
              >
                {muted ? "🔇 Sound off" : "🔊 Sound on"}
              </button>
            </div>
            <h1 className="font-display text-2xl tracking-wider text-gold mt-1 flex items-center gap-2">
              Game <span className="tracking-[0.2em]">{game.id}</span>
              <span
                className={`text-[10px] font-mono tracking-wider px-2 py-0.5 rounded-full align-middle ${
                  game.mode === "ranked"
                    ? "bg-gold text-board-deep"
                    : "border border-blue-300/30 text-blue-200/70"
                }`}
              >
                {game.mode === "ranked" ? "RANKED" : "NORMAL"}
              </span>
            </h1>
            {/* Pause control — normal mode, in-progress only */}
            {game.mode === "normal" && game.status === "in_progress" && (
              <button
                onClick={() => run(() => livePause(user!, game.id, !game.paused))}
                className="mt-2 text-xs font-mono uppercase tracking-wider text-blue-200/60 hover:text-gold"
              >
                {game.paused ? "▶ Resume" : "❚❚ Pause"}
              </button>
            )}
          </div>
          <Scoreboard game={game} uid={uid} nameFor={nameFor} />
        </div>

        {/* Lobby */}
        {game.phase === "lobby" && (
          <div className="bg-board-deep/60 border border-board rounded-lg p-8 text-center max-w-md mx-auto">
            <p className="kicker text-gold font-mono text-xs uppercase tracking-widest mb-2">Waiting to start</p>
            <p className="text-blue-200/70 mb-4">Share this code so friends can join:</p>
            <button
              onClick={share}
              className="font-display text-5xl tracking-[0.3em] text-gold mb-1 hover:opacity-80"
              title="Copy code"
            >
              {game.id}
            </button>
            <p className="text-xs text-blue-200/40 mb-6 h-4">{copied ? "Copied!" : "Tap to copy"}</p>

            <div className="space-y-2 mb-6">
              {game.players.map((p) => (
                <p key={p.uid} className="text-blue-100">
                  {p.name}
                  {p.uid === game.hostUid && <span className="text-blue-200/40 text-xs ml-2">host</span>}
                </p>
              ))}
              {game.players.length < 3 && (
                <p className="text-blue-200/40 text-sm">Waiting for players… ({game.players.length}/3)</p>
              )}
            </div>

            {/* House rules for this game */}
            <div className="flex flex-wrap justify-center gap-2 mb-6 text-[11px]">
              {[
                `${game.answerMs / 1000}s to answer`,
                game.scoringMode === "winner_only" ? "Only fastest scores" : "All correct score",
                game.pickMode === "alternating"
                  ? "Alternating picks"
                  : game.pickMode === "loser"
                    ? "Loser picks"
                    : "Winner picks",
              ].map((r) => (
                <span
                  key={r}
                  className="px-2.5 py-1 rounded-full border border-[color:var(--hairline)] text-blue-200/70"
                >
                  {r}
                </span>
              ))}
            </div>

            {isHost ? (
              <button
                onClick={() => run(() => liveStart(user!, game.id))}
                className="font-display text-xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-8 py-2 rounded"
              >
                Start game
              </button>
            ) : (
              <p className="text-blue-200/60">Waiting for {nameFor(game.hostUid)} to start…</p>
            )}
            {!isMember && <p className="text-red-300 text-sm mt-4">You&apos;re not in this game.</p>}

            <InviteFriends gameCode={game.id} playerUids={game.playerUids} />
          </div>
        )}

        {/* Picking — only the picker returns to the board; everyone else keeps
            viewing the last results until it's their turn or the clue opens. */}
        {game.phase === "picking" &&
          (isPicker ? (
            <div>
              <p className="text-center mb-4 text-gold font-display text-xl tracking-wide">
                Your pick — choose a clue
              </p>
              <LiveBoard game={game} round={round} canPick onPick={(id) => run(() => livePick(user!, game.id, id))} />
            </div>
          ) : lastReveal && !viewBoard ? (
            <div>
              <p className="text-center mb-3 text-blue-200/70">
                Waiting for {nameFor(game.pickerUid ?? "")}{" "}to pick — here&apos;s the last one:
              </p>
              <div className="text-center mb-4">
                <button
                  onClick={() => setViewBoard(true)}
                  className="text-sm font-display tracking-wide border border-gold/40 text-gold hover:bg-board px-4 py-1.5 rounded"
                >
                  See the board →
                </button>
              </div>
              <Reveal reveal={lastReveal} players={game.players} uid={uid} nameFor={nameFor} />
            </div>
          ) : (
            <div>
              <p className="text-center mb-4 text-blue-200/80">
                Waiting for {nameFor(game.pickerUid ?? "")}{" "}to pick…
                {lastReveal && (
                  <button onClick={() => setViewBoard(false)} className="ml-2 text-gold/70 hover:text-gold underline">
                    back to results
                  </button>
                )}
              </p>
              <LiveBoard game={game} round={round} canPick={false} onPick={() => {}} />
            </div>
          ))}

        {/* Active clue */}
        {game.phase === "final_wager" && (
          <FinalWager
            game={game}
            board={board}
            now={now}
            uid={uid}
            nameFor={nameFor}
            onWager={(w) => run(() => liveFinalWager(user!, game.id, w))}
          />
        )}

        {game.phase === "active" && (
          <ActiveClue
            game={game}
            round={round}
            finalClue={board?.final ?? null}
            subPhase={subPhase}
            now={now}
            uid={uid}
            input={input}
            setInput={setInput}
            submittedClue={submittedClue}
            onSubmit={async () => {
              if (!user || !game.currentClueId || !input.trim()) return;
              const clue = game.currentClueId;
              setSubmittedClue(clue);
              await run(() => liveSubmit(user, game.id, clue, input.trim()));
            }}
            nameFor={nameFor}
          />
        )}

        {/* Reveal */}
        {game.phase === "reveal" && game.reveal && (
          <Reveal
            reveal={game.reveal}
            players={game.players}
            uid={uid}
            nameFor={nameFor}
            onContinue={() => run(() => liveContinue(user!, game.id))}
          />
        )}

        {/* Finished */}
        {game.phase === "finished" && <Finished game={game} uid={uid} nameFor={nameFor} />}
      </main>

      {/* Pause overlay — any player can resume */}
      {game.paused && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="text-center max-w-sm">
            <p className="font-display text-6xl tracking-widest text-gold mb-3">PAUSED</p>
            <p className="text-blue-200/70 mb-6">
              {game.pausedReason === "disconnect"
                ? `${game.pausedBy ? nameFor(game.pausedBy) : "A player"} disconnected. Waiting for them to reconnect — or resume without them.`
                : game.pausedBy
                  ? `Paused by ${nameFor(game.pausedBy)}`
                  : "Game paused"}
            </p>
            <button
              onClick={() => run(() => livePause(user!, game.id, false))}
              className="font-display text-2xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-8 py-3 rounded"
            >
              ▶ Resume
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="alert"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[calc(100%-2rem)] bg-board-deep border border-red-400/40 text-blue-50 rounded-lg shadow-2xl px-4 py-3 text-sm"
        >
          {toast}
        </div>
      )}

      {isMember && user && (
        <GameChat chat={game.chat} uid={uid} onSend={(text) => liveChat(user, game.id, text)} />
      )}
    </div>
  );
}

/* ---------- sub-components ---------- */

// Collapsible in-game group chat, pinned bottom-right (clear of the friends
// rail on desktop). Reads the live `chat` array off the game doc; sending goes
// through the API. Unseen-message dot while collapsed.
function GameChat({
  chat,
  uid,
  onSend,
}: {
  chat: LiveChatMessage[];
  uid: string | null;
  onSend: (text: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [seen, setSeen] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest message while open.
  useEffect(() => {
    if (open && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [chat.length, open]);

  // Track how many messages have been seen so a collapsed panel can show a dot.
  useEffect(() => {
    if (open) setSeen(chat.length);
  }, [open, chat.length]);
  const unseen = !open && chat.length > seen;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText("");
    await onSend(t).catch(() => {});
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 lg:right-[19rem] z-40 flex items-center gap-2 rounded-full bg-shell-raised border border-[color:var(--hairline-strong)] text-gold px-4 py-2 font-display tracking-wide shadow-xl hover:bg-board-deep"
      >
        <span aria-hidden>💬</span> Chat
        {unseen && <span className="h-2 w-2 rounded-full bg-online" />}
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 lg:right-[19rem] z-40 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-[color:var(--hairline)] bg-shell shadow-2xl flex flex-col">
      <div className="flex items-center justify-between px-3 h-10 border-b border-[color:var(--hairline)]">
        <span className="font-display tracking-[0.2em] text-gold text-sm">GAME CHAT</span>
        <button onClick={() => setOpen(false)} className="text-blue-200/50 hover:text-blue-100 text-lg leading-none">
          ✕
        </button>
      </div>
      <div ref={logRef} className="h-64 overflow-y-auto px-3 py-2 flex flex-col gap-1.5">
        {chat.length === 0 && (
          <p className="text-xs text-blue-200/40 m-auto">No messages yet — say hi 👋</p>
        )}
        {chat.map((m) => {
          const mine = m.uid === uid;
          return (
            <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
              {!mine && <span className="text-[10px] text-blue-200/40 px-1">{m.name}</span>}
              <span
                className={`inline-block max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm break-words ${
                  mine ? "bg-gold/90 text-board-deep" : "bg-shell-panel text-blue-100"
                }`}
              >
                {m.text}
              </span>
            </div>
          );
        })}
      </div>
      <form onSubmit={send} className="flex gap-1.5 p-2 border-t border-[color:var(--hairline)]">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          placeholder="Message…"
          className="flex-1 min-w-0 rounded-sm bg-shell-panel border border-[color:var(--hairline)] focus:border-gold outline-none px-2.5 py-1.5 text-sm placeholder:text-blue-200/35"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="px-3 rounded-sm bg-gold hover:bg-gold-soft text-board-deep font-display tracking-wide text-sm disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}

// Invite online friends who aren't already in the game, straight from the lobby.
function InviteFriends({ gameCode, playerUids }: { gameCode: string; playerUids: string[] }) {
  const { user } = useAuth();
  const { data } = useFriends();
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const candidates = (data?.friends ?? []).filter((f) => !playerUids.includes(f.uid));
  if (!user || candidates.length === 0) return null;

  return (
    <div className="mt-6 pt-5 border-t border-board text-left">
      <p className="text-xs uppercase tracking-wider text-blue-200/40 mb-2">Invite friends</p>
      <ul className="space-y-1.5">
        {candidates.map((f) => (
          <li key={f.uid} className="flex items-center gap-2.5">
            <span className={`h-2 w-2 rounded-full ${f.online ? "bg-green-400" : "bg-blue-200/25"}`} />
            <span className="flex-1 text-sm text-blue-100 truncate">{f.name}</span>
            <button
              disabled={invited.has(f.uid)}
              onClick={() =>
                inviteFriend(user, f.uid, gameCode)
                  .then(() => setInvited((s) => new Set(s).add(f.uid)))
                  .catch(() => {})
              }
              className="text-xs font-display tracking-wide border border-gold/40 text-gold hover:bg-board px-3 py-1 rounded disabled:opacity-40"
            >
              {invited.has(f.uid) ? "Invited ✓" : "Invite"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col flex-1 min-h-screen items-center justify-center text-center px-4">
      <div>{children}</div>
    </div>
  );
}

function Scoreboard({
  game,
  uid,
  nameFor,
}: {
  game: { players: { uid: string; name: string }[]; scores: Record<string, number>; pickerUid: string | null };
  uid: string | null;
  nameFor: (id: string) => string;
}) {
  const ranked = [...game.players].sort((a, b) => (game.scores[b.uid] ?? 0) - (game.scores[a.uid] ?? 0));
  return (
    <div className="bg-board-deep/50 border border-board rounded-lg px-3 py-2 min-w-[10rem]">
      {ranked.map((p) => {
        const score = game.scores[p.uid] ?? 0;
        return (
          <div key={p.uid} className="flex items-center justify-between gap-3 text-sm py-0.5">
            <span className={`truncate ${p.uid === uid ? "text-gold" : "text-blue-100"}`}>
              {nameFor(p.uid)}
              {p.uid === game.pickerUid && <span className="text-blue-200/40 text-xs ml-1">•pick</span>}
            </span>
            <span className={`font-display tracking-wide ${score < 0 ? "text-red-400" : "text-gold"}`}>
              {formatMoney(score)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LiveBoard({
  game,
  round,
  canPick,
  onPick,
}: {
  game: { answeredClueIds: string[] };
  round: PublicBoard["rounds"][number] | undefined;
  canPick: boolean;
  onPick: (clueId: string) => void;
}) {
  if (!round) return <p className="text-center text-blue-200/50 py-10">Loading board…</p>;
  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid grid-cols-6 gap-1.5 min-w-[680px]">
        {round.categories.map((cat) => (
          <div
            key={cat.title}
            className="bg-board-deep rounded-sm flex items-center justify-center p-2 min-h-[64px] text-center"
          >
            <span className="font-display tracking-wide text-sm leading-tight uppercase">{cat.title}</span>
          </div>
        ))}
        {Array.from({ length: 5 }).map((_, row) =>
          round.categories.map((cat) => {
            const clue = cat.clues[row];
            if (!clue) return <div key={`${cat.title}-${row}`} />;
            const answered = game.answeredClueIds.includes(clue.id);
            return (
              <button
                key={clue.id}
                disabled={answered || !canPick}
                onClick={() => onPick(clue.id)}
                className={`rounded-sm min-h-[64px] flex items-center justify-center transition-colors ${
                  answered
                    ? "bg-board/20 cursor-default"
                    : canPick
                      ? "bg-board hover:bg-board-deep cursor-pointer"
                      : "bg-board/60 cursor-default"
                }`}
              >
                {!answered && (
                  <span className="font-display text-2xl text-gold tracking-wide">${clue.value}</span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function findClueText(round: PublicBoard["rounds"][number] | undefined, clueId: string | null) {
  if (!round || !clueId) return null;
  for (const cat of round.categories) {
    const clue = cat.clues.find((c) => c.id === clueId);
    if (clue) return { category: cat.title, clue: clue.clue, value: clue.value };
  }
  return null;
}

function ActiveClue({
  game,
  round,
  finalClue,
  subPhase,
  now,
  uid,
  input,
  setInput,
  submittedClue,
  onSubmit,
  nameFor,
}: {
  game: {
    id: string;
    currentClueId: string | null;
    countdownEndsAt: number | null;
    answerEndsAt: number | null;
    answerMs: number;
    currentSubmittedUids: string[];
    players: { uid: string; name: string }[];
  };
  round: PublicBoard["rounds"][number] | undefined;
  finalClue: { category: string; clue: string } | null;
  subPhase: SubPhase | null;
  now: number;
  uid: string | null;
  input: string;
  setInput: (v: string) => void;
  submittedClue: string | null;
  onSubmit: () => void;
  nameFor: (id: string) => string;
}) {
  const isFinal = game.currentClueId === "final";
  const info = isFinal
    ? finalClue
      ? { category: finalClue.category, clue: finalClue.clue, value: 0 }
      : null
    : findClueText(round, game.currentClueId);
  const iSubmitted = submittedClue === game.currentClueId || (uid !== null && game.currentSubmittedUids.includes(uid));

  if (subPhase === "countdown" && game.countdownEndsAt !== null) {
    const secs = Math.max(1, Math.ceil((game.countdownEndsAt - now) / 1000));
    return (
      <div className="text-center py-20">
        <p className="kicker text-gold font-mono text-xs uppercase tracking-widest mb-4">{info?.category}</p>
        <p className="font-display text-8xl text-gold animate-pulse">{secs}</p>
        <p className="text-blue-200/60 mt-4">Get ready…</p>
      </div>
    );
  }

  const windowSecs = isFinal ? 30 : (game.answerMs ?? 10000) / 1000;
  const remaining =
    game.answerEndsAt !== null ? Math.max(0, (game.answerEndsAt - now) / 1000) : 0;
  const pct =
    game.answerEndsAt !== null ? Math.max(0, Math.min(100, (remaining / windowSecs) * 100)) : 0;

  return (
    <div className="max-w-2xl mx-auto bg-board rounded-lg shadow-2xl p-6 md:p-8">
      <div className="flex items-center justify-between mb-1">
        <p className="font-display tracking-wider text-gold uppercase text-sm">
          {isFinal ? `Final Jeopardy! · ${info?.category}` : `${info?.category} · $${info?.value}`}
        </p>
        {subPhase === "answering" && (
          <p className="font-display text-2xl text-gold tabular-nums">{Math.ceil(remaining)}</p>
        )}
      </div>
      <div className="h-1 w-full bg-board-deep rounded-full overflow-hidden mb-5">
        <div
          className={`h-full rounded-full ${remaining < 3 ? "bg-red-400" : "bg-gold"}`}
          style={{ width: `${pct}%`, transition: "width 200ms linear" }}
        />
      </div>

      <p className="text-xl md:text-2xl leading-snug mb-6">{info?.clue}</p>

      {subPhase === "answering" && !iSubmitted && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="flex gap-3"
        >
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={200}
            placeholder="What is…?"
            className="flex-1 rounded bg-board-deep border border-blue-300/30 focus:border-gold outline-none px-4 py-3 text-lg placeholder:text-blue-200/40"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="font-display text-xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-6 rounded disabled:opacity-50"
          >
            Lock in
          </button>
        </form>
      )}

      {subPhase === "answering" && iSubmitted && (
        <p className="text-center text-green-400/90 py-3">Answer locked in — waiting for the buzzer…</p>
      )}

      {subPhase === "timeup" && (
        <p className="text-center text-gold py-3 animate-pulse">Time! Judging answers…</p>
      )}

      {/* Who's answered */}
      <div className="flex gap-2 justify-center mt-5 flex-wrap">
        {game.players.map((p) => (
          <span
            key={p.uid}
            className={`text-xs px-2 py-1 rounded-full border ${
              game.currentSubmittedUids.includes(p.uid)
                ? "border-green-400/40 text-green-300"
                : "border-blue-300/20 text-blue-200/40"
            }`}
          >
            {nameFor(p.uid)} {game.currentSubmittedUids.includes(p.uid) ? "✓" : "…"}
          </span>
        ))}
      </div>
    </div>
  );
}

function Reveal({
  reveal: r,
  players,
  uid,
  nameFor,
  onContinue,
}: {
  reveal: NonNullable<import("@/lib/liveTypes").LiveGame["reveal"]>;
  players: { uid: string; name: string }[];
  uid: string | null;
  nameFor: (id: string) => string;
  onContinue?: () => void;
}) {
  return (
    <div className="max-w-2xl mx-auto bg-board rounded-lg shadow-2xl p-6 md:p-8 text-center">
      <p className="font-display tracking-wider text-gold uppercase text-sm mb-1">
        {r.clueId === "final" ? `Final Jeopardy! · ${r.categoryTitle}` : `${r.categoryTitle} · $${r.value}`}
      </p>
      <p className="text-lg mb-1">
        <span className="text-blue-200/60">Answer: </span>
        <span className="text-gold">{r.correctAnswer}</span>
      </p>
      {r.comment && <p className="text-blue-200/70 italic mb-5">{r.comment}</p>}

      <div className="space-y-2 my-6 text-left max-w-sm mx-auto">
        {players.map((p) => {
          const res = r.results[p.uid];
          const outcome = res?.outcome ?? "none";
          return (
            <div key={p.uid} className="flex items-center justify-between gap-3 border-b border-board-deep pb-1.5">
              <span className={p.uid === uid ? "text-gold" : "text-blue-100"}>{nameFor(p.uid)}</span>
              <span className="flex items-center gap-2">
                <span className="text-blue-200/50 text-sm truncate max-w-[10rem]">{res?.answer ?? "—"}</span>
                <span
                  className={
                    outcome === "correct"
                      ? "text-green-400"
                      : outcome === "wrong"
                        ? "text-red-400"
                        : "text-blue-200/30"
                  }
                >
                  {res?.wager !== undefined
                    ? `${res.wager >= 0 ? "+" : "−"}$${Math.abs(res.wager).toLocaleString()}`
                    : outcome === "correct"
                      ? `+$${r.value}`
                      : outcome === "wrong"
                        ? "✗"
                        : "–"}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      {onContinue && (
        <button
          onClick={onContinue}
          className="font-display text-xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-8 py-2 rounded"
        >
          Continue →
        </button>
      )}
    </div>
  );
}

// Final Jeopardy wager entry — everyone secretly wagers 0..their current score.
function FinalWager({
  game,
  board,
  now,
  uid,
  nameFor,
  onWager,
}: {
  game: {
    scores: Record<string, number>;
    players: { uid: string; name: string }[];
    playerUids: string[];
    finalWagers: Record<string, number>;
    finalWagerEndsAt: number | null;
  };
  board: PublicBoard | null;
  now: number;
  uid: string | null;
  nameFor: (id: string) => string;
  onWager: (wager: number) => void;
}) {
  const [wagerInput, setWagerInput] = useState("");
  const myScore = uid ? game.scores[uid] ?? 0 : 0;
  const maxWager = Math.max(0, myScore);
  const iWagered = uid !== null && uid in game.finalWagers;
  const secsLeft =
    game.finalWagerEndsAt !== null ? Math.max(0, Math.ceil((game.finalWagerEndsAt - now) / 1000)) : null;

  return (
    <div className="max-w-lg mx-auto bg-board rounded-lg shadow-2xl p-6 md:p-8 text-center">
      <p className="font-display text-4xl tracking-widest text-gold mb-1 animate-pulse">FINAL JEOPARDY!</p>
      <p className="text-blue-200/70 mb-1">
        Category: <span className="text-foreground">{board?.final?.category ?? "…"}</span>
      </p>
      {secsLeft !== null && <p className="text-xs text-blue-200/40 mb-5">Wager within {secsLeft}s</p>}

      {!iWagered ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const w = Math.min(maxWager, Math.max(0, Math.round(Number(wagerInput) || 0)));
            onWager(w);
          }}
        >
          <label className="block text-sm text-blue-200/70 mb-2">
            Your wager — $0 to ${maxWager.toLocaleString()} (your score)
          </label>
          <input
            autoFocus
            type="number"
            min={0}
            max={maxWager}
            step={1}
            value={wagerInput}
            onChange={(e) => setWagerInput(e.target.value)}
            placeholder="0"
            className="w-full text-center rounded bg-board-deep border border-blue-300/30 focus:border-gold outline-none px-4 py-3 text-2xl font-display tracking-wide placeholder:text-blue-200/30 mb-4"
          />
          <button
            type="submit"
            className="font-display text-xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-6 py-2 rounded"
          >
            Lock in wager
          </button>
        </form>
      ) : (
        <p className="text-green-400/90 py-3">Wager locked in — waiting for the others…</p>
      )}

      <div className="flex gap-2 justify-center mt-5 flex-wrap">
        {game.players.map((p) => (
          <span
            key={p.uid}
            className={`text-xs px-2 py-1 rounded-full border ${
              p.uid in game.finalWagers ? "border-green-400/40 text-green-300" : "border-blue-300/20 text-blue-200/40"
            }`}
          >
            {nameFor(p.uid)} {p.uid in game.finalWagers ? "✓" : "…"}
          </span>
        ))}
      </div>
    </div>
  );
}

function Finished({
  game,
  uid,
  nameFor,
}: {
  game: { players: { uid: string; name: string }[]; scores: Record<string, number> };
  uid: string | null;
  nameFor: (id: string) => string;
}) {
  const ranked = [...game.players].sort((a, b) => (game.scores[b.uid] ?? 0) - (game.scores[a.uid] ?? 0));
  const winner = ranked[0];
  const iWon = winner?.uid === uid;
  return (
    <div className="max-w-md mx-auto bg-board-deep/60 border border-board rounded-lg p-8 text-center">
      <p className="kicker text-gold font-mono text-xs uppercase tracking-widest mb-2">Final</p>
      <p className="font-display text-4xl tracking-wide text-gold mb-1">
        {iWon ? "You win!" : `${nameFor(winner?.uid ?? "")} wins!`}
      </p>
      <div className="space-y-2 my-6">
        {ranked.map((p, i) => (
          <div key={p.uid} className="flex items-center justify-between gap-3 max-w-xs mx-auto">
            <span className="text-blue-200/50 w-6 text-right">{i + 1}.</span>
            <span className={`flex-1 text-left ${p.uid === uid ? "text-gold" : "text-blue-100"}`}>
              {nameFor(p.uid)}
            </span>
            <span className={`font-display text-xl tracking-wide ${(game.scores[p.uid] ?? 0) < 0 ? "text-red-400" : "text-gold"}`}>
              {formatMoney(game.scores[p.uid] ?? 0)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-3 justify-center">
        <Link
          href="/live"
          className="font-display text-lg tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-6 py-2 rounded"
        >
          Play again
        </Link>
        <Link href="/" className="font-display text-lg tracking-wider border border-gold/40 text-gold px-6 py-2 rounded">
          Solo board
        </Link>
      </div>
    </div>
  );
}
