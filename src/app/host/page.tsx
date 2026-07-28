import type { Metadata } from "next";
import Link from "next/link";
import { todayKey } from "@/lib/jeopardy";

export const metadata: Metadata = {
  title: "Host on a screen — Daily Double",
  description: "Run a Jeopardy!-style game for a classroom or group off one screen — teams, manual scoring, projector-ready.",
};

export default function HostChooserPage() {
  const today = todayKey();
  const options = [
    {
      href: `/host/${today}`,
      badge: "AI · Daily",
      title: "Today's Board",
      body: "Host the fresh AI-written board of the day — two rounds, Daily Doubles, and a Final.",
      cta: "Host today",
    },
    {
      href: "/archive?host=1",
      badge: "Real history",
      title: "A Real Jeopardy! Episode",
      body: "Pick any of thousands of actual episodes by date or category, then run it for the room.",
      cta: "Browse the archive",
    },
    {
      href: "/create",
      badge: "AI · Custom",
      title: "Build Your Own",
      body: "Name your categories, let Claude write the clues, then host that board.",
      cta: "Create a board",
    },
  ];
  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 md:px-8 py-12">
        <header className="text-center mb-4">
          <h1 className="font-display text-4xl md:text-5xl tracking-wider text-gold">Host on a Screen</h1>
          <p className="text-blue-200/70 mt-2 max-w-xl mx-auto">
            Run a game for a classroom or group off one screen — put it on a projector, split the room into up to 3
            teams, read the clues aloud, and keep score. No student sign-ins.
          </p>
          <Link href="/play" className="inline-block mt-3 text-gold/80 hover:text-gold underline">
            ← Back
          </Link>
        </header>

        <p className="text-center text-sm text-blue-200/60 mb-8">Pick a board to host:</p>

        <div className="grid md:grid-cols-3 gap-4">
          {options.map((o) => (
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
      </main>
    </div>
  );
}
