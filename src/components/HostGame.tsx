"use client";

// Classroom "host mode": a teacher runs the board on a projector, reads clues
// aloud, students answer verbally, and the host marks right/wrong and awards the
// clue's value to one of up to 3 teams. Single device, host-controlled, no AI
// judging and no per-student sign-in. All state is local (+ localStorage resume)
// — the only network call loads the answer-carrying board from /api/host-board.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Board, Clue } from "@/lib/jeopardy";
import { formatBoardDate, formatMoney } from "@/lib/format";
import { playSound } from "@/lib/sounds";
import { useAuth } from "@/components/AuthProvider";
import { useModalA11y } from "@/lib/useModalA11y";

type Stage = "setup" | "round" | "final" | "done";
type WrongMode = "none" | "deduct" | "steal";

interface HostTeam {
  id: string;
  name: string;
  color: string;
  score: number;
}

interface HostSave {
  teams: HostTeam[];
  wrongAnswer: WrongMode;
  answered: Record<string, { awardedTeamId: string | null }>;
  roundIndex: number;
  stage: Stage;
  finalWagers: Record<string, number>;
  finalResults: Record<string, boolean>;
}

const TEAM_COLORS = ["#f0c14b", "#46d17f", "#f0776c"]; // gold, green, coral
const TEAM_LABELS = ["Team 1", "Team 2", "Team 3"];
const SAVE_PREFIX = "daily-double-host:";

const WRONG_OPTIONS: { value: WrongMode; label: string; hint: string }[] = [
  { value: "none", label: "No penalty", hint: "Reveal, award the winner, or move on." },
  { value: "deduct", label: "Deduct wrong answers", hint: "A wrong guess subtracts the clue's value." },
  { value: "steal", label: "Steal", hint: "Wrong answers deduct; another team can still take it." },
];

function makeTeams(count: number): HostTeam[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `t${i}`,
    name: TEAM_LABELS[i],
    color: TEAM_COLORS[i],
    score: 0,
  }));
}

export default function HostGame({ boardKey }: { boardKey: string }) {
  const { user, loading: authLoading } = useAuth();

  const [board, setBoard] = useState<Board | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [stage, setStage] = useState<Stage>("setup");
  const [teams, setTeams] = useState<HostTeam[]>(() => makeTeams(2));
  const [wrongAnswer, setWrongAnswer] = useState<WrongMode>("none");
  const [answered, setAnswered] = useState<Record<string, { awardedTeamId: string | null }>>({});
  const [roundIndex, setRoundIndex] = useState(0);
  const [finalWagers, setFinalWagers] = useState<Record<string, number>>({});
  const [finalResults, setFinalResults] = useState<Record<string, boolean>>({});

  // Open-clue overlay state.
  const [active, setActive] = useState<{ clue: Clue; categoryTitle: string } | null>(null);
  const [ddTeamId, setDdTeamId] = useState<string | null>(null);
  const [ddWager, setDdWager] = useState<number | null>(null);
  const [ddWagerInput, setDdWagerInput] = useState("");
  const [revealed, setRevealed] = useState(false);
  // Highlighted board cell for keyboard/presenter-clicker navigation.
  const [focusedCell, setFocusedCell] = useState({ row: 0, col: 0 });

  // Final Jeopardy sub-phase (not persisted precisely; resumes at "wager" with
  // the entered wagers preserved).
  const [finalPhase, setFinalPhase] = useState<"wager" | "clue" | "grade">("wager");

  const overlayRef = useModalA11y();

  // ---- load board ----
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoadError("Sign in to host a board.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/host-board?date=${encodeURIComponent(boardKey)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.board) throw new Error(data.error ?? "Couldn't load the board.");
        setBoard(data.board as Board);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Couldn't load the board.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, boardKey]);

  // ---- resume from localStorage ----
  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    try {
      const raw = localStorage.getItem(SAVE_PREFIX + boardKey);
      if (!raw) return;
      const s = JSON.parse(raw) as HostSave;
      setTeams(s.teams);
      setWrongAnswer(s.wrongAnswer);
      setAnswered(s.answered ?? {});
      setRoundIndex(s.roundIndex ?? 0);
      setStage(s.stage ?? "setup");
      setFinalWagers(s.finalWagers ?? {});
      setFinalResults(s.finalResults ?? {});
    } catch {
      // ignore a corrupt save
    }
  }, [boardKey]);

  // ---- persist once the game has started ----
  useEffect(() => {
    if (stage === "setup") return;
    const save: HostSave = { teams, wrongAnswer, answered, roundIndex, stage, finalWagers, finalResults };
    try {
      localStorage.setItem(SAVE_PREFIX + boardKey, JSON.stringify(save));
    } catch {
      // storage full / disabled — non-fatal
    }
  }, [stage, teams, wrongAnswer, answered, roundIndex, finalWagers, finalResults, boardKey]);

  const round = board?.rounds[roundIndex];
  const roundClueIds = useMemo(
    () => (round ? round.categories.flatMap((c) => c.clues.filter((cl) => !cl.unrevealed).map((cl) => cl.id)) : []),
    [round]
  );
  const roundDone = roundClueIds.length > 0 && roundClueIds.every((id) => id in answered);
  const hasFinal = !!board?.final;
  const isLastRound = board ? roundIndex >= board.rounds.length - 1 : false;

  const adjustScore = useCallback((teamId: string, delta: number) => {
    setTeams((ts) => ts.map((t) => (t.id === teamId ? { ...t, score: t.score + delta } : t)));
  }, []);

  // Undo: a stack of resolved clues with the net score change each caused, so
  // the host can revert a misclick live (award to the wrong team, mis-mark) in
  // front of the room. Cleared on round change so it stays scoped to the board
  // on screen. Transient (not persisted) — undo is for immediate mistakes.
  const [history, setHistory] = useState<{ clueId: string; deltas: Record<string, number> }[]>([]);
  const pendingRef = useRef<Record<string, number>>({});

  const applyDelta = useCallback(
    (teamId: string, delta: number) => {
      adjustScore(teamId, delta);
      pendingRef.current[teamId] = (pendingRef.current[teamId] ?? 0) + delta;
    },
    [adjustScore]
  );

  const closeClue = useCallback(() => {
    setActive(null);
    setRevealed(false);
    setDdTeamId(null);
    setDdWager(null);
    setDdWagerInput("");
  }, []);

  // Resolve the open clue: record its net deltas + who got it, then close.
  const commit = useCallback(
    (clueId: string, awardedTeamId: string | null) => {
      const deltas = { ...pendingRef.current };
      pendingRef.current = {};
      setAnswered((a) => ({ ...a, [clueId]: { awardedTeamId } }));
      setHistory((h) => [...h, { clueId, deltas }]);
      closeClue();
    },
    [closeClue]
  );

  const undoLast = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const last = h[h.length - 1];
      Object.entries(last.deltas).forEach(([teamId, delta]) => adjustScore(teamId, -delta));
      setAnswered((a) => {
        const next = { ...a };
        delete next[last.clueId];
        return next;
      });
      return h.slice(0, -1);
    });
  }, [adjustScore]);

  const openClue = (clue: Clue, categoryTitle: string) => {
    if (clue.unrevealed || clue.id in answered) return;
    pendingRef.current = {};
    setActive({ clue, categoryTitle });
    setRevealed(false);
    setDdTeamId(null);
    setDdWager(null);
    setDdWagerInput("");
    if (clue.dailyDouble) playSound("dailydouble");
  };

  // Amount at stake for the open clue: the wager for a Daily Double, else face value.
  const stake = active ? (active.clue.dailyDouble && ddWager !== null ? ddWager : active.clue.value) : 0;

  const markCorrect = (teamId: string) => {
    if (!active) return;
    applyDelta(teamId, stake);
    playSound("correct");
    commit(active.clue.id, teamId);
  };
  const markWrong = (teamId: string) => {
    if (!active) return;
    applyDelta(teamId, -stake);
    playSound("wrong");
    // Daily Double: only the wagering team answers, so a wrong ends the clue.
    if (active.clue.dailyDouble) {
      commit(active.clue.id, null);
    }
    // Otherwise the clue stays open (deduct/steal) so another team can take it.
  };
  const markNoOne = () => {
    if (!active) return;
    commit(active.clue.id, null);
  };

  const teamById = (id: string | null) => teams.find((t) => t.id === id) ?? null;

  // Keyboard / presenter-clicker control so the host can run the board from the
  // front of the room. A ref holds the latest closure (bound once) so the
  // handler always sees current state without re-attaching every render.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (stage !== "round") return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return; // don't hijack the DD wager field

    if (active) {
      if (active.clue.dailyDouble && ddWager === null) return; // DD wager step is mouse-driven
      if (!revealed) {
        if (e.key === "Enter" || e.key === "r" || e.key === "R" || e.key === " ") {
          e.preventDefault();
          setRevealed(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          closeClue();
        }
        return;
      }
      // Revealed & awarding. Daily Double: only the wagering team answered, so
      // Enter/Y = correct, N = wrong. Regular clue: a number key awards that
      // team; 0/N = no one got it.
      if (active.clue.dailyDouble) {
        if (!ddTeamId) return;
        if (e.key === "Enter" || e.key === "y" || e.key === "Y") {
          e.preventDefault();
          markCorrect(ddTeamId);
        } else if (e.key === "n" || e.key === "N" || e.key === "0") {
          e.preventDefault();
          markWrong(ddTeamId);
        }
        return;
      }
      if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        if (idx < teams.length) {
          e.preventDefault();
          markCorrect(teams[idx].id);
        }
      } else if (e.key === "0" || e.key === "n" || e.key === "N") {
        e.preventDefault();
        markNoOne();
      }
      return;
    }

    // Board (no clue open).
    if (e.key === "u" || e.key === "U") {
      e.preventDefault();
      undoLast();
      return;
    }
    const cols = round?.categories.length ?? 6;
    const clamp = (dr: number, dc: number) => {
      e.preventDefault();
      setFocusedCell((fc) => ({
        row: Math.min(4, Math.max(0, fc.row + dr)),
        col: Math.min(cols - 1, Math.max(0, fc.col + dc)),
      }));
    };
    if (e.key === "ArrowUp") clamp(-1, 0);
    else if (e.key === "ArrowDown") clamp(1, 0);
    else if (e.key === "ArrowLeft") clamp(0, -1);
    else if (e.key === "ArrowRight") clamp(0, 1);
    else if (e.key === "Enter" || e.key === " ") {
      const cat = round?.categories[focusedCell.col];
      const clue = cat?.clues[focusedCell.row];
      if (cat && clue && !clue.unrevealed && !(clue.id in answered)) {
        e.preventDefault();
        openClue(clue, cat.title);
      }
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ---------------- render ----------------

  if (loadError) {
    return (
      <Centered>
        <p className="text-lg text-red-300 mb-4">{loadError}</p>
        <Link href="/host" className="text-gold underline">
          ← Back to host setup
        </Link>
      </Centered>
    );
  }
  if (!board) {
    return (
      <Centered>
        <p className="text-blue-200/80 animate-pulse">Loading the board…</p>
      </Centered>
    );
  }

  // ---- setup ----
  if (stage === "setup") {
    return (
      <SetupScreen
        board={board}
        teams={teams}
        setTeams={setTeams}
        wrongAnswer={wrongAnswer}
        setWrongAnswer={setWrongAnswer}
        onStart={() => setStage("round")}
      />
    );
  }

  // ---- final jeopardy ----
  if (stage === "final" && board.final) {
    return (
      <FinalScreen
        board={board}
        teams={teams}
        finalPhase={finalPhase}
        setFinalPhase={setFinalPhase}
        finalWagers={finalWagers}
        setFinalWagers={setFinalWagers}
        finalResults={finalResults}
        setFinalResults={setFinalResults}
        adjustScore={adjustScore}
        onDone={() => setStage("done")}
      />
    );
  }

  // ---- final standings ----
  if (stage === "done") {
    const ranked = [...teams].sort((a, b) => b.score - a.score);
    const top = ranked[0]?.score ?? 0;
    return (
      <Centered>
        <p className="font-display text-4xl md:text-5xl tracking-widest text-gold mb-8">Final Scores</p>
        <div className="w-full max-w-md space-y-3 mb-10">
          {ranked.map((t, i) => (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-lg px-5 py-4 border"
              style={{ borderColor: t.color, background: `${t.color}1a` }}
            >
              <span className="flex items-center gap-3">
                <span className="font-display text-2xl text-blue-200/60 tabular-nums w-6">{i + 1}</span>
                <span className="font-display text-2xl tracking-wide" style={{ color: t.color }}>
                  {t.name}
                </span>
                {t.score === top && top !== 0 && <span className="text-xl">🏆</span>}
              </span>
              <span className="font-display text-3xl tracking-wide tabular-nums" style={{ color: t.color }}>
                {formatMoney(t.score)}
              </span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 justify-center">
          <button
            onClick={() => {
              setTeams((ts) => ts.map((t) => ({ ...t, score: 0 })));
              setAnswered({});
              setRoundIndex(0);
              setFinalWagers({});
              setFinalResults({});
              setFinalPhase("wager");
              setHistory([]);
              setFocusedCell({ row: 0, col: 0 });
              setStage("round");
            }}
            className="font-display text-lg tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-6 py-2.5 rounded"
          >
            New game, same board
          </button>
          <Link
            href="/host"
            className="font-display text-lg tracking-wider bg-board hover:bg-board-deep text-gold border border-[color:var(--hairline-strong)] px-6 py-2.5 rounded"
          >
            Play another board
          </Link>
        </div>
      </Centered>
    );
  }

  // ---- round board ----
  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <main className="flex-1 w-full max-w-6xl mx-auto px-3 md:px-6 py-5">
        <Scoreboard teams={teams} roundName={round?.name ?? ""} boardDate={board.date} />

        {!active && !roundDone && (
          <div className="mt-2 flex items-center justify-center gap-4">
            {history.length > 0 && (
              <button
                onClick={undoLast}
                className="font-display text-sm tracking-wide text-blue-200/70 hover:text-gold border border-[color:var(--hairline)] rounded px-4 py-1.5 transition-colors"
              >
                ↩ Undo last clue
              </button>
            )}
            <span className="hidden md:inline text-[11px] text-blue-200/40">
              ⌨ Arrows move · Enter opens · while open: Enter/R reveals · 1–3 awards · N no one · U undo
            </span>
          </div>
        )}

        {roundDone ? (
          <div className="mt-6 bg-board-deep/60 border border-board rounded-lg p-10 text-center">
            <p className="font-display text-3xl tracking-wide text-gold mb-6">{round?.name} complete!</p>
            {!isLastRound ? (
              <button
                onClick={() => {
                  setHistory([]);
                  setFocusedCell({ row: 0, col: 0 });
                  setRoundIndex((r) => r + 1);
                }}
                className="font-display text-2xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-8 py-3 rounded"
              >
                Continue to {board.rounds[roundIndex + 1]?.name} →
              </button>
            ) : hasFinal ? (
              <button
                onClick={() => {
                  setHistory([]);
                  playSound("final");
                  setStage("final");
                }}
                className="font-display text-2xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-8 py-3 rounded"
              >
                Go to Final Jeopardy →
              </button>
            ) : (
              <button
                onClick={() => setStage("done")}
                className="font-display text-2xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-8 py-3 rounded"
              >
                See final scores →
              </button>
            )}
          </div>
        ) : (
          <div className="mt-5 w-full overflow-x-auto pb-2">
            <div className="grid grid-cols-6 gap-1.5 w-full min-w-[720px]">
              {round?.categories.map((cat) => (
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
                round?.categories.map((cat, col) => {
                  const clue = cat.clues[row];
                  if (!clue) return <div key={`${cat.title}-${row}`} />;
                  if (clue.unrevealed) {
                    return (
                      <div
                        key={clue.id}
                        className="rounded-sm min-h-[80px] flex flex-col items-center justify-center gap-0.5 border border-dashed border-blue-300/20 text-blue-200/30"
                      >
                        <span className="font-display text-xl tracking-wide">${clue.value}</span>
                        <span className="text-[10px] uppercase tracking-wide">Never aired</span>
                      </div>
                    );
                  }
                  const done = answered[clue.id];
                  const awardTeam = done ? teamById(done.awardedTeamId) : null;
                  const focused = focusedCell.row === row && focusedCell.col === col;
                  return (
                    <button
                      key={clue.id}
                      onClick={() => openClue(clue, cat.title)}
                      disabled={!!done}
                      className={`rounded-sm min-h-[80px] flex items-center justify-center transition-colors ${
                        done ? "bg-board/20 cursor-default" : "bg-board hover:bg-board-deep cursor-pointer"
                      } ${focused && !done ? "ring-2 ring-inset ring-gold" : ""}`}
                      style={awardTeam ? { background: `${awardTeam.color}22` } : undefined}
                    >
                      {done ? (
                        awardTeam ? (
                          <span className="font-display text-sm tracking-wide" style={{ color: awardTeam.color }}>
                            {awardTeam.name}
                          </span>
                        ) : (
                          <span className="text-blue-200/40 text-2xl">–</span>
                        )
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
      </main>

      {/* Clue overlay */}
      {active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div
            ref={overlayRef}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            className="w-full max-w-3xl bg-board rounded-lg shadow-2xl p-6 md:p-10"
          >
            <p className="font-display tracking-wider text-gold text-sm md:text-base mb-3">
              {active.categoryTitle} · ${active.clue.value}
              {active.clue.dailyDouble && " · DAILY DOUBLE"}
            </p>

            {/* Daily Double wager step, before the clue is shown */}
            {active.clue.dailyDouble && ddWager === null ? (
              <div>
                <p className="font-display text-4xl tracking-widest text-gold text-center my-6">DAILY DOUBLE!</p>
                <p className="text-blue-200/70 text-center mb-4">Which team found it, and what do they wager?</p>
                <div className="flex flex-wrap gap-2 justify-center mb-5">
                  {teams.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setDdTeamId(t.id)}
                      className="font-display tracking-wide px-4 py-2 rounded border-2"
                      style={{
                        color: t.color,
                        borderColor: t.color,
                        background: ddTeamId === t.id ? `${t.color}33` : "transparent",
                      }}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
                {ddTeamId && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const team = teamById(ddTeamId)!;
                      const max = Math.max(team.score, (roundIndex + 1) * 1000);
                      const req = Math.round(Number(ddWagerInput) || 0);
                      setDdWager(Math.min(max, Math.max(5, req)));
                    }}
                    className="flex flex-col items-center gap-3"
                  >
                    <p className="text-sm text-blue-200/60">
                      Max wager for {teamById(ddTeamId)?.name}:{" "}
                      {formatMoney(Math.max(teamById(ddTeamId)!.score, (roundIndex + 1) * 1000))} (min $5)
                    </p>
                    <input
                      type="number"
                      autoFocus
                      value={ddWagerInput}
                      onChange={(e) => setDdWagerInput(e.target.value)}
                      placeholder="Wager"
                      className="w-40 text-center rounded bg-board-deep border border-blue-300/30 focus:border-gold outline-none px-3 py-2 text-xl"
                    />
                    <button
                      type="submit"
                      className="font-display text-xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-6 py-2 rounded"
                    >
                      Lock in wager
                    </button>
                  </form>
                )}
                <button onClick={closeClue} className="mt-6 block mx-auto text-sm text-blue-200/60 hover:text-blue-100">
                  ← Back to board
                </button>
              </div>
            ) : (
              <div>
                <p className="text-2xl md:text-4xl leading-snug text-center my-6">{active.clue.clue}</p>
                {active.clue.dailyDouble && ddTeamId && (
                  <p className="text-center text-blue-200/60 mb-4">
                    {teamById(ddTeamId)?.name} wagered {formatMoney(ddWager ?? 0)}
                  </p>
                )}

                {!revealed ? (
                  <div className="flex flex-col items-center gap-3">
                    <button
                      onClick={() => setRevealed(true)}
                      className="font-display text-2xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-8 py-3 rounded"
                    >
                      Reveal answer
                    </button>
                    <button onClick={closeClue} className="text-sm text-blue-200/60 hover:text-blue-100">
                      ← Back to board
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="text-center text-blue-200/70 text-sm uppercase tracking-wider mb-1">Answer</p>
                    <p className="text-2xl md:text-3xl text-center text-gold font-display tracking-wide mb-6">
                      {active.clue.answer}
                    </p>

                    {active.clue.dailyDouble && ddTeamId ? (
                      // Only the wagering team answers a Daily Double.
                      <div className="flex flex-wrap gap-3 justify-center">
                        <button
                          onClick={() => markCorrect(ddTeamId)}
                          className="font-display text-lg tracking-wide bg-green-500/90 hover:bg-green-500 text-board-deep px-6 py-2.5 rounded"
                        >
                          ✓ {teamById(ddTeamId)?.name} +{formatMoney(ddWager ?? 0)}
                        </button>
                        <button
                          onClick={() => markWrong(ddTeamId)}
                          className="font-display text-lg tracking-wide bg-red-500/90 hover:bg-red-500 text-board-deep px-6 py-2.5 rounded"
                        >
                          ✗ {teamById(ddTeamId)?.name} −{formatMoney(ddWager ?? 0)}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-center text-sm text-blue-200/60">Who got it?</p>
                        <div className="flex flex-wrap gap-2 justify-center">
                          {teams.map((t) => (
                            <div key={t.id} className="flex items-center gap-1">
                              <button
                                onClick={() => markCorrect(t.id)}
                                className="font-display tracking-wide px-4 py-2 rounded-l border-2 border-r-0"
                                style={{ color: t.color, borderColor: t.color }}
                              >
                                ✓ {t.name}
                              </button>
                              {wrongAnswer !== "none" && (
                                <button
                                  onClick={() => markWrong(t.id)}
                                  title={`Mark ${t.name} wrong (−${formatMoney(active.clue.value)})`}
                                  className="px-3 py-2 rounded-r border-2 text-red-300 border-red-400/50 hover:bg-red-500/10"
                                >
                                  ✗
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={markNoOne}
                          className="block mx-auto mt-2 text-sm text-blue-200/60 hover:text-blue-100 underline"
                        >
                          No one got it — move on
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 min-h-[80vh] flex-col items-center justify-center px-6 text-center">{children}</div>
  );
}

function Scoreboard({ teams, roundName, boardDate }: { teams: HostTeam[]; roundName: string; boardDate: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="font-display tracking-wide text-gold text-sm uppercase">{roundName}</p>
        <p className="text-xs text-blue-200/60">{formatBoardDate(boardDate)}</p>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${teams.length}, minmax(0, 1fr))` }}>
        {teams.map((t) => (
          <div
            key={t.id}
            className="rounded-lg px-4 py-3 border text-center"
            style={{ borderColor: t.color, background: `${t.color}14` }}
          >
            <p className="font-display tracking-wide text-sm md:text-base" style={{ color: t.color }}>
              {t.name}
            </p>
            <p className="font-display text-2xl md:text-3xl tracking-wide tabular-nums" style={{ color: t.color }}>
              {formatMoney(t.score)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SetupScreen({
  board,
  teams,
  setTeams,
  wrongAnswer,
  setWrongAnswer,
  onStart,
}: {
  board: Board;
  teams: HostTeam[];
  setTeams: React.Dispatch<React.SetStateAction<HostTeam[]>>;
  wrongAnswer: WrongMode;
  setWrongAnswer: (m: WrongMode) => void;
  onStart: () => void;
}) {
  const setCount = (n: number) => {
    setTeams((prev) => {
      const next = makeTeams(n);
      // keep any names the host already edited
      return next.map((t, i) => (prev[i] ? { ...t, name: prev[i].name } : t));
    });
  };
  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <main className="flex-1 w-full max-w-2xl mx-auto px-4 md:px-8 py-10">
        <header className="text-center mb-8">
          <h1 className="font-display text-4xl md:text-5xl tracking-wider text-gold">Host a Game</h1>
          <p className="text-blue-200/70 mt-2">{formatBoardDate(board.date)}</p>
          <Link href="/host" className="inline-block mt-3 text-gold/80 hover:text-gold underline">
            ← Pick a different board
          </Link>
        </header>

        <section className="mb-8">
          <p className="font-display text-xl tracking-wide text-gold mb-3">Teams</p>
          <div className="flex gap-2 mb-4">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                onClick={() => setCount(n)}
                aria-pressed={teams.length === n}
                className={`font-display tracking-wide px-5 py-2 rounded border ${
                  teams.length === n
                    ? "bg-gold text-board-deep border-gold"
                    : "border-blue-300/30 text-blue-200/70 hover:text-blue-100"
                }`}
              >
                {n} {n === 1 ? "team" : "teams"}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {teams.map((t, i) => (
              <div key={t.id} className="flex items-center gap-3">
                <span className="h-4 w-4 rounded-full shrink-0" style={{ background: t.color }} aria-hidden />
                <input
                  value={t.name}
                  onChange={(e) =>
                    setTeams((ts) => ts.map((x, j) => (j === i ? { ...x, name: e.target.value.slice(0, 24) } : x)))
                  }
                  className="flex-1 rounded bg-board border border-blue-300/30 focus:border-gold outline-none px-3 py-2"
                  aria-label={`Team ${i + 1} name`}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="mb-10">
          <p className="font-display text-xl tracking-wide text-gold mb-3">Wrong answers</p>
          <div className="space-y-2">
            {WRONG_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setWrongAnswer(o.value)}
                aria-pressed={wrongAnswer === o.value}
                className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${
                  wrongAnswer === o.value
                    ? "border-gold bg-gold/10"
                    : "border-blue-300/25 hover:border-blue-300/50"
                }`}
              >
                <span className="font-display tracking-wide text-blue-100">{o.label}</span>
                <span className="block text-sm text-blue-200/60">{o.hint}</span>
              </button>
            ))}
          </div>
        </section>

        <button
          onClick={onStart}
          className="w-full font-display text-2xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep py-3 rounded"
        >
          Start game →
        </button>
      </main>
    </div>
  );
}

function FinalScreen({
  board,
  teams,
  finalPhase,
  setFinalPhase,
  finalWagers,
  setFinalWagers,
  finalResults,
  setFinalResults,
  adjustScore,
  onDone,
}: {
  board: Board;
  teams: HostTeam[];
  finalPhase: "wager" | "clue" | "grade";
  setFinalPhase: (p: "wager" | "clue" | "grade") => void;
  finalWagers: Record<string, number>;
  setFinalWagers: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  finalResults: Record<string, boolean>;
  setFinalResults: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  adjustScore: (teamId: string, delta: number) => void;
  onDone: () => void;
}) {
  const final = board.final!;

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <main className="flex-1 w-full max-w-2xl mx-auto px-4 md:px-8 py-8">
        <p className="font-display text-3xl md:text-4xl tracking-widest text-gold text-center mb-1">
          FINAL JEOPARDY
        </p>
        <p className="text-center font-display text-xl tracking-wide text-blue-100 mb-8">{final.category}</p>

        {finalPhase === "wager" && (
          <div>
            <p className="text-center text-blue-200/70 mb-5">
              Each team secretly wagers up to their score (a team at $0 or below wagers $0).
            </p>
            <div className="space-y-3 mb-8">
              {teams.map((t) => {
                const max = Math.max(0, t.score);
                return (
                  <div key={t.id} className="flex items-center gap-3">
                    <span className="font-display tracking-wide w-28 shrink-0" style={{ color: t.color }}>
                      {t.name}
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={max}
                      value={finalWagers[t.id] ?? ""}
                      onChange={(e) => {
                        const v = Math.min(max, Math.max(0, Math.round(Number(e.target.value) || 0)));
                        setFinalWagers((w) => ({ ...w, [t.id]: v }));
                      }}
                      placeholder={`0 – ${max}`}
                      className="flex-1 rounded bg-board border border-blue-300/30 focus:border-gold outline-none px-3 py-2"
                    />
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => setFinalPhase("clue")}
              className="w-full font-display text-xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep py-3 rounded"
            >
              Wagers locked — show the clue →
            </button>
          </div>
        )}

        {finalPhase === "clue" && (
          <div className="text-center">
            <p className="text-2xl md:text-4xl leading-snug my-8">{final.clue}</p>
            <button
              onClick={() => setFinalPhase("grade")}
              className="font-display text-xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-8 py-3 rounded"
            >
              Reveal answer →
            </button>
          </div>
        )}

        {finalPhase === "grade" && (
          <div>
            <p className="text-center text-blue-200/70 text-sm uppercase tracking-wider mb-1">Answer</p>
            <p className="text-2xl md:text-3xl text-center text-gold font-display tracking-wide mb-8">
              {final.answer}
            </p>
            <div className="space-y-3 mb-8">
              {teams.map((t) => {
                const wager = finalWagers[t.id] ?? 0;
                const graded = t.id in finalResults;
                const mark = (correct: boolean) => {
                  // Use the persisted finalResults (not a ref) as the record of
                  // what's already been applied, so re-grading after a mid-final
                  // refresh doesn't double-count the wager swing.
                  if (graded) {
                    if (finalResults[t.id] === correct) return; // no change
                    adjustScore(t.id, finalResults[t.id] ? -wager : wager); // undo prior
                  }
                  adjustScore(t.id, correct ? wager : -wager);
                  setFinalResults((r) => ({ ...r, [t.id]: correct }));
                };
                return (
                  <div
                    key={t.id}
                    className="flex items-center justify-between rounded-lg px-4 py-3 border"
                    style={{ borderColor: t.color, background: `${t.color}12` }}
                  >
                    <span>
                      <span className="font-display tracking-wide" style={{ color: t.color }}>
                        {t.name}
                      </span>
                      <span className="text-sm text-blue-200/60 ml-2">wagered {formatMoney(wager)}</span>
                    </span>
                    <span className="flex gap-2">
                      <button
                        onClick={() => mark(true)}
                        className={`font-display tracking-wide px-4 py-1.5 rounded ${
                          graded && finalResults[t.id]
                            ? "bg-green-500 text-board-deep"
                            : "border border-green-400/50 text-green-300"
                        }`}
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => mark(false)}
                        className={`font-display tracking-wide px-4 py-1.5 rounded ${
                          graded && !finalResults[t.id]
                            ? "bg-red-500 text-board-deep"
                            : "border border-red-400/50 text-red-300"
                        }`}
                      >
                        ✗
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
            <button
              onClick={onDone}
              disabled={teams.some((t) => !(t.id in finalResults))}
              className="w-full font-display text-xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep py-3 rounded disabled:opacity-50"
            >
              See final scores →
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
