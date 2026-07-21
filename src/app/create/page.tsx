"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import AuthModal from "@/components/AuthModal";

const SUGGESTIONS = ["Potent Potables", "World Capitals", "Rhyme Time", "80s Movies", "The Human Body", "Famous Cats"];

export default function CreateBoardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [cats, setCats] = useState<string[]>(["", "", "", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);

  const setCat = (i: number, v: string) => setCats((c) => c.map((x, j) => (j === i ? v : x)));
  const filled = cats.map((c) => c.trim()).filter(Boolean);

  const generate = async () => {
    if (!user) return setShowAuth(true);
    if (filled.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ categories: cats }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't generate the board.");
      const id = String(data.key).replace(/^custom-/, "");
      router.push(`/custom/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate the board.");
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <main className="flex-1 w-full max-w-lg mx-auto px-4 py-12">
        <header className="text-center mb-8">
          <h1 className="font-display text-4xl md:text-5xl tracking-wider text-gold">Build Your Board</h1>
          <p className="text-blue-200/70 mt-2">
            Name up to 6 categories and Claude writes a full round of clues (plus a Final Jeopardy) on the spot.
          </p>
          <Link href="/play" className="inline-block mt-3 text-gold/80 hover:text-gold underline">
            ← Choose a different board
          </Link>
        </header>

        {busy ? (
          <div className="text-center py-16">
            <div className="inline-block h-10 w-10 border-2 border-gold border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-blue-100 font-display text-xl tracking-wide">Writing your board…</p>
            <p className="text-blue-200/50 text-sm mt-2">Claude is composing 30 clues and a Final. ~20 seconds.</p>
          </div>
        ) : (
          <>
            <div className="space-y-3 mb-6">
              {cats.map((c, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="font-display text-gold/50 w-6 text-right">{i + 1}</span>
                  <input
                    value={c}
                    onChange={(e) => setCat(i, e.target.value)}
                    maxLength={60}
                    placeholder={SUGGESTIONS[i]}
                    className="flex-1 rounded-lg bg-board border border-blue-300/30 focus:border-gold outline-none px-4 py-2.5 placeholder:text-blue-200/30"
                  />
                </div>
              ))}
            </div>

            <button
              onClick={generate}
              disabled={filled.length === 0}
              className="w-full font-display text-2xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-6 py-4 rounded-lg disabled:opacity-50"
            >
              Generate board {filled.length > 0 ? `(${filled.length} categor${filled.length === 1 ? "y" : "ies"})` : ""}
            </button>
            <p className="text-center text-xs text-blue-200/40 mt-3">
              Leave some blank to make a shorter board. You need at least one.
            </p>
            {error && <p className="text-center text-red-300 text-sm mt-3">{error}</p>}
            {!user && !loading && (
              <p className="text-center text-blue-200/50 text-sm mt-3">You&apos;ll be asked to sign in first.</p>
            )}
          </>
        )}
      </main>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} message="Sign in to create a board." />}
    </div>
  );
}
