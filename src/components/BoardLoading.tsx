"use client";

import { useEffect, useState } from "react";

// Shown while a board is being written by Claude. Rotates through real
// Jeopardy! trivia so the wait feels like part of the game.
const FACTS: string[] = [
  "Jeopardy! first aired in 1964, hosted by Art Fleming.",
  "The famous \"Think!\" cue music is called \"A Time for Tony,\" written by Merv Griffin — reportedly earning him over $70 million in royalties.",
  "Contestants must phrase every response in the form of a question.",
  "Ken Jennings won 74 games in a row in 2004 — the longest streak in the show's history.",
  "James Holzhauer holds the record for the highest single-day winnings: $131,127.",
  "The Daily Double lets a player wager up to their entire score on one clue.",
  "Alex Trebek hosted Jeopardy! for 37 seasons, taping over 8,000 episodes.",
  "The current three-round format is Jeopardy!, Double Jeopardy!, and Final Jeopardy!.",
  "In Double Jeopardy! the clue values double — and there are two Daily Doubles.",
  "A clue left unrevealed is called a \"triple stumper\" when no one gets it right.",
  "The show has won a record number of Daytime Emmy Awards for Game Show.",
  "Final Jeopardy! gives every remaining player 30 seconds to write a response — set to the Think! music.",
  "Merv Griffin's wife suggested the answer-and-question twist that defines the show.",
  "The highest Final Jeopardy! wager is limited only by a player's current score.",
  "Category titles often hide wordplay — read them carefully before you buzz.",
  "The very first clue in 1964 was worth just $10.",
];

export default function BoardLoading({
  title = "Writing your board…",
  detail,
}: {
  title?: string;
  detail?: string;
}) {
  const [i, setI] = useState(() => Math.floor(Math.random() * FACTS.length));
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const t = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setI((n) => (n + 1) % FACTS.length);
        setFade(true);
      }, 350);
    }, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="max-w-lg mx-auto text-center py-14 px-4">
      <div className="inline-block h-10 w-10 border-2 border-gold border-t-transparent rounded-full animate-spin mb-5" />
      <p className="text-blue-100 font-display text-2xl tracking-wide">{title}</p>
      {detail && <p className="text-blue-200/50 text-sm mt-2">{detail}</p>}

      <div className="mt-9 rounded-lg border border-[color:var(--hairline)] bg-board-deep/50 px-6 py-6">
        <p className="font-display tracking-[0.22em] text-gold/70 text-xs mb-3">DID YOU KNOW?</p>
        <p
          className={`text-blue-100/90 leading-relaxed min-h-[3.5rem] transition-opacity duration-300 ${
            fade ? "opacity-100" : "opacity-0"
          }`}
        >
          {FACTS[i]}
        </p>
      </div>
    </div>
  );
}
