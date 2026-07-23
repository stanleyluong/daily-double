"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readAutoAdvance, writeAutoAdvance, type AutoAdvance } from "@/lib/prefs";

const OPTIONS: { value: AutoAdvance; label: string; desc: string }[] = [
  {
    value: "off",
    label: "Off",
    desc: "After answering, stay on the clue you just played.",
  },
  {
    value: "value",
    label: "Next clue of the same value",
    desc: "Jump to the next unanswered clue in the same row (same dollar amount).",
  },
  {
    value: "category",
    label: "Next clue in the same category",
    desc: "Jump to the next unanswered clue in the same column (same category).",
  },
];

export default function SettingsPage() {
  const [autoAdvance, setAutoAdvance] = useState<AutoAdvance>("off");
  const [saved, setSaved] = useState(false);

  useEffect(() => setAutoAdvance(readAutoAdvance()), []);

  const choose = (v: AutoAdvance) => {
    setAutoAdvance(v);
    writeAutoAdvance(v);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <main className="flex-1 w-full max-w-2xl mx-auto px-6 py-12">
        <header className="mb-8">
          <h1 className="font-display text-4xl md:text-5xl tracking-wider text-gold">Settings</h1>
          <p className="text-blue-200/60 mt-2 text-sm">Saved on this device.</p>
          <Link href="/" className="inline-block mt-3 text-gold/80 hover:text-gold underline">
            ← Back to the board
          </Link>
        </header>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl tracking-wide text-gold">After answering a clue</h2>
            <span
              className={`text-xs text-green-400 transition-opacity ${saved ? "opacity-100" : "opacity-0"}`}
            >
              Saved ✓
            </span>
          </div>
          <p className="text-blue-100/70 text-sm">
            Choose where the board sends you when you return from a clue (keyboard navigation).
          </p>

          <div className="space-y-2">
            {OPTIONS.map((o) => {
              const on = autoAdvance === o.value;
              return (
                <button
                  key={o.value}
                  onClick={() => choose(o.value)}
                  className={`w-full text-left flex items-start gap-3 rounded-lg border px-4 py-3 transition-colors ${
                    on ? "border-gold bg-board-deep/60" : "border-board bg-board-deep/30 hover:border-blue-300/40"
                  }`}
                >
                  <span
                    className={`mt-0.5 h-4 w-4 rounded-full border shrink-0 grid place-items-center ${
                      on ? "border-gold" : "border-blue-300/40"
                    }`}
                    aria-hidden
                  >
                    {on && <span className="h-2 w-2 rounded-full bg-gold" />}
                  </span>
                  <span>
                    <span className={`block font-display tracking-wide ${on ? "text-gold" : "text-blue-100"}`}>
                      {o.label}
                    </span>
                    <span className="block text-sm text-blue-200/60 mt-0.5">{o.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <p className="text-xs text-blue-200/40 pt-2">
            Auto-advance applies to keyboard play on the desktop board. See all{" "}
            <Link href="/shortcuts" className="text-gold/70 hover:text-gold underline">
              keyboard shortcuts
            </Link>
            .
          </p>
        </section>
      </main>
    </div>
  );
}
