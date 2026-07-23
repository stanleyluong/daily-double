import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Choose a board — Daily Double",
  description: "Play today's AI board, a real Jeopardy! episode from history, or build your own.",
};

const OPTIONS = [
  {
    href: "/",
    badge: "AI · Daily",
    title: "Today's Board",
    body: "The fresh AI-written board of the day — two rounds, 60 clues, Daily Doubles and a Final. Compete on the daily leaderboard.",
    cta: "Play today",
  },
  {
    href: "/archive",
    badge: "Real history",
    title: "A Real Jeopardy! Episode",
    body: "Browse thousands of actual episodes by date or search by category (cats, opera, rivers…), then play that exact board.",
    cta: "Browse the archive",
  },
  {
    href: "/create",
    badge: "AI · Custom",
    title: "Build Your Own",
    body: "Name up to 6 categories and Claude writes a full round of clues for you on the spot — anything you can dream up.",
    cta: "Create a board",
  },
];

export default function PlayChooserPage() {
  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 md:px-8 py-12">
        <header className="text-center mb-10">
          <h1 className="font-display text-4xl md:text-5xl tracking-wider text-gold">Choose a Board</h1>
          <p className="text-blue-200/70 mt-2">Three ways to play, solo or with friends.</p>
          <Link href="/" className="inline-block mt-3 text-gold/80 hover:text-gold underline">
            ← Back
          </Link>
        </header>

        <div className="grid md:grid-cols-3 gap-4">
          {OPTIONS.map((o) => (
            <Link
              key={o.href}
              href={o.href}
              className="flex flex-col bg-board-deep/60 border border-board hover:border-gold/60 rounded-xl p-6 transition-colors"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-gold/70 mb-3">{o.badge}</span>
              <h2 className="font-display text-2xl tracking-wide text-gold mb-2">{o.title}</h2>
              <p className="text-sm text-blue-200/70 leading-relaxed flex-1">{o.body}</p>
              <span className="mt-5 inline-block font-display tracking-wider text-board-deep bg-gold rounded px-4 py-2 text-center">
                {o.cta} →
              </span>
            </Link>
          ))}
        </div>

        <p className="text-center text-sm text-blue-200/50 mt-8">
          Want to play with friends? Any of these work in{" "}
          <Link href="/live" className="text-gold/80 hover:text-gold underline">
            multiplayer
          </Link>{" "}
          too.
        </p>
      </main>
    </div>
  );
}
