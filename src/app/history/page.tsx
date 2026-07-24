"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import type { MyScoreRow } from "@/lib/scores";
import type { RankedStats } from "@/lib/liveTypes";
import type { InProgressLive, InProgressSolo } from "@/lib/inProgress";
import { computeStreak, formatBoardDate, formatDuration, formatMoney } from "@/lib/format";

const KIND_LABEL: Record<InProgressSolo["kind"], string> = {
  daily: "AI daily",
  historical: "Real episode",
  custom: "Custom",
};

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-board-deep/50 border border-board rounded-lg px-3 py-3 text-center">
      <p className="font-display text-2xl md:text-3xl tracking-wide text-gold tabular-nums">{value}</p>
      <p className="text-[11px] uppercase tracking-wider text-blue-200/50 mt-0.5">{label}</p>
    </div>
  );
}

export default function MyScoresPage() {
  const { user, loading } = useAuth();
  const [scores, setScores] = useState<MyScoreRow[] | null>(null);
  const [rank, setRank] = useState<RankedStats | null>(null);
  const [progressSolo, setProgressSolo] = useState<InProgressSolo[] | null>(null);
  const [progressLive, setProgressLive] = useState<InProgressLive[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setScores(null);
    setRank(null);
    setProgressSolo(null);
    setProgressLive(null);
    setError(null);
    user.getIdToken().then((token) => {
      const auth = { Authorization: `Bearer ${token}` };
      fetch("/api/my-inprogress", { headers: auth })
        .then((res) => res.json())
        .then((data) => {
          setProgressSolo((data.solo as InProgressSolo[]) ?? []);
          setProgressLive((data.live as InProgressLive[]) ?? []);
        })
        .catch(() => {
          setProgressSolo([]);
          setProgressLive([]);
        });
      fetch("/api/my-scores", { headers: auth })
        .then((res) => res.json())
        .then((data) => {
          if (data.error) throw new Error(data.error);
          setScores(data.scores as MyScoreRow[]);
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load your scores."));
      fetch("/api/my-rank", { headers: auth })
        .then((res) => res.json())
        .then((data) => setRank((data.stats as RankedStats | null) ?? null))
        .catch(() => setRank(null));
    });
  }, [user]);

  // Aggregate single-player stats from the score history.
  const stats = (() => {
    if (!scores || scores.length === 0) return null;
    const games = scores.length;
    const best = Math.max(...scores.map((s) => s.score));
    const avg = Math.round(scores.reduce((n, s) => n + s.score, 0) / games);
    const correct = scores.reduce((n, s) => n + s.correct, 0);
    const attempted = scores.reduce((n, s) => n + s.correct + s.wrong, 0);
    const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
    return { games, best, avg, correct, accuracy };
  })();

  // Daily streak — consecutive days with a posted score.
  const streak = (() => {
    if (!scores || scores.length === 0) return null;
    const today = new Date().toISOString().slice(0, 10);
    return computeStreak(scores.map((s) => s.date), today);
  })();

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <main className="flex-1 w-full max-w-2xl mx-auto px-4 md:px-8 py-10">
        <header className="text-center mb-8">
          <h1 className="font-display text-4xl md:text-5xl tracking-wider text-gold">
            My Scores
          </h1>
          <Link href="/" className="inline-block mt-3 text-gold/80 hover:text-gold underline">
            ← Today&apos;s board
          </Link>
        </header>

        {/* Streak */}
        {user && streak && streak.current > 0 && (
          <p className="text-center mb-4">
            <span className="font-display text-xl tracking-wide text-gold">
              🔥 {streak.current}-day streak
            </span>
            {streak.longest > streak.current && (
              <span className="text-blue-200/50 text-sm ml-2">(best: {streak.longest})</span>
            )}
          </p>
        )}

        {/* Stat tiles */}
        {user && stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-8">
            <StatTile label="Games" value={String(stats.games)} />
            <StatTile label="Best score" value={formatMoney(stats.best)} />
            <StatTile label="Avg score" value={formatMoney(stats.avg)} />
            <StatTile label="Accuracy" value={`${stats.accuracy}%`} />
          </div>
        )}
        {user && rank && (
          <div className="grid grid-cols-3 gap-2 mb-8">
            <StatTile label="Ranked rating" value={String(rank.rating)} />
            <StatTile label="Ranked games" value={String(rank.games)} />
            <StatTile
              label="Win rate"
              value={rank.games > 0 ? `${Math.round((rank.wins / rank.games) * 100)}%` : "—"}
            />
          </div>
        )}

        {/* In progress — games started but not finished */}
        {user &&
          ((progressLive && progressLive.length > 0) || (progressSolo && progressSolo.length > 0)) && (
            <section className="mb-8">
              <h2 className="font-display text-2xl tracking-wide text-gold mb-3">In progress</h2>
              <ul className="divide-y divide-board bg-board-deep/40 border border-gold/30 rounded-lg overflow-hidden">
                {progressLive?.map((g) => (
                  <li key={g.code} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-blue-100 truncate">
                        Live game <span className="font-mono text-gold">{g.code}</span>
                      </p>
                      <p className="text-sm text-blue-200/50">
                        {g.players} player{g.players === 1 ? "" : "s"} · multiplayer
                      </p>
                    </div>
                    <Link
                      href={`/live/${g.code}`}
                      className="font-display tracking-wide text-sm border border-gold/40 text-gold px-3 py-1.5 rounded hover:bg-board shrink-0"
                    >
                      Rejoin →
                    </Link>
                  </li>
                ))}
                {progressSolo?.map((s) => {
                  const custom = s.boardKey.startsWith("custom-");
                  const label = custom ? "Custom board" : formatBoardDate(s.boardKey);
                  const href = custom ? `/custom/${s.boardKey.slice(7)}` : `/boards/${s.boardKey}`;
                  return (
                    <li key={s.boardKey} className="flex items-center gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-blue-100 truncate">{label}</p>
                        <p className="text-sm text-blue-200/50">
                          {s.answered} answered · {KIND_LABEL[s.kind]}
                        </p>
                      </div>
                      <Link
                        href={href}
                        className="font-display tracking-wide text-sm border border-gold/40 text-gold px-3 py-1.5 rounded hover:bg-board shrink-0"
                      >
                        Resume →
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

        {loading ? (
          <p className="text-center text-blue-200/50 py-16">Loading…</p>
        ) : !user ? (
          <p className="text-center text-blue-200/60 py-16">
            Sign in (top right) to track your scores across days.
          </p>
        ) : error ? (
          <p className="text-center text-red-300 py-16">{error}</p>
        ) : scores === null ? (
          <p className="text-center text-blue-200/50 py-16">Loading your scores…</p>
        ) : scores.length === 0 ? (
          <p className="text-center text-blue-200/50 py-16">
            No scores yet — play today&apos;s board and post one.
          </p>
        ) : (
          <>
          <h2 className="font-display text-2xl tracking-wide text-gold mb-3">Completed</h2>
          <ol className="divide-y divide-board bg-board-deep/40 border border-board rounded-lg overflow-hidden">
            {scores.map((row) => (
              <li key={row.date} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/boards/${row.date}`}
                    className="text-gold/90 hover:text-gold hover:underline truncate block"
                  >
                    {formatBoardDate(row.date)}
                  </Link>
                  <p className="text-sm text-blue-200/50">
                    {row.correct}✓ {row.wrong}✗ {row.passed}– · {formatDuration(row.durationMs)}
                  </p>
                </div>
                <span
                  className={`font-display text-2xl tracking-wide ${
                    row.score < 0 ? "text-red-400" : "text-gold"
                  }`}
                >
                  {formatMoney(row.score)}
                </span>
              </li>
            ))}
          </ol>
          </>
        )}

      </main>
      <footer className="text-center text-xs text-blue-200/40 py-6">
        Built by Stanley Luong · Clues generated by Claude (Opus 4.8)
      </footer>
    </div>
  );
}
