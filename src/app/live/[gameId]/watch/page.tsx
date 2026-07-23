"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { formatMoney } from "@/lib/format";

interface SpectateGame {
  id: string;
  status: string;
  phase: string;
  players: { uid: string; name: string }[];
  scores: Record<string, number>;
  pickerUid: string | null;
  paused: boolean;
  pausedReason: string | null;
  reveal: {
    categoryTitle: string;
    value: number;
    correctAnswer: string;
    results: Record<string, { outcome: string; answer: string | null }>;
  } | null;
}

const PHASE_LABEL: Record<string, string> = {
  lobby: "In the lobby",
  picking: "Choosing a clue",
  active: "Answering a clue",
  reveal: "Revealing the answer",
  final_wager: "Wagering for Final",
  finished: "Game over",
};

export default function WatchPage() {
  const params = useParams<{ gameId: string }>();
  const code = (params.gameId ?? "").toUpperCase();
  const [game, setGame] = useState<SpectateGame | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetch(`/api/live/spectate?code=${encodeURIComponent(code)}`)
        .then((res) => res.json())
        .then((data) => {
          if (cancelled) return;
          if (data.error) setError(data.error);
          else setGame(data.game as SpectateGame);
        })
        .catch(() => {
          if (!cancelled) setError("Couldn't load this game.");
        });
    };
    poll();
    const t = setInterval(poll, 2500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [code]);

  const nameFor = (uid: string) => game?.players.find((p) => p.uid === uid)?.name ?? "Player";
  const ranked = game ? [...game.players].sort((a, b) => (game.scores[b.uid] ?? 0) - (game.scores[a.uid] ?? 0)) : [];

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <main className="flex-1 w-full max-w-lg mx-auto px-4 py-12">
        <header className="text-center mb-8">
          <p className="kicker text-gold font-mono text-xs uppercase tracking-widest mb-2">Spectating</p>
          <h1 className="font-display text-4xl tracking-widest text-gold">{code}</h1>
          <Link href="/live" className="inline-block mt-3 text-gold/80 hover:text-gold underline">
            ← Play with friends
          </Link>
        </header>

        {error ? (
          <p className="text-center text-red-300 py-16">{error}</p>
        ) : !game ? (
          <p className="text-center text-blue-200/50 py-16">Loading…</p>
        ) : (
          <div className="space-y-6">
            <p className="text-center text-blue-200/70">
              {game.paused
                ? game.pausedReason === "disconnect"
                  ? "Paused — a player disconnected"
                  : "Paused"
                : PHASE_LABEL[game.phase] ?? game.phase}
            </p>

            <ol className="divide-y divide-board bg-board-deep/40 border border-board rounded-lg overflow-hidden">
              {ranked.map((p, i) => (
                <li key={p.uid} className="flex items-center gap-3 px-4 py-3">
                  <span className="text-blue-200/50 w-6 text-right">{i + 1}.</span>
                  <span className="flex-1 truncate text-blue-100">
                    {p.uid === game.pickerUid && <span className="mr-1">🎯</span>}
                    {p.name}
                  </span>
                  <span
                    className={`font-display text-xl tracking-wide ${
                      (game.scores[p.uid] ?? 0) < 0 ? "text-red-400" : "text-gold"
                    }`}
                  >
                    {formatMoney(game.scores[p.uid] ?? 0)}
                  </span>
                </li>
              ))}
            </ol>

            {game.reveal && (
              <div className="bg-board rounded-lg p-5 text-center">
                <p className="font-display tracking-wider text-gold uppercase text-sm mb-1">
                  {game.reveal.categoryTitle} · ${game.reveal.value}
                </p>
                <p className="text-blue-200/70 mb-2">
                  Answer: <span className="text-gold">{game.reveal.correctAnswer}</span>
                </p>
                <div className="flex flex-wrap justify-center gap-2 text-sm">
                  {Object.entries(game.reveal.results).map(([puid, r]) => (
                    <span
                      key={puid}
                      className={
                        r.outcome === "correct"
                          ? "text-green-400"
                          : r.outcome === "wrong"
                            ? "text-red-400"
                            : "text-blue-200/40"
                      }
                    >
                      {nameFor(puid)} {r.outcome === "correct" ? "✓" : r.outcome === "wrong" ? "✗" : "–"}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <p className="text-center text-xs text-blue-200/40">
              Read-only view — updates every few seconds.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
