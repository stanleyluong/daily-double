"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { BoardSummary } from "@/lib/jeopardy";

function formatDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function BoardsList({ boards, today }: { boards: BoardSummary[]; today: string }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const filtered = useMemo(
    () => (q ? boards.filter((b) => b.categoryTitles.some((c) => c.toLowerCase().includes(q))) : boards),
    [boards, q]
  );

  const highlight = (cat: string) => {
    if (!q) return cat;
    const i = cat.toLowerCase().indexOf(q);
    if (i < 0) return cat;
    return (
      <>
        {cat.slice(0, i)}
        <span className="text-gold bg-gold/15 rounded px-0.5">{cat.slice(i, i + q.length)}</span>
        {cat.slice(i + q.length)}
      </>
    );
  };

  return (
    <>
      <div className="max-w-lg mx-auto mb-6">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search these boards by category…"
          className="w-full rounded-lg bg-board border border-blue-300/30 focus:border-gold outline-none px-4 py-2.5 placeholder:text-blue-200/40"
        />
        {q && (
          <p className="text-center text-sm text-blue-200/50 mt-2">
            {filtered.length} board{filtered.length === 1 ? "" : "s"} with a category matching “{query.trim()}”
          </p>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-blue-200/50 py-16">
          {q ? `No boards with a category matching “${query.trim()}”.` : "No boards yet — play today's game to create the first one."}
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((b) => (
            <li
              key={b.date}
              className="bg-board-deep/60 border border-board hover:border-gold/50 rounded-lg p-4 transition-colors"
            >
              <Link href={b.date === today ? "/" : `/boards/${b.date}`} className="block">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-display text-xl tracking-wide text-gold">
                    {formatDate(b.date)}
                    {b.date === today && (
                      <span className="ml-2 text-xs bg-gold text-board-deep rounded px-1.5 py-0.5 align-middle">
                        TODAY
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-blue-200/60 whitespace-nowrap">
                    {b.topScore ? `Top: ${b.topScore.name} · $${b.topScore.score.toLocaleString()}` : "No scores yet"}
                  </p>
                </div>
                {b.categoryTitles.length > 0 && (
                  <p className="text-sm text-blue-200/50 mt-1">
                    {b.categoryTitles.map((c, i) => (
                      <span key={i}>
                        {i > 0 && " · "}
                        {highlight(c)}
                      </span>
                    ))}
                  </p>
                )}
              </Link>
              <Link
                href={`/boards/${b.date}/scores`}
                className="inline-block mt-2 text-xs text-gold/70 hover:text-gold underline"
              >
                All scores for this date →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
