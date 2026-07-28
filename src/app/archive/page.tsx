"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { ArchiveKindFilter, HistoricalSummary } from "@/lib/historical";
import { useAuth } from "@/components/AuthProvider";
import AuthModal from "@/components/AuthModal";
import FilterPills from "@/components/FilterPills";
import SkeletonRows from "@/components/SkeletonRows";
import { liveCreate, liveSetBoard } from "@/lib/liveActions";

const KIND_FILTERS: { value: ArchiveKindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "historical", label: "Real episodes" },
  { value: "daily", label: "AI daily" },
  { value: "custom", label: "Custom" },
];

const KIND_BADGE: Record<HistoricalSummary["kind"], string> = {
  historical: "Real episode",
  daily: "AI daily",
  custom: "Custom",
};

// date is YYYY-MM-DD for daily/historical (or hist-YYYY-MM-DD for a
// collision-safe historical key — .slice(-10) strips that prefix, a no-op
// otherwise); custom boards use `custom-{id}` there instead, so sort those
// by createdAt.
function archiveSortKey(row: HistoricalSummary): string {
  return row.kind === "custom" ? (row.createdAt ?? "") : row.date.slice(-10);
}

const PAGE_SIZE = 150;

type BoardStatus = "completed" | "in_progress" | "new";

const STATUS_LABEL: Record<BoardStatus, string> = {
  completed: "Completed",
  in_progress: "In progress",
  new: "New",
};

type StatusFilter = "all" | BoardStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
];

const STATUS_CLASS: Record<BoardStatus, string> = {
  completed: "text-gold bg-gold/10 border-gold/40",
  in_progress: "text-blue-100 bg-blue-300/10 border-blue-300/30",
  new: "text-blue-200/60 bg-transparent border-blue-300/15",
};

function formatDate(date: string): string {
  // Strips an optional "hist-" collision-safe prefix (see archiveSortKey) —
  // the real calendar date is always the trailing 10 characters.
  const real = date.slice(-10);
  return new Date(`${real}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function ArchivePageInner() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Picking a board for an existing lobby (came from "Browse Archive" on
  // /live/{code}) rather than browsing to start a fresh game.
  const forGame = searchParams.get("forGame");
  // Picking a board to run in classroom host mode (came from /host) — the row
  // action routes to /host/{key} instead of creating a live lobby.
  const hostMode = searchParams.get("host") === "1";
  // Filter state initializes from (and writes back to) the URL, so a filtered
  // view survives refresh and can be shared/bookmarked (/archive?kind=custom).
  const urlKind = searchParams.get("kind");
  const initialKind: ArchiveKindFilter =
    urlKind === "daily" || urlKind === "historical" || urlKind === "custom" ? urlKind : "all";
  const initialQuery = searchParams.get("q") ?? "";
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const urlDateFrom = searchParams.get("dateFrom");
  const urlDateTo = searchParams.get("dateTo");
  const initialDateFrom = urlDateFrom && DATE_RE.test(urlDateFrom) ? urlDateFrom : "";
  const initialDateTo = urlDateTo && DATE_RE.test(urlDateTo) ? urlDateTo : "";
  const [rows, setRows] = useState<HistoricalSummary[] | null>(null);
  const [total, setTotal] = useState(0); // total matches across all pages, not just this page's rows
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(initialQuery); // the query actually applied
  const [kind, setKind] = useState<ArchiveKindFilter>(initialKind);
  const [dateFrom, setDateFrom] = useState(initialDateFrom);
  const [dateTo, setDateTo] = useState(initialDateTo);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all"); // client-side only — see below
  const [asc, setAsc] = useState(false); // date sort direction; false = newest first
  const [loading, setLoading] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [started, setStarted] = useState<Set<string> | null>(null);
  const [completed, setCompleted] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (!user) {
      setStarted(null);
      setCompleted(null);
      return;
    }
    user.getIdToken().then((token) => {
      fetch("/api/my-board-status", { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => res.json())
        .then((data) => {
          setStarted(new Set((data.started as string[]) ?? []));
          setCompleted(new Set((data.completed as string[]) ?? []));
        })
        .catch(() => {
          setStarted(new Set());
          setCompleted(new Set());
        });
    });
  }, [user]);

  const statusOf = (date: string): BoardStatus | null => {
    if (!completed || !started) return null; // signed out, or not loaded yet
    if (completed.has(date)) return "completed";
    if (started.has(date)) return "in_progress";
    return "new";
  };

  // Every board opens into a pregame lobby (settings, chat, invite) rather
  // than jumping straight into solo play — even playing alone just means
  // starting the lobby without inviting anyone. In picking mode (came from
  // an existing lobby's "Browse Archive"), swap that lobby's board instead
  // of creating a brand new game.
  const playBoard = async (date: string) => {
    if (!user) return setShowAuth(true);
    if (hostMode) {
      router.push(`/host/${date}`);
      return;
    }
    setStarting(date);
    setPickError(null);
    try {
      if (forGame) {
        await liveSetBoard(user, forGame, date);
        router.push(`/live/${forGame}`);
        return;
      }
      const { code } = await liveCreate(user, user.displayName ?? "", "normal", date);
      router.push(`/live/${code}`);
    } catch (e) {
      setStarting(null);
      setPickError(e instanceof Error ? e.message : "Couldn't set that board.");
    }
  };

  // Pick a random real episode the player hasn't done yet (server-side, across
  // all ~9,000 — not just the loaded page) and drop straight into it.
  const [surprising, setSurprising] = useState(false);
  const surpriseMe = async () => {
    if (!user) return setShowAuth(true);
    setSurprising(true);
    setPickError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/surprise-board", { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok || !data.key) throw new Error(data.error ?? "Couldn't pick a board.");
      await playBoard(data.key as string);
    } catch (e) {
      setPickError(e instanceof Error ? e.message : "Couldn't pick a board.");
    } finally {
      setSurprising(false);
    }
  };

  interface Filters {
    q: string;
    k: ArchiveKindFilter;
    dateFrom: string;
    dateTo: string;
  }

  // `off` defaults to 0 (a new search/filter always restarts at page one) —
  // callers only pass a nonzero offset when paging forward/back within the
  // current search.
  const load = useCallback(async (f: Filters, off = 0) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (f.q) params.set("q", f.q);
      if (f.k !== "all") params.set("kind", f.k);
      if (f.dateFrom) params.set("dateFrom", f.dateFrom);
      if (f.dateTo) params.set("dateTo", f.dateTo);
      if (off) params.set("offset", String(off));
      const qs = params.toString();
      const res = await fetch(`/api/historical${qs ? `?${qs}` : ""}`);
      const data = await res.json();
      setRows((data.boards as HistoricalSummary[]) ?? []);
      setTotal((data.total as number | undefined) ?? 0);
      setOffset(off);
      setActive(f.q);
    } catch {
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load({ q: initialQuery.trim(), k: initialKind, dateFrom: initialDateFrom, dateTo: initialDateTo });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect the applied filters back into the URL (replace, not push — the
  // back button shouldn't step through every filter click).
  const syncUrl = useCallback(
    (f: Filters) => {
      const params = new URLSearchParams();
      if (forGame) params.set("forGame", forGame);
      if (f.k !== "all") params.set("kind", f.k);
      if (f.q) params.set("q", f.q);
      if (f.dateFrom) params.set("dateFrom", f.dateFrom);
      if (f.dateTo) params.set("dateTo", f.dateTo);
      const qs = params.toString();
      router.replace(`/archive${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [forGame, router]
  );

  const changeKind = (k: ArchiveKindFilter) => {
    setKind(k);
    const f = { q: query.trim(), k, dateFrom, dateTo };
    syncUrl(f);
    load(f);
  };

  const applyDateRange = (nextFrom: string, nextTo: string) => {
    setDateFrom(nextFrom);
    setDateTo(nextTo);
    const f = { q: query.trim(), k: kind, dateFrom: nextFrom, dateTo: nextTo };
    syncUrl(f);
    load(f);
  };

  const sorted = useMemo(
    () =>
      rows
        ? [...rows].sort((a, b) => {
            const ka = archiveSortKey(a);
            const kb = archiveSortKey(b);
            return asc ? (ka < kb ? -1 : 1) : ka < kb ? 1 : -1;
          })
        : null,
    [rows, asc]
  );

  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  // Status is per-account data the search API never sees, so this filters
  // only the rows already on this page — not a true cross-page filter. The
  // "N match on this page" note below makes that scope explicit.
  const visible = useMemo(() => {
    if (!sorted || statusFilter === "all" || !user || !completed || !started) return sorted;
    return sorted.filter((b) => {
      if (statusFilter === "completed") return completed.has(b.date);
      if (statusFilter === "in_progress") return started.has(b.date) && !completed.has(b.date);
      return !started.has(b.date) && !completed.has(b.date); // "new"
    });
  }, [sorted, statusFilter, user, started, completed]);

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
          <h1 className="font-display text-4xl md:text-5xl tracking-wider text-gold">
            {forGame
              ? `Choose a Board for Game ${forGame}`
              : hostMode
                ? "Choose a Board to Host"
                : "Jeopardy! Archive"}
          </h1>
          <p className="text-blue-200/70 mt-2 max-w-xl mx-auto">
            {forGame ? (
              "Pick any real episode, AI daily board, or custom board — your lobby will use it instead of the random pick."
            ) : hostMode ? (
              "Pick any real episode, AI daily board, or custom board to run for your class or group."
            ) : (
              <>
                Real episodes from the show&apos;s history, every AI-generated daily board, and custom boards other
                players have built. Search by category — like <span className="text-gold">cats</span> or{" "}
                <span className="text-gold">opera</span> — and play any board.
              </>
            )}
          </p>
          <Link
            href={forGame ? `/live/${forGame}` : hostMode ? "/host" : "/"}
            className="inline-block mt-3 text-gold/80 hover:text-gold underline"
          >
            {forGame ? "← Back to lobby" : hostMode ? "← Back to host setup" : "← Today's board"}
          </Link>
          {!forGame && (
            <div className="mt-5">
              <button
                onClick={surpriseMe}
                disabled={surprising || starting !== null}
                className="font-display text-lg tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-6 py-2.5 rounded disabled:opacity-50"
              >
                {surprising ? "Finding a board…" : "🎲 Surprise me"}
              </button>
              <p className="text-xs text-blue-200/60 mt-2">
                {hostMode
                  ? "Hosts a random real episode you haven't played."
                  : "Drops you into a random real episode you haven't played."}
              </p>
            </div>
          )}
        </header>
        {pickError && <p className="text-center text-red-300 text-sm mb-4">{pickError}</p>}

        <div className="mb-4">
          <FilterPills options={KIND_FILTERS} value={kind} onChange={changeKind} />
        </div>

        {user && (
          <div className="mb-4">
            <FilterPills options={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2 mb-6 text-sm">
          <label className="text-blue-200/60" htmlFor="archive-date-from">
            From
          </label>
          <input
            id="archive-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => applyDateRange(e.target.value, dateTo)}
            className="rounded-lg bg-board border border-blue-300/30 focus:border-gold outline-none px-3 py-1.5"
          />
          <label className="text-blue-200/60" htmlFor="archive-date-to">
            to
          </label>
          <input
            id="archive-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => applyDateRange(dateFrom, e.target.value)}
            className="rounded-lg bg-board border border-blue-300/30 focus:border-gold outline-none px-3 py-1.5"
          />
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => applyDateRange("", "")}
              className="text-blue-200/60 hover:text-blue-100 px-2"
            >
              Clear dates
            </button>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = { q: query.trim(), k: kind, dateFrom, dateTo };
            syncUrl(f);
            load(f);
          }}
          className="flex gap-3 max-w-lg mx-auto mb-6"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search categories (e.g. cats, rivers, opera)…"
            className="flex-1 rounded-lg bg-board border border-blue-300/30 focus:border-gold outline-none px-4 py-2.5 placeholder:text-blue-200/60"
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
                const f = { q: "", k: kind, dateFrom, dateTo };
                syncUrl(f);
                load(f);
              }}
              className="text-blue-200/60 hover:text-blue-100 text-sm px-2"
            >
              Clear
            </button>
          )}
        </form>

        <p className="text-center text-sm text-blue-200/60 mb-4">
          {loading
            ? "Searching…"
            : rows === null
              ? ""
              : `${total} board${total === 1 ? "" : "s"}${active ? ` with a category matching “${active}”` : ""}${
                  total > PAGE_SIZE ? ` — showing ${offset + 1}–${offset + sorted!.length}` : ""
                }${
                  statusFilter !== "all" && user
                    ? ` (${visible?.length ?? 0} “${STATUS_LABEL[statusFilter]}” on this page)`
                    : ""
                }`}
        </p>

        {rows === null ? (
          <SkeletonRows rows={8} cols={4} />
        ) : (
          visible &&
          visible.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-board">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-board-deep/60">
                  <th className="text-left px-4 py-3" aria-sort={asc ? "ascending" : "descending"}>
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
                  <th className="text-left px-4 py-3 font-display tracking-wide text-blue-200/60 uppercase text-xs">
                    Status
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {visible.map((b) => {
                  const status = statusOf(b.date);
                  return (
                    <tr key={b.date} className="border-t border-board hover:bg-board-deep/40">
                      <td className="px-4 py-3 whitespace-nowrap align-top">
                        <span className="text-blue-100">
                          {b.kind === "custom" && b.createdAt ? formatDate(b.createdAt.slice(0, 10)) : formatDate(b.date)}
                        </span>
                        <span
                          className={`block text-xs mt-0.5 ${
                            b.kind === "daily" ? "text-gold/70" : b.kind === "custom" ? "text-blue-200/60" : "text-blue-200/60"
                          }`}
                        >
                          {b.kind === "historical"
                            ? `#${b.showNumber} · ${KIND_BADGE.historical}`
                            : b.kind === "custom" && b.name
                              ? `${b.name} · ${KIND_BADGE.custom}`
                              : KIND_BADGE[b.kind]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-blue-200/80 leading-relaxed">
                        {b.categoryTitles.map((c, i) => (
                          <span key={i}>
                            {i > 0 && <span className="text-blue-200/60"> · </span>}
                            {highlight(c)}
                          </span>
                        ))}
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        {status ? (
                          <span
                            className={`inline-block text-xs font-display tracking-wide px-2.5 py-1 rounded-full border ${STATUS_CLASS[status]}`}
                          >
                            {STATUS_LABEL[status]}
                          </span>
                        ) : (
                          <span className="text-xs text-blue-200/60">Sign in to track</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <button
                          onClick={() => playBoard(b.date)}
                          disabled={starting !== null}
                          className="inline-block text-center font-display tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-4 py-1.5 rounded whitespace-nowrap disabled:opacity-50"
                        >
                          {starting === b.date ? "…" : forGame ? "Select" : hostMode ? "Host" : "Play"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )
        )}

        {rows !== null && total > PAGE_SIZE && (
          <div className="flex items-center justify-center gap-4 mt-6">
            <button
              onClick={() => load({ q: active, k: kind, dateFrom, dateTo }, Math.max(0, offset - PAGE_SIZE))}
              disabled={!hasPrev || loading}
              className="font-display tracking-wider text-sm bg-board-deep border border-blue-300/20 hover:border-gold/50 text-blue-100 px-4 py-2 rounded disabled:opacity-40 disabled:hover:border-blue-300/20"
            >
              ← Previous
            </button>
            <span className="text-xs text-blue-200/60">
              Page {Math.floor(offset / PAGE_SIZE) + 1} of {Math.ceil(total / PAGE_SIZE)}
            </span>
            <button
              onClick={() => load({ q: active, k: kind, dateFrom, dateTo }, offset + PAGE_SIZE)}
              disabled={!hasNext || loading}
              className="font-display tracking-wider text-sm bg-board-deep border border-blue-300/20 hover:border-gold/50 text-blue-100 px-4 py-2 rounded disabled:opacity-40 disabled:hover:border-blue-300/20"
            >
              Next →
            </button>
          </div>
        )}

        {rows !== null && sorted && sorted.length === 0 && !loading && (
          <p className="text-center text-blue-200/60 py-16">
            {active ? `No boards found with a category matching “${active}”.` : "No boards found."}
          </p>
        )}

        {rows !== null && sorted && sorted.length > 0 && visible && visible.length === 0 && !loading && (
          <p className="text-center text-blue-200/60 py-16">
            No boards on this page match “{STATUS_LABEL[statusFilter as BoardStatus]}”.{" "}
            {hasNext || hasPrev ? "Try another page, or " : ""}
            <button onClick={() => setStatusFilter("all")} className="text-gold underline">
              clear the status filter
            </button>
            .
          </p>
        )}
      </main>
      <footer className="text-center text-xs text-blue-200/60 py-6">
        Built by Stanley Luong · Historical clues via the J! Archive · Not affiliated with Jeopardy!
      </footer>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} message="Sign in to play." />}
    </div>
  );
}

export default function ArchivePage() {
  return (
    <Suspense fallback={null}>
      <ArchivePageInner />
    </Suspense>
  );
}
