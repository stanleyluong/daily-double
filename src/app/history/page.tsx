"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import FilterPills from "@/components/FilterPills";
import SkeletonRows from "@/components/SkeletonRows";
import type { MyScoreRow } from "@/lib/scores";
import type { RankedStats } from "@/lib/liveTypes";
import type { GameHistoryRow, GameKind } from "@/lib/gameHistory";
import { computeStreak, formatBoardDate, formatMoney } from "@/lib/format";

const KIND_LABEL: Record<GameKind, string> = {
  daily: "AI daily",
  historical: "Real episode",
  custom: "Custom",
};

type TypeFilter = "all" | GameKind;
const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "daily", label: "AI daily" },
  { value: "historical", label: "Real episode" },
  { value: "custom", label: "Custom" },
];

type ProgressFilter = "all" | "in_progress" | "completed";
const PROGRESS_FILTERS: { value: ProgressFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
];

function boardLabel(row: GameHistoryRow): string {
  return row.liveCode
    ? `Live game ${row.liveCode}`
    : row.boardKey.startsWith("custom-")
      ? "Custom board"
      : formatBoardDate(row.boardKey);
}

type SortKey = "board" | "type" | "players" | "progress" | "created" | "lastPlayed" | "score";

const SORT_COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "board", label: "Board" },
  { key: "type", label: "Type" },
  { key: "players", label: "Players" },
  { key: "progress", label: "Progress" },
  { key: "created", label: "Created" },
  { key: "lastPlayed", label: "Last played" },
  { key: "score", label: "Score", align: "right" },
];

// Dates/score default to newest-or-highest-first on first click; text columns
// default to A→Z — whichever reads as the more useful starting order.
const DEFAULT_DESC: Partial<Record<SortKey, boolean>> = { created: true, lastPlayed: true, score: true };

function sortValue(row: GameHistoryRow, key: SortKey): string | number {
  switch (key) {
    case "board":
      return boardLabel(row);
    case "type":
      return KIND_LABEL[row.kind];
    case "players":
      return row.players.length > 0 ? row.players.join(", ") : "Solo";
    case "progress":
      return row.progress;
    case "created":
      return row.createdAt ?? "";
    case "lastPlayed":
      return row.lastPlayedAt ?? "";
    case "score":
      return row.myScore;
  }
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-board-deep/50 border border-board rounded-lg px-3 py-3 text-center">
      <p className="font-display text-2xl md:text-3xl tracking-wide text-gold tabular-nums">{value}</p>
      <p className="text-[11px] uppercase tracking-wider text-blue-200/50 mt-0.5">{label}</p>
    </div>
  );
}

function formatShort(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function MyScoresPage() {
  const { user, loading } = useAuth();
  const [scores, setScores] = useState<MyScoreRow[] | null>(null);
  const [rank, setRank] = useState<RankedStats | null>(null);
  const [history, setHistory] = useState<GameHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("lastPlayed");
  const [sortDesc, setSortDesc] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>("all");
  const [query, setQuery] = useState("");

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(DEFAULT_DESC[key] ?? false);
    }
  };

  const visibleHistory = useMemo(() => {
    if (!history) return null;
    const q = query.trim().toLowerCase();
    const rows = history.filter((row) => {
      if (typeFilter !== "all" && row.kind !== typeFilter) return false;
      if (progressFilter !== "all" && row.progress !== progressFilter) return false;
      if (q) {
        const haystack = `${boardLabel(row)} ${row.players.join(" ")}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    rows.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sortDesc ? -cmp : cmp;
    });
    return rows;
  }, [history, sortKey, sortDesc, typeFilter, progressFilter, query]);

  useEffect(() => {
    if (!user) return;
    setScores(null);
    setRank(null);
    setHistory(null);
    setError(null);
    user.getIdToken().then((token) => {
      const auth = { Authorization: `Bearer ${token}` };
      fetch("/api/my-game-history", { headers: auth })
        .then((res) => res.json())
        .then((data) => {
          if (data.error) throw new Error(data.error);
          setHistory(data.rows as GameHistoryRow[]);
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load your games."));
      fetch("/api/my-scores", { headers: auth })
        .then((res) => res.json())
        .then((data) => setScores((data.scores as MyScoreRow[]) ?? []))
        .catch(() => setScores([]));
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
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 md:px-8 py-10">
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

        {user && history && history.length > 0 && (
          <div className="flex flex-col gap-3 mb-4">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <FilterPills options={TYPE_FILTERS} value={typeFilter} onChange={setTypeFilter} />
              <span className="text-blue-200/30 mx-1">·</span>
              <FilterPills options={PROGRESS_FILTERS} value={progressFilter} onChange={setProgressFilter} />
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by board or player…"
              className="w-full max-w-sm mx-auto rounded-lg bg-board border border-blue-300/30 focus:border-gold outline-none px-4 py-2 text-sm placeholder:text-blue-200/40"
            />
          </div>
        )}

        {loading ? (
          <p className="text-center text-blue-200/50 py-16">Loading…</p>
        ) : !user ? (
          <p className="text-center text-blue-200/60 py-16">
            Sign in (top right) to track your scores across days.
          </p>
        ) : error ? (
          <p className="text-center text-red-300 py-16">{error}</p>
        ) : history === null ? (
          <SkeletonRows rows={6} cols={7} />
        ) : history.length === 0 ? (
          <p className="text-center text-blue-200/50 py-16">
            No games yet — play today&apos;s board to get started.
          </p>
        ) : visibleHistory && visibleHistory.length === 0 ? (
          <p className="text-center text-blue-200/50 py-16">No games match your filters.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-board">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-board-deep/60">
                  {SORT_COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className={`px-4 py-3 ${col.align === "right" ? "text-right" : "text-left"}`}
                    >
                      <button
                        onClick={() => toggleSort(col.key)}
                        className="font-display tracking-wide text-blue-200/60 hover:text-gold uppercase text-xs transition-colors"
                      >
                        {col.label} {sortKey === col.key && (sortDesc ? "↓" : "↑")}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleHistory!.map((row) => {
                  const label = boardLabel(row);
                  return (
                    <tr key={row.id} className="border-t border-board hover:bg-board-deep/40">
                      <td className="px-4 py-3 align-top">
                        <Link href={row.href} className="text-gold/90 hover:text-gold hover:underline">
                          {label}
                        </Link>
                      </td>
                      <td className="px-4 py-3 align-top text-blue-200/70 whitespace-nowrap">
                        {KIND_LABEL[row.kind]}
                      </td>
                      <td className="px-4 py-3 align-top text-blue-200/70">
                        {row.players.length > 0 ? row.players.join(", ") : "Solo"}
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        <span
                          className={`inline-block text-xs font-display tracking-wide px-2.5 py-1 rounded-full border ${
                            row.progress === "completed"
                              ? "text-gold bg-gold/10 border-gold/40"
                              : "text-blue-100 bg-blue-300/10 border-blue-300/30"
                          }`}
                        >
                          {row.progress === "completed" ? "Completed" : "In progress"}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top text-blue-200/50 whitespace-nowrap">
                        {formatShort(row.createdAt)}
                      </td>
                      <td className="px-4 py-3 align-top text-blue-200/50 whitespace-nowrap">
                        {formatShort(row.lastPlayedAt)}
                      </td>
                      <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                        <span className={`font-display text-lg tracking-wide ${row.myScore < 0 ? "text-red-400" : "text-gold"}`}>
                          {formatMoney(row.myScore)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
      <footer className="text-center text-xs text-blue-200/40 py-6">
        Built by Stanley Luong · Clues generated by Claude (Opus 4.8)
      </footer>
    </div>
  );
}
