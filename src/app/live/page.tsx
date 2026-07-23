"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import AuthModal from "@/components/AuthModal";
import { liveCreate } from "@/lib/liveActions";
import { mmDecline, mmJoin, mmLeave, mmReady, mmStatus } from "@/lib/matchmakingActions";
import type { MatchStatus } from "@/lib/matchmaking";

export default function LiveEntryPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [showAuth, setShowAuth] = useState(false);
  const [mode, setMode] = useState<"normal" | "ranked">("normal");
  const [source, setSource] = useState<"pool" | "unplayed" | "custom">("pool");
  const [answerMs, setAnswerMs] = useState(10000);
  const [scoringMode, setScoringMode] = useState<"all_correct" | "winner_only">("all_correct");
  const [pickMode, setPickMode] = useState<"winner" | "alternating" | "loser">("winner");
  const [cats, setCats] = useState<string[]>(["", "", "", "", "", ""]);
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  // Ranked matchmaking: idle (not searching) -> searching (queued, no match
  // yet) -> matched (ready-check in progress or waiting on the opponent).
  const [mmState, setMmState] = useState<"idle" | "searching" | "matched">("idle");
  const [match, setMatch] = useState<MatchStatus | null>(null);
  const [mmError, setMmError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const name = user?.displayName ?? "";

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  // Polls /api/matchmaking/status while searching or matched, redirecting
  // into the game the instant both players are ready (gameCode appears).
  useEffect(() => {
    if (mmState === "idle" || !user) return;
    const tick = async () => {
      try {
        const { queue, match: m } = await mmStatus(user);
        if (queue.state === "idle") {
          setMmState("idle");
          setMatch(null);
          return;
        }
        setMmState(queue.state === "matched" ? "matched" : "searching");
        setMatch(m);
        if (m?.gameCode) {
          stopPolling();
          router.push(`/live/${m.gameCode}`);
        } else if (m?.status === "expired") {
          setMmError("The other player didn't ready up in time. Search again?");
          setMmState("idle");
          setMatch(null);
          stopPolling();
        }
      } catch {
        /* transient — next tick retries */
      }
    };
    tick();
    pollRef.current = setInterval(tick, 2000);
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mmState, user]);

  useEffect(() => stopPolling, []);

  const findMatch = async () => {
    if (!user) return setShowAuth(true);
    setMmError(null);
    setMmState("searching");
    try {
      await mmJoin(user, name);
    } catch (e) {
      setMmError(e instanceof Error ? e.message : "Couldn't join the queue.");
      setMmState("idle");
    }
  };

  const cancelSearch = async () => {
    if (!user) return;
    stopPolling();
    setMmState("idle");
    setMatch(null);
    await mmLeave(user).catch(() => {});
  };

  const readyUp = async () => {
    if (!user || !match) return;
    try {
      await mmReady(user, match.matchId);
    } catch (e) {
      setMmError(e instanceof Error ? e.message : "Couldn't ready up.");
    }
  };

  const declineReady = async () => {
    if (!user || !match) return;
    stopPolling();
    await mmDecline(user, match.matchId).catch(() => {});
    setMmState("idle");
    setMatch(null);
  };

  const start = async () => {
    if (!user) return setShowAuth(true);
    setBusy("create");
    setError(null);
    try {
      // Ranked always uses a fresh AI board (enforced server-side too); host
      // board choices only apply to normal games.
      let boardKey = mode === "ranked" || source !== "unplayed" ? "pool" : "unplayed";
      if (mode === "normal" && source === "custom") {
        // Generate the custom board first, then start a game on it.
        const filled = cats.map((c) => c.trim()).filter(Boolean);
        if (filled.length === 0) {
          setError("Add at least one category for a custom board.");
          setBusy(null);
          return;
        }
        const token = await user.getIdToken();
        const res = await fetch("/api/custom", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ categories: cats }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Couldn't generate the board.");
        boardKey = String(data.key);
      }
      const { code } = await liveCreate(user, name, mode, boardKey, answerMs, scoringMode, pickMode);
      router.push(`/live/${code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start a game.");
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <main className="flex-1 w-full max-w-md mx-auto px-4 py-16">
        <header className="text-center mb-10">
          <h1 className="font-display text-4xl md:text-5xl tracking-wider text-gold">Play with Friends</h1>
          <p className="text-blue-200/70 mt-2">
            Up to 3 players, one board. Everyone gets 10 seconds to answer each clue — fastest connection
            doesn&apos;t win, the right answer does.
          </p>
          <div className="mt-3 flex items-center justify-center gap-4 text-sm">
            <Link href="/" className="text-gold/80 hover:text-gold underline">
              ← Solo board
            </Link>
            <Link href="/friends" className="text-gold/80 hover:text-gold underline">
              Friends →
            </Link>
            <Link href="/rankings" className="text-gold/80 hover:text-gold underline">
              Ranked leaderboard →
            </Link>
          </div>
        </header>

        {loading ? (
          <p className="text-center text-blue-200/50 py-10">Loading…</p>
        ) : !user ? (
          <div className="text-center bg-board-deep/60 border border-board rounded-lg p-8">
            <p className="text-blue-200/80 mb-4">Sign in to start or join a game.</p>
            <button
              onClick={() => setShowAuth(true)}
              className="font-display text-xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-6 py-2 rounded"
            >
              Sign in
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Mode toggle */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-board-deep rounded-lg">
              {(["normal", "ranked"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-md py-2 font-display tracking-wide transition-colors ${
                    mode === m ? "bg-gold text-board-deep" : "text-blue-200/70 hover:text-blue-100"
                  }`}
                >
                  {m === "normal" ? "Normal" : "Ranked"}
                </button>
              ))}
            </div>
            <p className="text-center text-xs text-blue-200/50 -mt-3">
              {mode === "normal"
                ? "Casual — any player can pause the game anytime."
                : "Counts toward your rating. No pausing; needs 2+ players."}
            </p>

            {mode === "ranked" ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-gold/30 bg-board-deep/50 p-4">
                  <p className="text-xs uppercase tracking-wider text-gold/70 mb-2">Ranked rules · fixed</p>
                  <ul className="text-sm text-blue-100/90 space-y-1.5">
                    <li>🎲 Fresh AI board — same for both players</li>
                    <li>⏱️ 10 seconds to answer each clue</li>
                    <li>⚡ Only the fastest correct answer scores</li>
                    <li>🏆 Fastest correct answerer picks next</li>
                  </ul>
                  <p className="text-xs text-blue-200/50 mt-3">
                    Every rated game uses these settings so the ladder stays fair.
                  </p>
                </div>

                {mmState === "idle" && (
                  <button
                    onClick={findMatch}
                    className="w-full font-display text-2xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-6 py-4 rounded-lg"
                  >
                    Find match
                  </button>
                )}

                {mmState === "searching" && (
                  <div className="text-center bg-board-deep/60 border border-board rounded-lg p-6">
                    <div className="inline-block h-8 w-8 border-2 border-gold border-t-transparent rounded-full animate-spin mb-3" />
                    <p className="font-display text-xl tracking-wide text-gold">Searching for an opponent…</p>
                    <button
                      onClick={cancelSearch}
                      className="mt-4 text-sm text-blue-200/60 hover:text-blue-100 underline"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {mmState === "matched" && match && (
                  <div className="text-center bg-board-deep/60 border border-gold/40 rounded-lg p-6">
                    <p className="font-display text-2xl tracking-wide text-gold mb-1">Match found!</p>
                    <p className="text-blue-100/80 mb-4">
                      vs {match.players.find((p) => p.uid !== user?.uid)?.name ?? "opponent"}
                    </p>
                    <div className="flex justify-center gap-2 mb-4">
                      {match.players.map((p) => (
                        <span
                          key={p.uid}
                          className={`text-xs px-2.5 py-1 rounded-full border ${
                            match.readyUids.includes(p.uid)
                              ? "border-green-400/40 text-green-300"
                              : "border-blue-300/20 text-blue-200/40"
                          }`}
                        >
                          {p.uid === user?.uid ? "You" : p.name} {match.readyUids.includes(p.uid) ? "✓" : "…"}
                        </span>
                      ))}
                    </div>
                    {user && match.readyUids.includes(user.uid) ? (
                      <p className="text-green-400/90 text-sm">Ready — waiting for the other player…</p>
                    ) : (
                      <div className="flex gap-3 justify-center">
                        <button
                          onClick={readyUp}
                          className="font-display text-xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-8 py-2 rounded"
                        >
                          Ready
                        </button>
                        <button
                          onClick={declineReady}
                          className="text-sm text-blue-200/60 hover:text-blue-100 underline"
                        >
                          Decline
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {mmError && <p className="text-center text-red-300 text-sm">{mmError}</p>}
              </div>
            ) : (
              <>
                {/* Board source */}
                <div>
                  <p className="text-xs uppercase tracking-wider text-blue-200/40 mb-2">Board</p>
              <div className="grid grid-cols-3 gap-2 p-1 bg-board-deep rounded-lg">
                {(
                  [
                    ["pool", "Fresh AI"],
                    ["unplayed", "Real episode"],
                    ["custom", "Custom"],
                  ] as const
                ).map(([s, label]) => (
                  <button
                    key={s}
                    onClick={() => setSource(s)}
                    className={`rounded-md py-2 text-sm font-display tracking-wide transition-colors ${
                      source === s ? "bg-gold text-board-deep" : "text-blue-200/70 hover:text-blue-100"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {source === "unplayed" && (
                <p className="text-xs text-blue-200/50 mt-2">
                  A real Jeopardy! episode you haven&apos;t played yet, picked at random.
                </p>
              )}
              {source === "custom" && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-blue-200/50">Name up to 6 categories; Claude writes the clues.</p>
                  {cats.map((c, i) => (
                    <input
                      key={i}
                      value={c}
                      onChange={(e) => setCats((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))}
                      maxLength={60}
                      placeholder={`Category ${i + 1}`}
                      className="w-full rounded-lg bg-board border border-blue-300/30 focus:border-gold outline-none px-3 py-2 text-sm placeholder:text-blue-200/30"
                    />
                  ))}
                </div>
              )}
              <p className="text-center text-[11px] text-blue-200/40 mt-2">
                Want a real historical episode?{" "}
                <Link href="/archive" className="text-gold/70 hover:text-gold underline">
                  Pick one from the archive
                </Link>{" "}
                and use its Play-with-friends button.
              </p>
            </div>

            {/* Answer timer setting */}
            <div>
              <p className="text-xs uppercase tracking-wider text-blue-200/40 mb-2">
                Answer timer · {answerMs / 1000}s
              </p>
              <div className="grid grid-cols-5 gap-2">
                {[5000, 10000, 15000, 20000, 30000].map((ms) => (
                  <button
                    key={ms}
                    onClick={() => setAnswerMs(ms)}
                    className={`rounded-md py-2 text-sm font-display tracking-wide transition-colors ${
                      answerMs === ms ? "bg-gold text-board-deep" : "bg-board-deep text-blue-200/70 hover:text-blue-100"
                    }`}
                  >
                    {ms / 1000}s
                  </button>
                ))}
              </div>
            </div>

            {/* Scoring rule */}
            <div>
              <p className="text-xs uppercase tracking-wider text-blue-200/40 mb-2">Scoring</p>
              <div className="grid grid-cols-2 gap-2 p-1 bg-board-deep rounded-lg">
                {(
                  [
                    ["all_correct", "All correct score"],
                    ["winner_only", "Only fastest scores"],
                  ] as const
                ).map(([s, label]) => (
                  <button
                    key={s}
                    onClick={() => setScoringMode(s)}
                    className={`rounded-md py-2 text-sm font-display tracking-wide transition-colors ${
                      scoringMode === s ? "bg-gold text-board-deep" : "text-blue-200/70 hover:text-blue-100"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-blue-200/50 mt-2">
                {scoringMode === "all_correct"
                  ? "Everyone who answers correctly earns the clue's value."
                  : "Only the fastest correct answer earns money — real buzzer rules."}
              </p>
            </div>

            {/* Pick order */}
            <div>
              <p className="text-xs uppercase tracking-wider text-blue-200/40 mb-2">Who picks next</p>
              <div className="grid grid-cols-3 gap-2 p-1 bg-board-deep rounded-lg">
                {(
                  [
                    ["winner", "Winner picks"],
                    ["alternating", "Alternating"],
                    ["loser", "Loser picks"],
                  ] as const
                ).map(([s, label]) => (
                  <button
                    key={s}
                    onClick={() => setPickMode(s)}
                    className={`rounded-md py-2 text-sm font-display tracking-wide transition-colors ${
                      pickMode === s ? "bg-gold text-board-deep" : "text-blue-200/70 hover:text-blue-100"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-blue-200/50 mt-2">
                {pickMode === "winner"
                  ? "The fastest correct answerer chooses the next clue."
                  : pickMode === "alternating"
                    ? "The pick rotates through players in turn, no matter who's right."
                    : "Whoever's in last place chooses the next clue."}
              </p>
            </div>
              </>
            )}

            {mode === "normal" && (
              <button
                onClick={start}
                disabled={busy !== null}
                className="w-full font-display text-2xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-6 py-4 rounded-lg disabled:opacity-50"
              >
                {busy === "create" ? (source === "custom" ? "Writing board…" : "Starting…") : "Start game"}
              </button>
            )}

            <p className="text-center text-xs text-blue-200/40">
              Want to bring a friend in?{" "}
              <Link href="/friends" className="text-gold/70 hover:text-gold underline">
                Invite them from your friends list
              </Link>
              , or accept their invite when they start one.
            </p>

            {error && <p className="text-center text-red-300 text-sm">{error}</p>}
          </div>
        )}
      </main>
      {showAuth && (
        <AuthModal onClose={() => setShowAuth(false)} message="Sign in to play with friends." />
      )}
    </div>
  );
}
