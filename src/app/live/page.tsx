"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import AuthModal from "@/components/AuthModal";
import { liveCreate, liveJoin } from "@/lib/liveActions";

export default function LiveEntryPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [showAuth, setShowAuth] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const name = user?.displayName ?? "";

  const start = async () => {
    if (!user) return setShowAuth(true);
    setBusy("create");
    setError(null);
    try {
      const { code } = await liveCreate(user, name);
      router.push(`/live/${code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start a game.");
      setBusy(null);
    }
  };

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return setShowAuth(true);
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setBusy("join");
    setError(null);
    try {
      const { code: joined } = await liveJoin(user, trimmed, name);
      router.push(`/live/${joined}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join that game.");
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
          <Link href="/" className="inline-block mt-3 text-gold/80 hover:text-gold underline">
            ← Solo board
          </Link>
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
            <button
              onClick={start}
              disabled={busy !== null}
              className="w-full font-display text-2xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-6 py-4 rounded-lg disabled:opacity-50"
            >
              {busy === "create" ? "Starting…" : "Start a new game"}
            </button>

            <div className="flex items-center gap-3 text-blue-200/40 text-sm">
              <div className="h-px flex-1 bg-board" />
              or join with a code
              <div className="h-px flex-1 bg-board" />
            </div>

            <form onSubmit={join} className="flex gap-3">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="CODE"
                maxLength={6}
                className="flex-1 text-center tracking-[0.3em] font-display text-2xl rounded-lg bg-board border border-blue-300/30 focus:border-gold outline-none px-4 py-3 placeholder:text-blue-200/30 uppercase"
              />
              <button
                type="submit"
                disabled={busy !== null || !code.trim()}
                className="font-display text-xl tracking-wider bg-board hover:bg-board-deep border border-gold/40 text-gold px-6 rounded-lg disabled:opacity-50"
              >
                {busy === "join" ? "…" : "Join"}
              </button>
            </form>

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
