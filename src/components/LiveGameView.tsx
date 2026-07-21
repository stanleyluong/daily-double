"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublicBoard } from "@/lib/jeopardy";
import { useAuth } from "@/components/AuthProvider";
import { useLiveGame } from "@/lib/useLiveGame";
import {
  liveContinue,
  livePick,
  liveResolve,
  liveStart,
  liveSubmit,
} from "@/lib/liveActions";
import { formatMoney } from "@/lib/format";

// Derived sub-phase of an "active" clue, computed from the absolute deadlines
// on the game doc against the local clock (good enough for a casual game; a
// server-time offset estimate is the future hardening).
type SubPhase = "countdown" | "answering" | "timeup";

export default function LiveGameView({ gameId }: { gameId: string }) {
  const { user } = useAuth();
  const { game, error, loading } = useLiveGame(gameId);
  const [board, setBoard] = useState<PublicBoard | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [input, setInput] = useState("");
  const [submittedClue, setSubmittedClue] = useState<string | null>(null);
  const [seenClueId, setSeenClueId] = useState<string | null | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const resolvedFiredFor = useRef<string | null>(null);

  // Reset the answer box when a new clue opens — render-time reset rather
  // than an effect (avoids a cascading render for a render-time decision).
  if (game?.currentClueId !== seenClueId) {
    setSeenClueId(game?.currentClueId ?? null);
    setInput("");
    setSubmittedClue(null);
  }

  const uid = user?.uid ?? null;

  // Tick a local clock while a clue is live, to drive the countdown/timer.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  // Fetch the (answer-free) public board for this game's date, once known.
  useEffect(() => {
    if (!game?.boardDate) return;
    let cancelled = false;
    fetch(`/api/board?date=${game.boardDate}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d && !d.error) setBoard(d as PublicBoard);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [game?.boardDate]);

  const showToast = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Something went wrong.");
      }
    },
    [showToast]
  );

  const subPhase: SubPhase | null = useMemo(() => {
    if (!game || game.phase !== "active" || game.countdownEndsAt === null || game.answerEndsAt === null) {
      return null;
    }
    if (now < game.countdownEndsAt) return "countdown";
    if (now < game.answerEndsAt) return "answering";
    return "timeup";
  }, [game, now]);

  // Any client fires resolve once, when the answer window closes.
  useEffect(() => {
    if (!game || !user) return;
    if (game.phase === "active" && subPhase === "timeup" && resolvedFiredFor.current !== game.currentClueId) {
      resolvedFiredFor.current = game.currentClueId;
      run(() => liveResolve(user, game.id));
    }
    if (game.phase !== "active") resolvedFiredFor.current = null;
  }, [game, subPhase, user, run]);

  if (loading) {
    return <Centered>Loading game…</Centered>;
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
            <Link href="/live" className="text-xs text-blue-200/50 hover:text-gold">
              ← Leave
            </Link>
            <h1 className="font-display text-2xl tracking-wider text-gold mt-1">
              Game <span className="tracking-[0.2em]">{game.id}</span>
            </h1>
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
          </div>
        )}

        {/* Picking */}
        {game.phase === "picking" && (
          <div>
            <p className="text-center mb-4 text-blue-200/80">
              {isPicker ? (
                <span className="text-gold font-display text-xl tracking-wide">Your pick — choose a clue</span>
              ) : (
                <>Waiting for {nameFor(game.pickerUid ?? "")} to pick…</>
              )}
            </p>
            <LiveBoard game={game} round={round} canPick={isPicker} onPick={(id) => run(() => livePick(user!, game.id, id))} />
          </div>
        )}

        {/* Active clue */}
        {game.phase === "active" && (
          <ActiveClue
            game={game}
            round={round}
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

      {toast && (
        <div
          role="alert"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[calc(100%-2rem)] bg-board-deep border border-red-400/40 text-blue-50 rounded-lg shadow-2xl px-4 py-3 text-sm"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

/* ---------- sub-components ---------- */

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
    currentSubmittedUids: string[];
    players: { uid: string; name: string }[];
  };
  round: PublicBoard["rounds"][number] | undefined;
  subPhase: SubPhase | null;
  now: number;
  uid: string | null;
  input: string;
  setInput: (v: string) => void;
  submittedClue: string | null;
  onSubmit: () => void;
  nameFor: (id: string) => string;
}) {
  const info = findClueText(round, game.currentClueId);
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

  const remaining =
    game.answerEndsAt !== null ? Math.max(0, (game.answerEndsAt - now) / 1000) : 0;
  const pct =
    game.answerEndsAt !== null ? Math.max(0, Math.min(100, (remaining / 10) * 100)) : 0;

  return (
    <div className="max-w-2xl mx-auto bg-board rounded-lg shadow-2xl p-6 md:p-8">
      <div className="flex items-center justify-between mb-1">
        <p className="font-display tracking-wider text-gold uppercase text-sm">
          {info?.category} · ${info?.value}
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
  onContinue: () => void;
}) {
  return (
    <div className="max-w-2xl mx-auto bg-board rounded-lg shadow-2xl p-6 md:p-8 text-center">
      <p className="font-display tracking-wider text-gold uppercase text-sm mb-1">
        {r.categoryTitle} · ${r.value}
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
                  {outcome === "correct" ? `+$${r.value}` : outcome === "wrong" ? "✗" : "–"}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      <button
        onClick={onContinue}
        className="font-display text-xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-8 py-2 rounded"
      >
        Continue →
      </button>
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
