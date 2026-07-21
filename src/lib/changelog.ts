// Player-facing patch notes. Newest first. Keep entries short and in the
// player's language (what changed for them), not implementation detail.

export interface ChangelogEntry {
  date: string; // YYYY-MM-DD
  title: string;
  tag?: "new" | "improved" | "fixed";
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-07-20",
    title: "Live multiplayer",
    tag: "new",
    items: [
      "Play head-to-head: start a game, share the join code, and up to 3 players take on the same board together.",
      "Everyone gets the same 10-second window to answer each clue — no buzzer races, no advantage for a faster connection.",
      "A live scoreboard updates every round, and the pick passes around the table.",
    ],
  },
  {
    date: "2026-07-20",
    title: "Play anywhere, pick up where you left off",
    tag: "improved",
    items: [
      "Your progress now follows your account, not just your browser — start on your laptop, finish on your phone.",
      "Faster, smoother feedback: a slim progress bar, an animated score, and a subtle flash when a ruling comes in.",
      "Keyboard players can now move around the board with the arrow keys and open a clue with Enter.",
      "Error messages no longer interrupt with a browser popup — they slide in as a dismissable note instead.",
    ],
  },
  {
    date: "2026-07-20",
    title: "A more mobile-friendly board",
    tag: "improved",
    items: [
      "On phones, the board is now a tidy tap-to-expand list per category instead of a grid you had to scroll sideways.",
    ],
  },
  {
    date: "2026-07-19",
    title: "Final Jeopardy",
    tag: "new",
    items: [
      "Every board now ends with a proper Final Jeopardy round — one category, one clue, and a wager of anything from $0 up to your total.",
      "Wagers now follow the real show's rules: any whole-dollar amount, not just round hundreds.",
    ],
  },
  {
    date: "2026-07-19",
    title: "Fresher boards, fewer repeats",
    tag: "improved",
    items: [
      "Clues no longer repeat a category or answer within a board — and now they avoid repeating the last week's boards too.",
      "Added a loading spinner while the AI host is judging your answer.",
    ],
  },
];
