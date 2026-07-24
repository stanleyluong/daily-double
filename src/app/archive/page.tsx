"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ArchiveKindFilter, HistoricalSummary } from "@/lib/historical";
import { useAuth } from "@/components/AuthProvider";
import AuthModal from "@/components/AuthModal";
import { liveCreate } from "@/lib/liveActions";

const KIND_FILTERS: { value: ArchiveKindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "historical", label: "Real episodes" },
  { value: "daily", label: "AI daily" },
];

const KIND_BADGE: Record<HistoricalSummary["kind"], string> = {
  historical: "Real episode",
  daily: "AI daily",
};

function formatDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ArchivePage() {
  const { user } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<HistoricalSummary[] | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(""); // the query actually applied
  const [kind, setKind] = useState<ArchiveKindFilter>("all");
  const [asc, setAsc] = useState(false); // date sort direction; false = newest first
  const [loading, setLoading] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);

  const playWithFriends = async (date: string) => {
    if (!user) return setShowAuth(true);
    setStarting(date);
    try {
      const { code } = await liveCreate(user, user.displayName ?? "", "normal", date);
      router.push(`/live/${code}`);
    } catch {
      setStarting(null);
    }
  };

  const load = useCallback(async (q: string, k: ArchiveKindFilter) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (k !== "all") params.set("kind", k);
      const qs = params.toString();
      const res = await fetch(`/api/historical${qs ? `?${qs}` : ""}`);
      const data = await res.json();
      setRows((data.boards as HistoricalSummary[]) ?? []);
      setActive(q);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load("", "all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeKind = (k: ArchiveKindFilter) => {
    setKind(k);
    load(query.trim(), k);
  };

  const sorted = rows ? [...rows].sort((a, b) => (asc ? (a.date < b.date ? -1 : 1) : a.date < b.date ? 1 : -1)) : null;

  const highlight = (cat: string) => {
    if (!active) return cat;
    const i = cat.toLowerCase().indexOf(active.toLowerCase());
    if (i < 0) return cat;
    return (
      <>
        {cat.slice(0, i)}
        <span className="text-gold bg-gold/15 rounded px-0.5">{cat.slice(i, i + active.length)}</span>
        {cat.slice(i + active.length)}
      </>
    );
  };

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 md:px-8 py-10">
        <header className="text-center mb-8">
          <h1 className="font-display text-4xl md:text-5xl tracking-wider text-gold">Jeopardy! Archive</h1>
          <p className="text-blue-200/70 mt-2 max-w-xl mx-auto">
            Real episodes from the show&apos;s history, plus every AI-generated daily board. Search by category —
            like <span className="text-gold">cats</span> or <span className="text-gold">opera</span> — and play any
            board from that date.
          </p>
          <Link href="/" className="inline-block mt-3 text-gold/80 hover:text-gold underline">
            ← Today&apos;s board
          </Link>
        </header>

        <div className="flex justify-center gap-2 mb-4">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => changeKind(f.value)}
              className={`font-display text-sm tracking-wide px-4 py-1.5 rounded-full border transition-colors ${
                kind === f.value
                  ? "bg-gold text-board-deep border-gold"
                  : "border-blue-300/30 text-blue-200/70 hover:text-blue-100 hover:border-blue-300/50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            load(query.trim(), kind);
          }}
          className="flex gap-3 max-w-lg mx-auto mb-6"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search categories (e.g. cats, rivers, opera)…"
            className="flex-1 rounded-lg bg-board border border-blue-300/30 focus:border-gold outline-none px-4 py-2.5 placeholder:text-blue-200/40"
          />
          <button
            type="submit"
            className="font-display text-lg tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-5 rounded-lg"
          >
            Search
          </button>
          {active && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                load("", kind);
              }}
              className="text-blue-200/60 hover:text-blue-100 text-sm px-2"
            >
              Clear
            </button>
          )}
        </form>

        <p className="text-center text-sm text-blue-200/50 mb-4">
          {loading
            ? "Searching…"
            : rows === null
              ? ""
              : active
                ? `${sorted!.length} board${sorted!.length === 1 ? "" : "s"} with a category matching “${active}”`
                : `${sorted!.length} most recent board${sorted!.length === 1 ? "" : "s"}`}
        </p>

        {sorted && sorted.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-board">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-board-deep/60">
                  <th className="text-left px-4 py-3">
                    <button
                      onClick={() => setAsc((v) => !v)}
                      className="font-display tracking-wide text-gold uppercase text-xs hover:opacity-80"
                    >
                      Date {asc ? "↑" : "↓"}
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 font-display tracking-wide text-blue-200/60 uppercase text-xs">
                    Categories
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((b) => (
                  <tr key={b.date} className="border-t border-board hover:bg-board-deep/40">
                    <td className="px-4 py-3 whitespace-nowrap align-top">
                      <span className="text-blue-100">{formatDate(b.date)}</span>
                      <span
                        className={`block text-xs mt-0.5 ${
                          b.kind === "daily" ? "text-gold/70" : "text-blue-200/40"
                        }`}
                      >
                        {b.kind === "historical" ? `#${b.showNumber} · ${KIND_BADGE.historical}` : KIND_BADGE.daily}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-blue-200/80 leading-relaxed">
                      {b.categoryTitles.map((c, i) => (
                        <span key={i}>
                          {i > 0 && <span className="text-blue-200/30"> · </span>}
                          {highlight(c)}
                        </span>
                      ))}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-col gap-1.5 items-stretch">
                        <Link
                          href={`/boards/${b.date}`}
                          className="inline-block text-center font-display tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-4 py-1.5 rounded whitespace-nowrap"
                        >
                          Play
                        </Link>
                        <button
                          onClick={() => playWithFriends(b.date)}
                          disabled={starting !== null}
                          className="text-center font-display tracking-wider border border-gold/40 text-gold hover:bg-board px-4 py-1.5 rounded whitespace-nowrap text-sm disabled:opacity-50"
                        >
                          {starting === b.date ? "…" : "+ Friends"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {sorted && sorted.length === 0 && !loading && (
          <p className="text-center text-blue-200/50 py-16">
            {active ? `No boards found with a category matching “${active}”.` : "No boards found."}
          </p>
        )}
      </main>
      <footer className="text-center text-xs text-blue-200/40 py-6">
        Built by Stanley Luong · Historical clues via the J! Archive · Not affiliated with Jeopardy!
      </footer>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} message="Sign in to play with friends." />}
    </div>
  );
}
