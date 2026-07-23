import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Keyboard Shortcuts — Daily Double",
  description: "Play the whole board from the keyboard: navigate, open, answer, and review.",
};

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[2rem] px-2 py-1 rounded-md border border-[color:var(--hairline-strong)] bg-shell-panel text-gold text-sm font-mono shadow-sm">
      {children}
    </kbd>
  );
}

function Row({ keys, desc }: { keys: React.ReactNode; desc: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-board last:border-0">
      <div className="flex items-center gap-1.5 flex-wrap shrink-0">{keys}</div>
      <p className="text-blue-100/80 text-right">{desc}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-2xl tracking-wide text-gold mb-1">{title}</h2>
      <div className="bg-board-deep/40 border border-board rounded-lg px-4 md:px-5">{children}</div>
    </section>
  );
}

export default function ShortcutsPage() {
  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <main className="flex-1 w-full max-w-2xl mx-auto px-6 py-12">
        <header className="mb-8 text-center">
          <h1 className="font-display text-4xl md:text-5xl tracking-wider text-gold">Keyboard Shortcuts</h1>
          <p className="text-blue-200/70 mt-2">Play the whole board without the mouse.</p>
          <Link href="/" className="inline-block mt-4 text-gold/80 hover:text-gold underline">
            ← Back to Daily Double
          </Link>
        </header>

        <div className="space-y-8">
          <Section title="Around the board">
            <Row keys={<Kbd>Tab</Kbd>} desc="Move focus onto the board" />
            <Row
              keys={
                <>
                  <Kbd>↑</Kbd>
                  <Kbd>↓</Kbd>
                  <Kbd>←</Kbd>
                  <Kbd>→</Kbd>
                </>
              }
              desc="Move between clues, one cell at a time (answered clues included)"
            />
            <Row
              keys={
                <>
                  <Kbd>Enter</Kbd>
                  <span className="text-blue-200/40 text-sm">or</span>
                  <Kbd>Space</Kbd>
                </>
              }
              desc="Open the focused clue — or review it if it's already answered"
            />
          </Section>

          <Section title="While answering">
            <Row keys={<Kbd>Enter</Kbd>} desc="Submit your answer" />
            <Row
              keys={
                <>
                  <Kbd>Esc</Kbd>
                  <Kbd>Esc</Kbd>
                </>
              }
              desc="No idea — reveal the answer (press Esc twice)"
            />
          </Section>

          <Section title="After a ruling / while reviewing">
            <Row
              keys={
                <>
                  <Kbd>Enter</Kbd>
                  <span className="text-blue-200/40 text-sm">or</span>
                  <Kbd>Esc</Kbd>
                </>
              }
              desc="Close and go back to the board"
            />
          </Section>

          <p className="text-xs text-blue-200/40 text-center pt-2">
            Arrow-key navigation is for the desktop board grid. On phones, tap a clue to open or review it.
          </p>
        </div>
      </main>
    </div>
  );
}
