"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import AuthModal from "@/components/AuthModal";
import BoardLoading from "@/components/BoardLoading";
import { liveSetBoard } from "@/lib/liveActions";

const SUGGESTIONS = [
  "Potent Potables",
  "World Capitals",
  "Rhyme Time",
  "80s Movies",
  "The Human Body",
  "Famous Cats",
  "Ancient History",
  "Broadway Musicals",
  "Elements & Alloys",
  "Sports Legends",
  "Literary Villains",
  "Space & Beyond",
];

// A larger pool the "Shuffle" button samples from — inspiration to fill the
// form with, not a fixed set (the placeholders above are just the defaults
// shown per input slot before anything's typed).
const CATEGORY_POOL = [
  ...SUGGESTIONS,
  "Before & After",
  "State Nicknames",
  "Classic Video Games",
  "Mythology 101",
  "Oscar Winners",
  "Name That Tune",
  "US Presidents",
  "Famous Bridges",
  "Kitchen Science",
  "Animal Kingdom",
  "Word Origins",
  "TV Sitcoms",
  "Olympic Moments",
  "Famous Painters",
  "Geography Grab Bag",
  "Board Games",
  "Inventions",
  "World Currencies",
  "Dinosaurs",
  "Comic Book Heroes",
  "National Parks",
  "Culinary Classics",
  "Famous Rivers",
  "Rock Bands",
  "Shakespeare",
  "Pixar Movies",
  "Deserts of the World",
  "Nobel Prize Winners",
  "Card Games",
  "Famous Speeches",
];

function pickRandom<T>(pool: T[], n: number): T[] {
  const copy = [...pool];
  const picked: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    picked.push(copy.splice(idx, 1)[0]);
  }
  return picked;
}

function CreateBoardPageInner() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Building a board for an existing lobby (came from "Create custom" on
  // /live/{code}) rather than starting a standalone custom board.
  const forGame = searchParams.get("forGame");
  const [rounds, setRounds] = useState<1 | 2>(1);
  const [cats, setCats] = useState<string[]>(Array(12).fill(""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);

  const count = rounds === 2 ? 12 : 6;
  const setCat = (i: number, v: string) => setCats((c) => c.map((x, j) => (j === i ? v : x)));
  const active = cats.slice(0, count);
  const filled = active.map((c) => c.trim()).filter(Boolean);

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
        body: JSON.stringify({ categories: active, rounds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't generate the board.");
      const key = String(data.key);
      if (forGame) {
        await liveSetBoard(user, forGame, key);
        router.push(`/live/${forGame}`);
        return;
      }
      router.push(`/custom/${key.replace(/^custom-/, "")}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate the board.");
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <main className="flex-1 w-full max-w-lg mx-auto px-4 py-12">
        <header className="text-center mb-8">
          <h1 className="font-display text-4xl md:text-5xl tracking-wider text-gold">
            {forGame ? `Build a Board for Game ${forGame}` : "Build Your Board"}
          </h1>
          <p className="text-blue-200/70 mt-2">
            Name your categories and Claude writes the clues (plus a Final Jeopardy!) on the spot.
          </p>
          <Link
            href={forGame ? `/live/${forGame}` : "/play"}
            className="inline-block mt-3 text-gold/80 hover:text-gold underline"
          >
            {forGame ? "← Back to lobby" : "← Choose a different board"}
          </Link>
        </header>

        {busy ? (
          <BoardLoading
            title="Writing your board…"
            detail={
              rounds === 2
                ? "Claude is composing two rounds, 60 clues, and a Final. ~40 seconds."
                : "Claude is composing 30 clues and a Final. ~20 seconds."
            }
          />
        ) : (
          <>
            {/* Round-count selector */}
            <div className="grid grid-cols-2 gap-2 mb-6">
              {([1, 2] as const).map((r) => {
                const on = rounds === r;
                return (
                  <button
                    key={r}
                    onClick={() => setRounds(r)}
                    className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                      on
                        ? "border-gold bg-board-deep/60"
                        : "border-blue-300/20 bg-board/40 hover:border-blue-300/40"
                    }`}
                  >
                    <p className={`font-display text-lg tracking-wide ${on ? "text-gold" : "text-blue-100"}`}>
                      {r === 1 ? "Single round" : "Two rounds"}
                    </p>
                    <p className="text-xs text-blue-200/50 mt-0.5">
                      {r === 1 ? "6 categories · Jeopardy!" : "12 categories · + Double Jeopardy!"}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="flex justify-end mb-2">
              <button
                type="button"
                onClick={() => {
                  const picks = pickRandom(CATEGORY_POOL, count);
                  setCats((prev) => prev.map((_, i) => picks[i] ?? ""));
                }}
                className="text-sm text-gold/70 hover:text-gold underline underline-offset-2"
              >
                🎲 Shuffle category ideas
              </button>
            </div>

            <div className="space-y-3 mb-6">
              {Array.from({ length: count }).map((_, i) => {
                const isRoundBreak = rounds === 2 && (i === 0 || i === 6);
                return (
                  <div key={i}>
                    {isRoundBreak && (
                      <p className="font-display tracking-[0.2em] text-gold/60 text-xs mt-2 mb-2">
                        {i === 0 ? "JEOPARDY! ROUND" : "DOUBLE JEOPARDY! ROUND"}
                      </p>
                    )}
                    <div className="flex items-center gap-3">
                      <span className="font-display text-gold/50 w-6 text-right">{(i % 6) + 1}</span>
                      <input
                        value={cats[i]}
                        onChange={(e) => setCat(i, e.target.value)}
                        maxLength={60}
                        placeholder={SUGGESTIONS[i]}
                        className="flex-1 rounded-lg bg-board border border-blue-300/30 focus:border-gold outline-none px-4 py-2.5 placeholder:text-blue-200/30"
                      />
                    </div>
                  </div>
                );
              })}
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

export default function CreateBoardPage() {
  return (
    <Suspense fallback={null}>
      <CreateBoardPageInner />
    </Suspense>
  );
}
