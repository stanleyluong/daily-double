"use client";

import { useEffect, useState } from "react";
import { hasSeenTour, markTourSeen } from "@/lib/onboarding";

const STEPS: { title: string; body: string }[] = [
  {
    title: "Welcome to Daily Double",
    body: "A new Jeopardy!-style board every day — two rounds, 60 clues, Daily Doubles and a Final. Clues are written and judged by Claude.",
  },
  {
    title: "Pick a clue, type your answer",
    body: "Click any dollar value to open it. You don't need \"What is…\" — just type the answer. A lenient AI host judges it.",
  },
  {
    title: "Play with friends, live",
    body: "Live sends you to a lobby with a shareable code. Take turns, chat, react with emotes, and race the clock together.",
  },
  {
    title: "Make it yours",
    body: "⚙ Settings has auto-advance and sound controls. Press ? on the board any time for keyboard shortcuts.",
  },
];

export default function OnboardingTour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!hasSeenTour()) setOpen(true);
  }, []);

  const close = () => {
    markTourSeen();
    setOpen(false);
  };

  if (!open) return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4" onClick={close}>
      <div
        className="w-full max-w-sm bg-board rounded-lg shadow-2xl p-6 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center gap-1.5 mb-5">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? "w-6 bg-gold" : "w-1.5 bg-blue-300/25"
              }`}
            />
          ))}
        </div>
        <p className="font-display text-2xl tracking-wide text-gold mb-2">{s.title}</p>
        <p className="text-blue-100/80 text-sm leading-relaxed mb-6">{s.body}</p>
        <div className="flex items-center justify-between">
          <button onClick={close} className="text-sm text-blue-200/50 hover:text-blue-100">
            Skip
          </button>
          <button
            onClick={() => (last ? close() : setStep((n) => n + 1))}
            className="font-display tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-6 py-2 rounded"
          >
            {last ? "Let's play" : "Next →"}
          </button>
        </div>
      </div>
    </div>
  );
}
