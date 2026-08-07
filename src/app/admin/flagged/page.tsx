"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";

interface Flag {
  id: string;
  boardKey: string;
  clueId: string;
  category: string;
  clue: string;
  correctAnswer: string;
  reason: string;
  resolved: boolean;
  createdAt: string | null;
}

export default function FlaggedCluesPage() {
  const { user, loading: authLoading } = useAuth();
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/admin/flagged", { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 403) {
        setError("Not authorized — this page is for the site owner.");
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't load reports.");
      setFlags(data.flags as Flag[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load reports.");
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading && user) load();
    if (!authLoading && !user) setError("Sign in as the site owner to view reports.");
  }, [authLoading, user, load]);

  const setResolved = async (id: string, resolved: boolean) => {
    if (!user) return;
    setBusy(id);
    try {
      const token = await user.getIdToken();
      await fetch("/api/admin/flagged", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, resolved }),
      });
      setFlags((fs) => (fs ? fs.map((f) => (f.id === id ? { ...f, resolved } : f)) : fs));
    } catch {
      // ignore; leave state as-is
    } finally {
      setBusy(null);
    }
  };

  const visible = (flags ?? []).filter((f) => (showResolved ? true : !f.resolved));
  const openCount = (flags ?? []).filter((f) => !f.resolved).length;

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 md:px-8 py-10">
        <header className="mb-6">
          <h1 className="font-display text-3xl md:text-4xl tracking-wider text-gold">Flagged Clues</h1>
          <p className="text-blue-200/70 mt-1 text-sm">
            Player-reported clues. {openCount} open{flags ? ` · ${flags.length} total` : ""}.
          </p>
          <label className="mt-3 inline-flex items-center gap-2 text-sm text-blue-200/70">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            Show resolved
          </label>
        </header>

        {error && <p className="text-red-300 text-sm">{error}</p>}
        {!error && flags === null && <p className="text-blue-200/70 animate-pulse">Loading…</p>}
        {!error && flags !== null && visible.length === 0 && (
          <p className="text-blue-200/60 py-10 text-center">No {showResolved ? "" : "open "}reports. 🎉</p>
        )}

        <ul className="space-y-3">
          {visible.map((f) => (
            <li
              key={f.id}
              className={`rounded-lg border p-4 ${
                f.resolved ? "border-board bg-board-deep/30 opacity-60" : "border-blue-300/20 bg-board-deep/50"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display tracking-wide text-gold text-sm">
                    {f.category || "(no category)"}
                  </p>
                  <p className="text-blue-100/90 mt-1">{f.clue || "(clue text unavailable)"}</p>
                  <p className="text-sm text-blue-200/70 mt-1">
                    Answer: <span className="text-gold">{f.correctAnswer || "—"}</span>
                  </p>
                  {f.reason && <p className="text-sm text-blue-200/70 mt-1 italic">“{f.reason}”</p>}
                  <p className="text-[11px] text-blue-200/50 mt-2">
                    <Link href={`/boards/${f.boardKey}`} className="text-gold/70 hover:text-gold underline">
                      {f.boardKey}
                    </Link>{" "}
                    · clue {f.clueId}
                    {f.createdAt ? ` · ${new Date(f.createdAt).toLocaleString()}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => setResolved(f.id, !f.resolved)}
                  disabled={busy === f.id}
                  className={`shrink-0 font-display tracking-wide text-sm px-3 py-1.5 rounded disabled:opacity-50 ${
                    f.resolved
                      ? "border border-blue-300/30 text-blue-200/70 hover:text-blue-100"
                      : "bg-gold hover:bg-gold-soft text-board-deep"
                  }`}
                >
                  {f.resolved ? "Reopen" : "Resolve"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
