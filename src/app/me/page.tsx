"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import type { MyScoreRow } from "@/lib/scores";
import type { PlayedRow } from "@/lib/played";
import { formatBoardDate, formatDuration, formatMoney } from "@/lib/format";

const KIND_LABEL: Record<PlayedRow["kind"], string> = {
  daily: "AI daily",
  historical: "Real episode",
  custom: "Custom",
};

export default function MyScoresPage() {
  const { user, loading } = useAuth();
  const [scores, setScores] = useState<MyScoreRow[] | null>(null);
  const [played, setPlayed] = useState<PlayedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setScores(null);
    setPlayed(null);
    setError(null);
    user.getIdToken().then((token) => {
      const auth = { Authorization: `Bearer ${token}` };
      fetch("/api/my-scores", { headers: auth })
        .then((res) => res.json())
        .then((data) => {
          if (data.error) throw new Error(data.error);
          setScores(data.scores as MyScoreRow[]);
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load your scores."));
      fetch("/api/my-played", { headers: auth })
        .then((res) => res.json())
        .then((data) => setPlayed((data.played as PlayedRow[]) ?? []))
        .catch(() => setPlayed([]));
    });
  }, [user]);

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
        )}

        {/* Played history */}
        {user && played && played.length > 0 && (
          <section className="mt-10">
            <h2 className="font-display text-2xl tracking-wide text-gold mb-3">Boards you&apos;ve played</h2>
            <ul className="divide-y divide-board bg-board-deep/40 border border-board rounded-lg overflow-hidden">
              {played.slice(0, 40).map((row) => {
                const label = row.boardKey.startsWith("custom-") ? "Custom board" : formatBoardDate(row.boardKey);
                const href = row.boardKey.startsWith("custom-")
                  ? `/custom/${row.boardKey.slice(7)}`
                  : `/boards/${row.boardKey}`;
                return (
                  <li key={row.boardKey} className="flex items-center gap-3 px-4 py-2.5">
                    <Link href={href} className="flex-1 min-w-0 text-blue-100 hover:text-gold hover:underline truncate">
                      {label}
                    </Link>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-blue-200/40">
                      {KIND_LABEL[row.kind]}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>
      <footer className="text-center text-xs text-blue-200/40 py-6">
        Built by Stanley Luong · Clues generated by Claude (Opus 4.8)
      </footer>
    </div>
  );
}
