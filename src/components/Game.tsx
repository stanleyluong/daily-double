"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublicBoard, PublicClue } from "@/lib/jeopardy";
import type { PercentileStats, ScoreRow } from "@/lib/scores";
import { formatBoardDate, formatDuration, formatMoney } from "@/lib/format";
import PercentileMeter from "@/components/PercentileMeter";
import { useAuth } from "@/components/AuthProvider";
import AuthModal from "@/components/AuthModal";

type Outcome = "correct" | "wrong" | "passed";

interface ClueResult {
  outcome: Outcome;
  correctAnswer: string;
  comment: string;
  playerAnswer?: string;
  pointValue: number; // face value, or the wager for a Daily Double
}

interface SavedGame {
  date: string;
  boardId: string;
  results: Record<string, ClueResult>;
  score: number;
  roundIndex: number;
  startedAt: number | null;
  durationMs: number | null;
  submitted: boolean;
}

interface ActiveClue extends PublicClue {
  categoryTitle: string;
  wager?: number;
}

const NAME_KEY = "daily-double-name";

const LOADING_MESSAGES = [
  "Summoning today's categories…",
  "Claude is writing 60 clues across two rounds…",
  "Hiding the Daily Doubles…",
  "Fact-checking the $2000 row…",
  "Polishing the wordplay…",
  "Lowering the podiums…",
  "Cueing the think music…",
];

function storageKey(date: string): string {
  return `daily-double-v3:${date}`;
}

function loadSaved(date: string): SavedGame | null {
  try {
    const raw = localStorage.getItem(storageKey(date));
    return raw ? (JSON.parse(raw) as SavedGame) : null;
  } catch {
    return null;
  }
}

function roundClueIds(board: PublicBoard, roundIndex: number): string[] {
  const round = board.rounds[roundIndex];
  if (!round) return [];
  return round.categories.flatMap((c) => c.clues.map((cl) => cl.id));
}

export default function Game({ date }: { date?: string }) {
  const { user } = useAuth();
  const [board, setBoard] = useState<PublicBoard | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [results, setResults] = useState<Record<string, ClueResult>>({});
  const [score, setScore] = useState(0);
  const [roundIndex, setRoundIndex] = useState(0);
  const [active, setActive] = useState<ActiveClue | null>(null);
  const [phase, setPhase] = useState<"wager" | "answering" | "judging" | "result">("answering");
  const [wagerInput, setWagerInput] = useState("");
  const [input, setInput] = useState("");
  const [verdict, setVerdict] = useState<ClueResult | null>(null);
  const [loadingMsg, setLoadingMsg] = useState(0);
  const [copied, setCopied] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [skippedSubmit, setSkippedSubmit] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [leaderboard, setLeaderboard] = useState<ScoreRow[] | null>(null);
  const [stats, setStats] = useState<PercentileStats | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMessage, setAuthModalMessage] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const wagerRef = useRef<HTMLInputElement>(null);
  // Timer + submission flags live in a ref so persist() never sees stale state.
  const metaRef = useRef<{ startedAt: number | null; durationMs: number | null; submitted: boolean }>({
    startedAt: null,
    durationMs: null,
    submitted: false,
  });

  const totalClues = useMemo(
    () => board?.rounds.reduce((n, r) => n + r.categories.reduce((m, c) => m + c.clues.length, 0), 0) ?? 0,
    [board]
  );
  const answeredCount = Object.keys(results).length;
  const finished = board !== null && totalClues > 0 && answeredCount === totalClues;
  const currentRoundIds = useMemo(() => (board ? roundClueIds(board, roundIndex) : []), [board, roundIndex]);
  const roundComplete =
    currentRoundIds.length > 0 && currentRoundIds.every((id) => id in results) && !finished;
  const counts = useMemo(() => {
    const c = { correct: 0, wrong: 0, passed: 0 };
    for (const r of Object.values(results)) c[r.outcome]++;
    return c;
  }, [results]);

  const fetchBoard = useCallback(async () => {
    setBoard(null);
    setLoadError(null);
    setNotFound(false);
    try {
      const res = await fetch(date ? `/api/board?date=${date}` : "/api/board");
      const data = await res.json();
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Failed to load the board.");
      const fresh = data as PublicBoard;
      const saved = loadSaved(fresh.date);
      if (saved && saved.boardId === fresh.boardId) {
        setResults(saved.results);
        setScore(saved.score);
        setRoundIndex(saved.roundIndex ?? 0);
        setSubmitted(saved.submitted ?? false);
        metaRef.current = {
          startedAt: saved.startedAt ?? null,
          durationMs: saved.durationMs ?? null,
          submitted: saved.submitted ?? false,
        };
      } else {
        localStorage.removeItem(storageKey(fresh.date));
        setResults({});
        setScore(0);
        setRoundIndex(0);
        setSubmitted(false);
        metaRef.current = { startedAt: null, durationMs: null, submitted: false };
      }
      setPlayerName(user?.displayName ?? localStorage.getItem(NAME_KEY) ?? "");
      setBoard(fresh);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load the board.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useEffect(() => {
    fetchBoard();
  }, [fetchBoard]);

  // Auth resolves asynchronously and can finish after the board already
  // loaded (e.g. the player signs in mid-game via the finished-banner
  // prompt) — backfill the name field then, without clobbering anything
  // they've already typed.
  useEffect(() => {
    if (user?.displayName && !playerName) setPlayerName(user.displayName);
  }, [user, playerName]);

  // Rotate the loading copy while the first board of the day generates.
  useEffect(() => {
    if (board || loadError || notFound) return;
    const t = setInterval(() => setLoadingMsg((i) => (i + 1) % LOADING_MESSAGES.length), 2600);
    return () => clearInterval(t);
  }, [board, loadError, notFound]);

  useEffect(() => {
    if (active && phase === "answering") inputRef.current?.focus();
    if (active && phase === "wager") wagerRef.current?.focus();
  }, [active, phase]);

  const persist = useCallback(
    (nextResults: Record<string, ClueResult>, nextScore: number, nextRoundIndex: number) => {
      if (!board) return;
      const saved: SavedGame = {
        date: board.date,
        boardId: board.boardId,
        results: nextResults,
        score: nextScore,
        roundIndex: nextRoundIndex,
        startedAt: metaRef.current.startedAt,
        durationMs: metaRef.current.durationMs,
        submitted: metaRef.current.submitted,
      };
      localStorage.setItem(storageKey(board.date), JSON.stringify(saved));
    },
    [board]
  );

  const recordResult = useCallback(
    (clue: ActiveClue, result: ClueResult) => {
      setResults((prev) => {
        const next = { ...prev, [clue.id]: result };
        if (Object.keys(next).length === totalClues && metaRef.current.durationMs === null) {
          metaRef.current.durationMs = metaRef.current.startedAt
            ? Date.now() - metaRef.current.startedAt
            : 0;
        }
        setScore((prevScore) => {
          const delta =
            result.outcome === "correct"
              ? result.pointValue
              : result.outcome === "wrong"
                ? -result.pointValue
                : 0;
          const nextScore = prevScore + delta;
          persist(next, nextScore, roundIndex);
          return nextScore;
        });
        return next;
      });
      setVerdict(result);
      setPhase("result");
    },
    [persist, totalClues, roundIndex]
  );

  const handleBoardChanged = useCallback(() => {
    if (board) localStorage.removeItem(storageKey(board.date));
    setActive(null);
    setVerdict(null);
    alert("This board was refreshed on the server — reloading it now.");
    fetchBoard();
  }, [board, fetchBoard]);

  const submitAnswer = useCallback(
    async (reveal: boolean) => {
      if (!board || !active || !user) return;
      const answer = input.trim();
      if (!reveal && !answer) return;
      setPhase("judging");
      try {
        const res = await fetch("/api/judge", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${await user.getIdToken()}`,
          },
          body: JSON.stringify(
            reveal
              ? { date: board.date, boardId: board.boardId, clueId: active.id, reveal: true }
              : {
                  date: board.date,
                  boardId: board.boardId,
                  clueId: active.id,
                  answer,
                  wager: active.dailyDouble ? active.wager : undefined,
                }
          ),
        });
        const data = await res.json();
        if (data.error === "board-changed") return handleBoardChanged();
        if (!res.ok) throw new Error(data.error ?? "Judging failed.");
        // outcome and pointValue come from the server now, not client
        // computation — for a Daily Double the server may have clamped the
        // wager, and for an already-recorded clue this is the cached verdict.
        recordResult(active, {
          outcome: data.outcome,
          correctAnswer: data.correctAnswer,
          comment: data.comment,
          playerAnswer: reveal ? undefined : answer,
          pointValue: data.pointValue,
        });
      } catch (error) {
        setPhase("answering");
        alert(error instanceof Error ? error.message : "Judging failed — try again.");
      }
    },
    [board, active, user, input, recordResult, handleBoardChanged]
  );

  const openClue = (clue: PublicClue, categoryTitle: string) => {
    if (results[clue.id]) return;
    if (!user) {
      setAuthModalMessage("Sign in to open clues and play today's board.");
      setShowAuthModal(true);
      return;
    }
    if (metaRef.current.startedAt === null) metaRef.current.startedAt = Date.now();
    setActive({ ...clue, categoryTitle });
    setInput("");
    setWagerInput("");
    setVerdict(null);
    setPhase(clue.dailyDouble ? "wager" : "answering");
  };

  const roundMaxValue = (roundIndex + 1) * 1000; // 1000 for round 1, 2000 for round 2
  const maxWager = Math.max(score, roundMaxValue);

  const submitWager = (e: React.FormEvent) => {
    e.preventDefault();
    if (!active) return;
    const raw = Math.round(Number(wagerInput) / 100) * 100;
    const wager = Math.min(maxWager, Math.max(5, Number.isFinite(raw) && raw > 0 ? raw : 5));
    setActive({ ...active, wager });
    setPhase("answering");
  };

  const closeClue = useCallback(() => {
    setActive(null);
    setVerdict(null);
  }, []);

  // After a ruling, Enter (or Escape) returns to the board without reaching
  // for the mouse.
  useEffect(() => {
    if (phase !== "result") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        closeClue();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, closeClue]);

  const advanceRound = () => {
    if (!board) return;
    const next = roundIndex + 1;
    setRoundIndex(next);
    persist(results, score, next);
  };

  // Load the leaderboard once the game is over (and after submitting).
  useEffect(() => {
    if (!finished || !board || leaderboard) return;
    fetch(`/api/scores?date=${board.date}`)
      .then((res) => res.json())
      .then((data) => setLeaderboard((data.scores as ScoreRow[]) ?? []))
      .catch(() => setLeaderboard([]));
  }, [finished, board, leaderboard]);

  const submitScore = async () => {
    // Sign-in is required server-side too — this guard just avoids a doomed
    // request. The form itself is only rendered when `user` is set (below).
    if (!board || submitting || !user) return;
    const name = playerName.replace(/\s+/g, " ").trim().slice(0, 24);
    if (!name) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/scores", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await user.getIdToken()}`,
        },
        // score/correct/wrong/passed are deliberately NOT sent — the server
        // computes them from this account's recorded answeredClues, so a
        // player can't just assert a number here.
        body: JSON.stringify({
          date: board.date,
          boardId: board.boardId,
          name,
          durationMs: metaRef.current.durationMs ?? 0,
        }),
      });
      const data = await res.json();
      if (data.error === "board-changed") return handleBoardChanged();
      if (data.error === "already-submitted") {
        // Not a failure from the player's perspective — a score for this
        // account+date already exists (most likely this same submission,
        // e.g. a retry), so just stop showing the form.
        localStorage.setItem(NAME_KEY, name);
        metaRef.current.submitted = true;
        setSubmitted(true);
        persist(results, score, roundIndex);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Couldn't save your score.");
      localStorage.setItem(NAME_KEY, name);
      metaRef.current.submitted = true;
      setSubmitted(true);
      setLeaderboard((data.scores as ScoreRow[]) ?? null);
      setStats((data.stats as PercentileStats) ?? null);
      // Reconcile the displayed score/counts with the server's authoritative
      // final numbers — normally identical to the local tally, but this is
      // the value that's actually on the leaderboard.
      if (data.final) {
        setScore(data.final.score);
        persist(results, data.final.score, roundIndex);
      }
      persist(results, score, roundIndex);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Couldn't save your score.");
    } finally {
      setSubmitting(false);
    }
  };

  const shareResult = async () => {
    if (!board) return;
    const rows: string[] = [];
    for (const round of board.rounds) {
      for (let r = 0; r < 5; r++) {
        rows.push(
          round.categories
            .map((cat) => {
              const result = results[cat.clues[r]?.id ?? ""];
              if (!result) return "⬛";
              return result.outcome === "correct" ? "🟩" : result.outcome === "wrong" ? "🟥" : "⬜";
            })
            .join("")
        );
      }
    }
    const text = `Daily Double ${board.date}\n${formatMoney(score)}\n${rows.join("\n")}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. non-HTTPS) — nothing to do.
    }
  };

  /* ---------- render ---------- */

  if (notFound) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="text-lg text-blue-200/80">No board was played on that date.</p>
        <a
          href="/boards"
          className="font-display text-xl tracking-wider bg-board hover:bg-board-deep text-gold px-6 py-2 rounded"
        >
          Browse past boards
        </a>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="text-lg text-red-300">{loadError}</p>
        <button
          onClick={fetchBoard}
          className="font-display text-xl tracking-wider bg-board hover:bg-board-deep text-gold px-6 py-2 rounded"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="flex flex-col items-center gap-6 py-24 text-center">
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-10 w-16 rounded-sm bg-board animate-pulse"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
        <p className="text-blue-200/80">{LOADING_MESSAGES[loadingMsg]}</p>
        <p className="text-xs text-blue-200/40 max-w-xs">
          The first visit of the day generates a brand-new board, which takes a little while.
        </p>
      </div>
    );
  }

  const round = board.rounds[roundIndex];

  return (
    <div className="w-full max-w-5xl mx-auto">
      {/* Scoreboard */}
      <div className="flex items-baseline justify-between mb-4 px-1">
        <div>
          <p className="text-sm text-blue-200/70">{formatBoardDate(board.date)}</p>
          <p className="font-display tracking-wide text-gold text-sm uppercase">{round.name}</p>
        </div>
        <p className="font-display text-3xl tracking-wide">
          <span className={score < 0 ? "text-red-400" : "text-gold"}>{formatMoney(score)}</span>
          <span className="text-blue-200/50 text-lg ml-3">
            {answeredCount}/{totalClues}
          </span>
        </p>
      </div>

      {roundComplete ? (
        /* Round-transition interstitial */
        <div className="mt-4 bg-board-deep/60 border border-board rounded-lg p-10 text-center">
          <p className="font-display text-3xl tracking-wide text-gold mb-2">
            {round.name} complete!
          </p>
          <p className="text-blue-200/70 mb-6">
            Score so far: <span className="text-gold">{formatMoney(score)}</span>
          </p>
          <button
            onClick={advanceRound}
            className="font-display text-xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-6 py-2 rounded"
          >
            Continue to {board.rounds[roundIndex + 1]?.name} — values double →
          </button>
        </div>
      ) : (
        /* Board */
        <div className="overflow-x-auto pb-2">
          <div className="grid grid-cols-6 gap-1.5 min-w-[680px]">
            {round.categories.map((cat) => (
              <div
                key={cat.title}
                className="bg-board-deep rounded-sm flex items-center justify-center p-2 min-h-[72px] text-center"
              >
                <span className="font-display tracking-wide text-sm md:text-base leading-tight uppercase">
                  {cat.title}
                </span>
              </div>
            ))}
            {Array.from({ length: 5 }).map((_, row) =>
              round.categories.map((cat) => {
                const clue = cat.clues[row];
                if (!clue) return <div key={`${cat.title}-${row}`} />;
                const result = results[clue.id];
                return (
                  <button
                    key={clue.id}
                    onClick={() => openClue(clue, cat.title)}
                    disabled={!!result}
                    className={`rounded-sm min-h-[64px] md:min-h-[76px] flex items-center justify-center transition-colors ${
                      result
                        ? "bg-board/30 cursor-default"
                        : "bg-board hover:bg-board-deep cursor-pointer"
                    }`}
                  >
                    {result ? (
                      <span
                        className={`text-xl ${
                          result.outcome === "correct"
                            ? "text-green-400"
                            : result.outcome === "wrong"
                              ? "text-red-400"
                              : "text-blue-200/40"
                        }`}
                      >
                        {result.outcome === "correct" ? "✓" : result.outcome === "wrong" ? "✗" : "–"}
                      </span>
                    ) : (
                      <span className="font-display text-2xl md:text-3xl text-gold tracking-wide">
                        ${clue.value}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Final banner: score, name submission, leaderboard */}
      {finished && (
        <div className="mt-8 bg-board-deep/60 border border-board rounded-lg p-6 md:p-8">
          <div className="text-center">
            <p className="font-display text-4xl tracking-wide text-gold mb-1">
              Final score: {formatMoney(score)}
            </p>
            <p className="text-blue-200/70 mb-5">
              {counts.correct} right · {counts.wrong} wrong · {counts.passed} passed
              {metaRef.current.durationMs ? ` · ${formatDuration(metaRef.current.durationMs)}` : ""}
            </p>
          </div>

          {!submitted && !skippedSubmit && (
            user ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitScore();
                }}
                className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-6"
              >
                <input
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  maxLength={24}
                  placeholder="Your name"
                  className="rounded bg-board border border-blue-300/30 focus:border-gold outline-none px-4 py-2 text-lg placeholder:text-blue-200/40 w-full sm:w-56"
                />
                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={submitting || !playerName.trim()}
                    className="font-display text-xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-6 py-2 rounded disabled:opacity-50"
                  >
                    {submitting ? "Saving…" : "Post my score"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSkippedSubmit(true)}
                    className="text-blue-200/60 hover:text-blue-100 px-2"
                  >
                    Skip
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-col items-center gap-3 mb-6">
                <p className="text-blue-200/70 text-sm">
                  Sign in to post your score to the leaderboard — one score per account per day.
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthModalMessage(undefined);
                      setShowAuthModal(true);
                    }}
                    className="font-display text-xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-6 py-2 rounded"
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    onClick={() => setSkippedSubmit(true)}
                    className="text-blue-200/60 hover:text-blue-100 px-2"
                  >
                    Skip
                  </button>
                </div>
              </div>
            )
          )}
          {submitted && (
            <div className="flex flex-col items-center gap-1 mb-6">
              <p className="text-green-400/90">Score posted to the leaderboard.</p>
              {stats && (
                <PercentileMeter
                  fillFraction={stats.fillFraction}
                  topPercent={stats.topPercent}
                  isFirst={stats.isFirst}
                  isSolo={stats.isSolo}
                />
              )}
            </div>
          )}

          {/* Leaderboard */}
          <div className="max-w-md mx-auto">
            <p className="font-display tracking-wider text-gold uppercase text-center mb-2">
              Leaderboard · {board.date}
            </p>
            <p className="text-center mb-3">
              <Link
                href={`/boards/${board.date}/scores`}
                className="text-xs text-gold/70 hover:text-gold underline"
              >
                See full leaderboard →
              </Link>
            </p>
            {leaderboard === null ? (
              <p className="text-center text-blue-200/50">Loading scores…</p>
            ) : leaderboard.length === 0 ? (
              <p className="text-center text-blue-200/50">No scores posted yet — be the first.</p>
            ) : (
              <ol className="divide-y divide-board">
                {leaderboard.slice(0, 10).map((row, i) => (
                  <li key={`${row.name}-${i}`} className="flex items-center gap-3 py-1.5">
                    <span className="text-blue-200/50 w-6 text-right">{i + 1}.</span>
                    <span className="flex-1 truncate">{row.name}</span>
                    <span className="text-blue-200/50 text-sm">{formatDuration(row.durationMs)}</span>
                    <span
                      className={`font-display text-xl tracking-wide w-20 text-right ${
                        row.score < 0 ? "text-red-400" : "text-gold"
                      }`}
                    >
                      {formatMoney(row.score)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}

      {/* Clue modal */}
      {active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl bg-board rounded-lg shadow-2xl p-6 md:p-10">
            {phase === "wager" ? (
              <form onSubmit={submitWager} className="text-center">
                <p className="font-display text-4xl tracking-widest text-gold mb-1 animate-pulse">
                  DAILY DOUBLE!
                </p>
                <p className="text-blue-200/70 mb-6">
                  Category: <span className="text-foreground">{active.categoryTitle}</span>
                </p>
                <label className="block text-sm text-blue-200/70 mb-2">
                  Wager between $5 and ${maxWager.toLocaleString()}
                </label>
                <input
                  ref={wagerRef}
                  type="number"
                  min={5}
                  max={maxWager}
                  step={100}
                  value={wagerInput}
                  onChange={(e) => setWagerInput(e.target.value)}
                  placeholder={`e.g. ${Math.min(maxWager, 1000)}`}
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
              <>
                <p className="font-display tracking-wider text-gold uppercase mb-1">
                  {active.categoryTitle} · $
                  {active.dailyDouble && active.wager ? active.wager.toLocaleString() : active.value}
                  {active.dailyDouble && " · DAILY DOUBLE"}
                </p>
                <p className="text-xl md:text-2xl leading-snug my-6">{active.clue}</p>

                {phase !== "result" && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitAnswer(false);
                    }}
                    className="flex flex-col gap-3"
                  >
                    <input
                      ref={inputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      maxLength={200}
                      disabled={phase === "judging"}
                      placeholder="What is…?"
                      className="w-full rounded bg-board-deep border border-blue-300/30 focus:border-gold outline-none px-4 py-3 text-lg placeholder:text-blue-200/40"
                    />
                    <div className="flex gap-3 justify-end">
                      <button
                        type="button"
                        onClick={() => submitAnswer(true)}
                        disabled={phase === "judging"}
                        className="text-blue-200/70 hover:text-blue-100 px-4 py-2 disabled:opacity-50"
                      >
                        No idea — reveal
                      </button>
                      <button
                        type="submit"
                        disabled={phase === "judging" || !input.trim()}
                        className="font-display text-xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-6 py-2 rounded disabled:opacity-50"
                      >
                        {phase === "judging" ? "Judges…" : "Submit"}
                      </button>
                    </div>
                  </form>
                )}

                {phase === "result" && verdict && (
                  <div>
                    <p
                      className={`font-display text-3xl tracking-wide mb-2 ${
                        verdict.outcome === "correct"
                          ? "text-green-400"
                          : verdict.outcome === "wrong"
                            ? "text-red-400"
                            : "text-blue-200/70"
                      }`}
                    >
                      {verdict.outcome === "correct"
                        ? `Correct! +$${verdict.pointValue.toLocaleString()}`
                        : verdict.outcome === "wrong"
                          ? `Incorrect. −$${verdict.pointValue.toLocaleString()}`
                          : "Passed"}
                    </p>
                    <p className="text-lg mb-1">
                      <span className="text-blue-200/60">Answer: </span>
                      <span className="text-gold">{verdict.correctAnswer}</span>
                    </p>
                    {verdict.comment && <p className="text-blue-200/80 italic">{verdict.comment}</p>}
                    <div className="flex justify-end mt-6">
                      <button
                        onClick={closeClue}
                        className="font-display text-xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-6 py-2 rounded"
                      >
                        Back to board <span className="opacity-60">⏎</span>
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Top-level so it can open from anywhere sign-in is required — not
          just the post-game prompt, but also clicking a clue while signed
          out (see openClue). Nesting this inside a conditional tied to game
          state meant it silently had nowhere to render mid-game. */}
      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} message={authModalMessage} />
      )}
    </div>
  );
}
