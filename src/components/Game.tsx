"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublicBoard, PublicClue } from "@/lib/jeopardy";

type Outcome = "correct" | "wrong" | "passed";

interface ClueResult {
  outcome: Outcome;
  correctAnswer: string;
  comment: string;
  playerAnswer?: string;
}

interface SavedGame {
  date: string;
  boardId: string;
  results: Record<string, ClueResult>;
  score: number;
}

interface ActiveClue extends PublicClue {
  categoryTitle: string;
}

const STORAGE_KEY = "daily-double-v1";

const LOADING_MESSAGES = [
  "Summoning today's categories…",
  "Claude is writing 30 clues…",
  "Fact-checking the $1000 row…",
  "Polishing the wordplay…",
  "Lowering the podiums…",
  "Cueing the think music…",
];

function loadSaved(): SavedGame | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedGame) : null;
  } catch {
    return null;
  }
}

function formatMoney(n: number): string {
  return `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString()}`;
}

export default function Game() {
  const [board, setBoard] = useState<PublicBoard | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ClueResult>>({});
  const [score, setScore] = useState(0);
  const [active, setActive] = useState<ActiveClue | null>(null);
  const [phase, setPhase] = useState<"answering" | "judging" | "result">("answering");
  const [input, setInput] = useState("");
  const [verdict, setVerdict] = useState<ClueResult | null>(null);
  const [loadingMsg, setLoadingMsg] = useState(0);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const totalClues = useMemo(
    () => board?.categories.reduce((n, c) => n + c.clues.length, 0) ?? 0,
    [board]
  );
  const answeredCount = Object.keys(results).length;
  const finished = board !== null && answeredCount === totalClues;

  const fetchBoard = useCallback(async () => {
    setBoard(null);
    setLoadError(null);
    try {
      const res = await fetch("/api/board");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load the board.");
      const fresh = data as PublicBoard;
      const saved = loadSaved();
      if (saved && saved.boardId === fresh.boardId && saved.date === fresh.date) {
        setResults(saved.results);
        setScore(saved.score);
      } else {
        localStorage.removeItem(STORAGE_KEY);
        setResults({});
        setScore(0);
      }
      setBoard(fresh);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load the board.");
    }
  }, []);

  useEffect(() => {
    fetchBoard();
  }, [fetchBoard]);

  // Rotate the loading copy while the first board of the day generates.
  useEffect(() => {
    if (board || loadError) return;
    const t = setInterval(() => setLoadingMsg((i) => (i + 1) % LOADING_MESSAGES.length), 2600);
    return () => clearInterval(t);
  }, [board, loadError]);

  useEffect(() => {
    if (active && phase === "answering") inputRef.current?.focus();
  }, [active, phase]);

  const persist = useCallback(
    (nextResults: Record<string, ClueResult>, nextScore: number) => {
      if (!board) return;
      const saved: SavedGame = {
        date: board.date,
        boardId: board.boardId,
        results: nextResults,
        score: nextScore,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    },
    [board]
  );

  const recordResult = useCallback(
    (clue: ActiveClue, result: ClueResult) => {
      setResults((prev) => {
        const next = { ...prev, [clue.id]: result };
        setScore((prevScore) => {
          const delta =
            result.outcome === "correct" ? clue.value : result.outcome === "wrong" ? -clue.value : 0;
          const nextScore = prevScore + delta;
          persist(next, nextScore);
          return nextScore;
        });
        return next;
      });
      setVerdict(result);
      setPhase("result");
    },
    [persist]
  );

  const handleBoardChanged = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setActive(null);
    setVerdict(null);
    setLoadError(null);
    alert("Today's board was refreshed on the server — reloading it now.");
    fetchBoard();
  }, [fetchBoard]);

  const submitAnswer = useCallback(
    async (reveal: boolean) => {
      if (!board || !active) return;
      const answer = input.trim();
      if (!reveal && !answer) return;
      setPhase("judging");
      try {
        const res = await fetch("/api/judge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            reveal
              ? { boardId: board.boardId, clueId: active.id, reveal: true }
              : { boardId: board.boardId, clueId: active.id, answer }
          ),
        });
        const data = await res.json();
        if (res.status === 409) return handleBoardChanged();
        if (!res.ok) throw new Error(data.error ?? "Judging failed.");
        recordResult(active, {
          outcome: reveal ? "passed" : data.correct ? "correct" : "wrong",
          correctAnswer: data.correctAnswer,
          comment: data.comment,
          playerAnswer: reveal ? undefined : answer,
        });
      } catch (error) {
        setPhase("answering");
        alert(error instanceof Error ? error.message : "Judging failed — try again.");
      }
    },
    [board, active, input, recordResult, handleBoardChanged]
  );

  const openClue = (clue: PublicClue, categoryTitle: string) => {
    if (results[clue.id]) return;
    setActive({ ...clue, categoryTitle });
    setInput("");
    setVerdict(null);
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

  const shareResult = async () => {
    if (!board) return;
    const rows: string[] = [];
    for (let r = 0; r < 5; r++) {
      rows.push(
        board.categories
          .map((cat) => {
            const result = results[cat.clues[r]?.id ?? ""];
            if (!result) return "⬛";
            return result.outcome === "correct" ? "🟩" : result.outcome === "wrong" ? "🟥" : "⬜";
          })
          .join("")
      );
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

  return (
    <div className="w-full max-w-5xl mx-auto">
      {/* Scoreboard */}
      <div className="flex items-baseline justify-between mb-4 px-1">
        <p className="text-sm text-blue-200/70">
          {new Date(`${board.date}T12:00:00`).toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
        <p className="font-display text-3xl tracking-wide">
          <span className={score < 0 ? "text-red-400" : "text-gold"}>{formatMoney(score)}</span>
          <span className="text-blue-200/50 text-lg ml-3">
            {answeredCount}/{totalClues}
          </span>
        </p>
      </div>

      {/* Board */}
      <div className="overflow-x-auto pb-2">
        <div className="grid grid-cols-6 gap-1.5 min-w-[680px]">
          {board.categories.map((cat) => (
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
            board.categories.map((cat) => {
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

      {/* Final banner */}
      {finished && (
        <div className="mt-8 text-center bg-board-deep/60 border border-board rounded-lg p-8">
          <p className="font-display text-4xl tracking-wide text-gold mb-2">
            Final score: {formatMoney(score)}
          </p>
          <p className="text-blue-200/80 mb-5">
            {score >= 4000
              ? "Champion material. See you tomorrow?"
              : score >= 0
                ? "Solid game — a new board drops tomorrow."
                : "Rough board. Tomorrow's a fresh start."}
          </p>
          <button
            onClick={shareResult}
            className="font-display text-xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-6 py-2 rounded"
          >
            {copied ? "Copied!" : "Copy result"}
          </button>
        </div>
      )}

      {/* Clue modal */}
      {active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl bg-board rounded-lg shadow-2xl p-6 md:p-10">
            <p className="font-display tracking-wider text-gold uppercase mb-1">
              {active.categoryTitle} · ${active.value}
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
                    ? `Correct! +$${active.value}`
                    : verdict.outcome === "wrong"
                      ? `Incorrect. −$${active.value}`
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
          </div>
        </div>
      )}
    </div>
  );
}
