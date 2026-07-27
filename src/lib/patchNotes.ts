// Player-facing patch notes. Newest first. Keep entries short and in the
// player's language (what changed for them), not implementation detail.

export interface PatchNoteEntry {
  date: string; // YYYY-MM-DD
  title: string;
  tag?: "new" | "improved" | "fixed";
  items: string[];
}

export const PATCH_NOTES: PatchNoteEntry[] = [
  {
    date: "2026-07-27",
    title: "Real episodes: fixed a wrong-slot clue bug",
    tag: "fixed",
    items: [
      "A couple thousand real episodes could show a clue under the wrong dollar value — a data-import bug, now fixed, that shifted a later clue up a row wherever an earlier one was never aired.",
      "Tap an empty-looking clue slot on a real episode's board and it'll now explain itself: that clue simply ran out of time on the original broadcast, it's not missing data.",
    ],
  },
  {
    date: "2026-07-26",
    title: "Archive filters, faster pages, and accessibility",
    tag: "improved",
    items: [
      "The Archive no longer caps real episodes at the newest 150 — page through the entire history, and narrow it down by date range or by whether you've played a board yet.",
      "Fixed the Friends list briefly claiming you have no friends (or that nobody's online) while it was still loading.",
      "Faster loading on Friends, Rankings, and History.",
      "Improved text contrast and keyboard/screen-reader accessibility throughout the app — modals now trap focus properly, and sortable columns, filters, and toggle buttons announce their state.",
    ],
  },
  {
    date: "2026-07-24",
    title: "One unified History page",
    tag: "improved",
    items: [
      "Your play history is now one sortable, searchable table instead of three separate lists — filter by type or progress, and see a 'Recent multiplayer games' section for who you played and the result.",
      "Filtered views on Archive and History now live in the URL, so a filtered page can be bookmarked or shared — the old standalone /boards list has been retired in favor of Archive.",
      "Custom boards now get a real name — either one you give it, or one built from its categories — instead of just \"Custom board\".",
      "A live game's player list now shows who's actually in it, not just a headcount.",
      "Smoother loading placeholders instead of a blank flash while a page's data comes in.",
    ],
  },
  {
    date: "2026-07-23",
    title: "Spectator mode, rematches, and emotes",
    tag: "new",
    items: [
      "Watch a live game in progress with a read-only spectator link — no sign-in required.",
      "Rematch button after a game, with a best-of-series tally across rematches.",
      "React mid-game with quick emotes (👏 😂 😱 🔥 🤔 😭) that float up and fade.",
      "Host-editable lobby settings — answer timer, scoring rules, and pick order — plus the pregame host can now pick any board: a real episode, an AI daily board, or a custom one.",
      "Invite friends straight into a lobby from your friends list instead of sharing a join code.",
      "Added a PWA install option (add Daily Double to your home screen) and a \"wager it all\" shortcut for true Daily Doubles.",
    ],
  },
  {
    date: "2026-07-23",
    title: "Renamed: History is now Archive, Me is now History",
    tag: "improved",
    items: [
      "What used to be /history (browse every board) is now /archive; your personal page (was /me) is now /history.",
      "The Archive gained a per-account status column (new / in progress / completed) and a filter for real episodes vs. AI daily boards vs. custom.",
    ],
  },
  {
    date: "2026-07-22",
    title: "Answer review, appeals, and keyboard play",
    tag: "new",
    items: [
      "Review every clue after a round — your answer, the correct one, and how you did.",
      "Think the AI judge got one wrong? Appeal it once per game.",
      "Full keyboard support: arrow keys move around the board, Enter opens a clue, double-Escape reveals the answer when you're stuck, and a ⌨ button (or the ? key) shows the full shortcut list.",
      "In-game chat, and a house-rules settings panel for the lobby.",
      "A Pass button, and everyone's answer time now shows in the reveal.",
      "Real sound effects and music — main theme, a Daily Double sting, Final Jeopardy music — with separate Music and Sound-effects toggles.",
    ],
  },
  {
    date: "2026-07-21",
    title: "Archive, friends, and custom boards",
    tag: "new",
    items: [
      "Browse and search every real Jeopardy! episode on file by category, and play any of them.",
      "Build your own board from any categories you like with Custom Boards.",
      "Add friends by email, see who's online, and invite them straight into a game.",
      "Multiplayer lobbies can now use a real historical episode or a custom board, not just a fresh AI-generated one.",
      "New Settings page — start with control over how long you get to answer each clue.",
    ],
  },
  {
    date: "2026-07-21",
    title: "Multiplayer, leveled up",
    tag: "improved",
    items: [
      "Every multiplayer game now uses a fresh board of brand-new questions — no more replaying ones you've seen.",
      "Whoever answers correctly first controls the next pick, just like the real show. Miss it and the board stays with whoever picked.",
      "Sound effects! A ticking countdown, a chime when you're right, a buzzer when you're not — toggle them with the 🔊 button.",
      "If someone drops out, the game auto-pauses and everyone's told — then picks right back up when they reconnect.",
      "When it's someone else's pick, you stay on the last question's results instead of being yanked back to the board.",
    ],
  },
  {
    date: "2026-07-20",
    title: "Ranked mode, ratings & pause",
    tag: "new",
    items: [
      "Choose your game type: Normal for casual play, or Ranked to climb a competitive ladder.",
      "Ranked games give every player an Elo-style rating — beat higher-rated opponents to climb faster. See where you stand on the new Ranked Leaderboard.",
      "In Normal games, any player can pause and resume anytime — the clue timer freezes and picks up right where it left off. Ranked games can't be paused.",
    ],
  },
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
