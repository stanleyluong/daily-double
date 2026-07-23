import Anthropic from "@anthropic-ai/sdk";
import { FieldValue } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { db } from "@/lib/firebaseAdmin";

const MODEL = "claude-opus-4-8";

export interface Clue {
  id: string;
  value: number;
  clue: string;
  answer: string;
  acceptable: string[];
  dailyDouble: boolean;
}

export interface Category {
  title: string;
  clues: Clue[];
}

export interface Round {
  name: string;
  categories: Category[];
}

// No fixed dollar value — entirely wager-driven, like the real thing.
export interface FinalClue {
  category: string;
  clue: string;
  answer: string;
  acceptable: string[];
}

export interface Board {
  boardId: string;
  date: string;
  rounds: Round[]; // [0] = Jeopardy!, [1] = Double Jeopardy!
  // Optional: boards generated before Final Jeopardy shipped don't have
  // this. Every board created from now on always does — getBoardForDate()
  // never omits it for a freshly-generated board, only when reading an
  // older persisted doc. Everything downstream (totalClueCount, the client
  // UI) treats its absence as "this board has no Final Jeopardy round"
  // rather than an error, so in-progress games on old boards aren't broken.
  final?: FinalClue;
}

// What the browser is allowed to see — no answers. `dailyDouble` IS included:
// hiding it would need a server round-trip per clue-open for a purely
// cosmetic surprise, and this is a casual portfolio game — the client
// withholds rendering the clue text until a wager is placed, which is
// enough to preserve the "wager blind" experience for anyone actually
// playing rather than reading network traffic. Same trust model applies to
// PublicFinalClue's `clue` field.
export interface PublicClue {
  id: string;
  value: number;
  clue: string;
  dailyDouble: boolean;
}

export interface PublicFinalClue {
  category: string;
  clue: string;
}

export interface PublicRound {
  name: string;
  categories: { title: string; clues: PublicClue[] }[];
}

export interface PublicBoard {
  boardId: string;
  date: string;
  rounds: PublicRound[];
  final?: PublicFinalClue;
}

function client(): Anthropic {
  return new Anthropic();
}

function parseJson<T>(message: Anthropic.Message): T {
  const block = message.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error(`No text block in response (stop_reason: ${message.stop_reason})`);
  }
  return JSON.parse(block.text) as T;
}

const CATEGORIES_SCHEMA = {
  type: "object",
  properties: {
    categories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          theme: { type: "string" },
        },
        required: ["title", "theme"],
        additionalProperties: false,
      },
    },
  },
  required: ["categories"],
  additionalProperties: false,
} as const;

const CLUES_SCHEMA = {
  type: "object",
  properties: {
    clues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          clue: { type: "string" },
          answer: { type: "string" },
          acceptable: { type: "array", items: { type: "string" } },
        },
        required: ["clue", "answer", "acceptable"],
        additionalProperties: false,
      },
    },
  },
  required: ["clues"],
  additionalProperties: false,
} as const;

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    correct: { type: "boolean" },
    comment: { type: "string" },
  },
  required: ["correct", "comment"],
  additionalProperties: false,
} as const;

const SINGLE_CLUE_SCHEMA = {
  type: "object",
  properties: {
    clue: { type: "string" },
    answer: { type: "string" },
    acceptable: { type: "array", items: { type: "string" } },
  },
  required: ["clue", "answer", "acceptable"],
  additionalProperties: false,
} as const;

const FINAL_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string" },
    clue: { type: "string" },
    answer: { type: "string" },
    acceptable: { type: "array", items: { type: "string" } },
  },
  required: ["category", "clue", "answer", "acceptable"],
  additionalProperties: false,
} as const;

interface CategoryBrief {
  title: string;
  theme: string;
}

async function generateCategories(
  date: string,
  roundLabel: string,
  harder: boolean,
  avoidCategories: CategoryBrief[] = []
): Promise<CategoryBrief[]> {
  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 1024,
    output_config: { format: { type: "json_schema", schema: CATEGORIES_SCHEMA } },
    system:
      "You are the head writer for a Jeopardy!-style trivia game. You write clever, varied boards for a general audience.",
    messages: [
      {
        role: "user",
        content: `Create exactly 6 categories for the ${roundLabel} round of the daily board of ${date}.

Requirements:
- A diverse mix across the 6: at least one from history/geography/science, one from arts/literature, one from pop culture/sports/food, and one LIGHT wordplay category — rhymes, puns, or "before & after" — where the answers are ordinary knowledge and the wordplay is just the framing.
- HARD BAN on letter-mechanic gimmicks: no "hidden word inside another word" (e.g. a body part concealed in a longer word), no anagrams, no "every answer contains/starts with/shares a specific letter", no acrostics. These require exact letter-by-letter matches that are easy to get wrong, and produce broken clues (e.g. claiming "disavow" hides "shin" when it does not). When unsure, make it a straightforward knowledge category instead.
- Titles are short and punchy, puns welcome, ALL CAPS not required.
- For each category, write a one-sentence "theme" that a clue writer would use to stay on-brief. For any wordplay category, state the gimmick precisely and ensure every clue's answer genuinely satisfies it.
- Vary topics day to day; let the date seed your choices but never mention the date in titles.${
          harder
            ? "\n- This is the second (harder) round: categories should be a notch more specific or advanced than a first-round board, the way real Double Jeopardy! categories go deeper than the first round."
            : ""
        }${
          avoidCategories.length > 0
            ? `\n- This board already has these categories from an earlier round — do not repeat their subject matter, and do not create another category centered on the same core topic (e.g. if "Rivers of the World" already exists, don't also write a geography category built around rivers):\n${avoidCategories
                .map((c) => `  - "${c.title}": ${c.theme}`)
                .join("\n")}`
            : ""
        }`,
      },
    ],
  });
  const { categories } = parseJson<{ categories: CategoryBrief[] }>(message);
  if (!Array.isArray(categories) || categories.length < 6) {
    throw new Error("Model returned fewer than 6 categories");
  }
  return categories.slice(0, 6);
}

async function generateClues(
  category: CategoryBrief,
  harder: boolean,
  avoidAnswers: string[] = []
): Promise<{ clue: string; answer: string; acceptable: string[] }[]> {
  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 2048,
    output_config: { format: { type: "json_schema", schema: CLUES_SCHEMA } },
    system:
      "You are the head writer for a Jeopardy!-style trivia game. Your clues are factually accurate, unambiguous, and fun.",
    messages: [
      {
        role: "user",
        content: `Write exactly 5 clues for the category "${category.title}".
Theme brief: ${category.theme}

Requirements:
- Jeopardy! style: each clue is a declarative statement or description; the player responds with the answer (e.g. clue: "This president delivered the Gettysburg Address" → answer: "Abraham Lincoln").
- Order from easiest to hardest.${
          harder
            ? " This is the harder, second-round difficulty band — even the easiest clue here should be a bit tougher than a casual first-round clue, and the hardest should challenge a serious trivia fan."
            : " The easiest should be gettable by most people; the hardest should challenge a trivia fan."
        }
- Answers must be short (a name, term, title, or place — not a sentence) and factually correct beyond doubt. Do not write clues you are not certain about.
- "acceptable" lists alternate correct forms: last name only, common nicknames, alternate spellings, with/without articles. Empty array if none.
- CRITICAL — never give the answer away in the clue: the clue text must not contain the answer, any word of the answer, or an obvious root/derivative of it. E.g. if the answer is "Abraham Lincoln", the clue may not contain "Abraham", "Lincoln", or "Lincoln's"; if the answer is "photosynthesis", it may not contain "photo", "synthesis", or "synthesize". Describe around it. If you can't write a clue without naming the answer, choose a different clue.
- No two clues in this set may share the same answer, even worded differently.${
          avoidAnswers.length > 0
            ? `\n- These answers are already used elsewhere on today's board — none of your 5 answers may match or closely resemble any of them: ${avoidAnswers.join("; ")}`
            : ""
        }`,
      },
    ],
  });
  const { clues } = parseJson<{ clues: { clue: string; answer: string; acceptable: string[] }[] }>(message);
  if (!Array.isArray(clues) || clues.length < 5) {
    throw new Error(`Model returned fewer than 5 clues for "${category.title}"`);
  }
  return clues.slice(0, 5);
}

// Single-clue replacement, used only when the whole-board dedup pass below
// finds an answer collision that slipped past the avoid-lists above.
async function regenerateClue(
  category: CategoryBrief,
  value: number,
  harder: boolean,
  avoidAnswers: string[]
): Promise<{ clue: string; answer: string; acceptable: string[] }> {
  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 512,
    output_config: { format: { type: "json_schema", schema: SINGLE_CLUE_SCHEMA } },
    system:
      "You are the head writer for a Jeopardy!-style trivia game. Your clues are factually accurate, unambiguous, and fun.",
    messages: [
      {
        role: "user",
        content: `Write one replacement clue for the category "${category.title}" worth $${value}.
Theme brief: ${category.theme}

None of these answers, already used elsewhere on today's board, may be the answer here — pick a different fact within the category: ${avoidAnswers.join("; ")}

Requirements:
- Jeopardy! style: a declarative statement or description; the player responds with the answer.
- ${harder ? "This is the harder, second-round difficulty band." : "Gettable by a general trivia audience."}
- The answer must be short (a name, term, title, or place — not a sentence) and factually correct beyond doubt.
- "acceptable" lists alternate correct forms; empty array if none.
- Never include the answer text inside its own clue.`,
      },
    ],
  });
  return parseJson<{ clue: string; answer: string; acceptable: string[] }>(message);
}

function normalizeAnswer(answer: string): string {
  return answer
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/[^a-z0-9]/g, "");
}

// Runs after both rounds are fully generated. Catches any answer collision
// that got past the round-2 avoid-lists (including within a single round,
// since `seen` accumulates across the whole board) and regenerates just the
// later-occurring clue — the earlier one is left alone. Cheap in the common
// case (zero API calls when there are no collisions); bounded overall so a
// pathological run can't loop indefinitely.
async function dedupeBoardAnswers(
  rounds: Round[],
  briefs: Map<string, CategoryBrief>,
  harderByRound: boolean[],
  historicalAnswers: string[] = []
): Promise<void> {
  // Seeding `seen` with recent days' answers means a clue that happens to
  // match one gets caught by the exact same regeneration path as a
  // within-board collision — no separate cross-day-specific logic needed.
  const seen = new Map<string, string>(historicalAnswers.map((a) => [normalizeAnswer(a), a]));
  const MAX_TOTAL_REGENERATIONS = 8;
  let regenerations = 0;

  for (let r = 0; r < rounds.length; r++) {
    for (let c = 0; c < rounds[r].categories.length; c++) {
      const category = rounds[r].categories[c];
      const brief = briefs.get(`${r}-${c}`);
      for (const clue of category.clues) {
        let norm = normalizeAnswer(clue.answer);
        let attempts = 0;
        while (seen.has(norm) && brief && attempts < 3 && regenerations < MAX_TOTAL_REGENERATIONS) {
          attempts++;
          regenerations++;
          try {
            const replacement = await regenerateClue(
              brief,
              clue.value,
              harderByRound[r],
              Array.from(seen.values())
            );
            clue.clue = replacement.clue;
            clue.answer = replacement.answer;
            clue.acceptable = replacement.acceptable ?? [];
            norm = normalizeAnswer(clue.answer);
          } catch (error) {
            console.error("Clue regeneration failed; keeping the duplicate:", error);
            break;
          }
        }
        seen.set(norm, clue.answer);
      }
    }
  }
}

// Real-rules approximation: Daily Doubles never land in the top ($200/$400)
// row, and when a round has more than one, they never share a category.
function placeDailyDoubles(categories: Category[], count: number): void {
  const candidates: { catIndex: number; rowIndex: number }[] = [];
  for (let c = 0; c < categories.length; c++) {
    for (let r = 1; r < categories[c].clues.length; r++) {
      candidates.push({ catIndex: c, rowIndex: r });
    }
  }
  // Fisher-Yates shuffle, then greedily take picks whose category hasn't
  // been used yet — simpler than backtracking and fine for count <= 2.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const usedCategories = new Set<number>();
  let placed = 0;
  for (const pick of candidates) {
    if (placed >= count) break;
    if (usedCategories.has(pick.catIndex)) continue;
    categories[pick.catIndex].clues[pick.rowIndex].dailyDouble = true;
    usedCategories.add(pick.catIndex);
    placed++;
  }
}

async function generateRound(
  date: string,
  roundIndex: number,
  name: string,
  multiplier: number,
  dailyDoubleCount: number,
  avoidCategories: CategoryBrief[] = [],
  avoidAnswers: string[] = []
): Promise<{ round: Round; briefs: CategoryBrief[] }> {
  const harder = multiplier > 1;
  const categoryBriefs = await generateCategories(date, name, harder, avoidCategories);
  const clueSets = await Promise.all(
    categoryBriefs.map((c) => generateClues(c, harder, avoidAnswers))
  );

  const categories: Category[] = categoryBriefs.map((brief, c) => ({
    title: brief.title,
    clues: clueSets[c].map((raw, r) => ({
      id: `${roundIndex}-${c}-${r}`,
      value: (r + 1) * 200 * multiplier,
      clue: raw.clue,
      answer: raw.answer,
      acceptable: raw.acceptable ?? [],
      dailyDouble: false,
    })),
  }));

  placeDailyDoubles(categories, dailyDoubleCount);
  return { round: { name, categories }, briefs: categoryBriefs };
}

async function generateFinalJeopardy(
  date: string,
  avoidCategories: CategoryBrief[],
  avoidAnswers: string[]
): Promise<FinalClue> {
  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 1024,
    output_config: { format: { type: "json_schema", schema: FINAL_SCHEMA } },
    system:
      "You are the head writer for a Jeopardy!-style trivia game. You write the single hardest, most memorable clue of the day for the Final Jeopardy round.",
    messages: [
      {
        role: "user",
        content: `Write the Final Jeopardy category and clue for the daily board of ${date}.

Requirements:
- This is the single hardest clue of the entire board — broader and more challenging than anything in the Double Jeopardy round, the kind that rewards deep general knowledge.
- Favor a category and clue a well-informed adult could reason their way to, even without knowing the fact outright — Final Jeopardy rewards logic and partial knowledge, not just pure recall.
- The category name alone should be evocative without giving away the answer.
- Jeopardy! style: a declarative statement or description; the player responds with the answer.
- The answer must be short (a name, term, title, or place — not a sentence) and factually correct beyond doubt.
- "acceptable" lists alternate correct forms; empty array if none.
- Never include the answer text inside its own clue.${
          avoidCategories.length > 0
            ? `\n- Do not repeat the subject matter of these categories already used today:\n${avoidCategories
                .map((c) => `  - "${c.title}": ${c.theme}`)
                .join("\n")}`
            : ""
        }${
          avoidAnswers.length > 0
            ? `\n- The answer must not be, or closely resemble, any of these already used today: ${avoidAnswers.join("; ")}`
            : ""
        }`,
      },
    ],
  });
  return parseJson<FinalClue>(message);
}

const HISTORY_LOOKBACK_DAYS = 7;

function daysBefore(dateKey: string, n: number): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// generateRound()'s avoidCategories/avoidAnswers only ever carried *within*
// one board (round 2 told round 1's picks). Nothing stopped the same
// category concept or answer from resurfacing the very next day, since
// every day's generateBoard() call started from a blank slate — caught when
// an "Elements" category with "Oxygen" as an answer showed up two days
// running. Fixed by seeding the very first generation call (and everything
// downstream of it) with the last week's categories/answers, read directly
// by document ID (no query, no index) rather than a Firestore query.
async function recentHistory(
  date: string
): Promise<{ avoidCategories: CategoryBrief[]; avoidAnswers: string[] }> {
  const dates = Array.from({ length: HISTORY_LOOKBACK_DAYS }, (_, i) => daysBefore(date, i + 1));
  const snaps = await Promise.all(dates.map((d) => db().collection(BOARDS).doc(d).get()));

  const avoidCategories: CategoryBrief[] = [];
  const avoidAnswers: string[] = [];
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const data = snap.data()!;
    for (const title of (data.categoryTitles as string[] | undefined) ?? []) {
      avoidCategories.push({ title, theme: title });
    }
    for (const round of (data.rounds as Round[] | undefined) ?? []) {
      for (const category of round.categories) {
        for (const clue of category.clues) avoidAnswers.push(clue.answer);
      }
    }
    const final = data.final as FinalClue | undefined;
    if (final) avoidAnswers.push(final.answer);
  }
  return { avoidCategories, avoidAnswers };
}

// A board is two rounds, ~60 clues total, plus one Final Jeopardy clue. Each
// round's category call is fast; the 6 clue calls per round run in
// parallel, and the two rounds run sequentially (12 parallel-in-pairs calls
// total) to stay well inside Amplify's SSR response window without one
// giant fan-out. Round 2 is told round 1's categories and answers to steer
// away from repeats at the source; the dedup pass afterward is the backstop
// for whatever gets through anyway (including within-round collisions).
// Final Jeopardy is generated last, told everything used so far, and gets
// its own short collision-retry loop rather than joining the whole-board
// dedup pass (it isn't part of any Round, so it doesn't fit that shape).
// Every generation call is also told the last week's categories/answers
// (see recentHistory()) so today's board doesn't repeat yesterday's.
async function generateBoard(date: string): Promise<Board> {
  const history = await recentHistory(date);

  const jeopardy = await generateRound(
    date,
    0,
    "Jeopardy!",
    1,
    1,
    history.avoidCategories,
    history.avoidAnswers
  );
  const jeopardyAnswers = jeopardy.round.categories.flatMap((c) => c.clues.map((cl) => cl.answer));

  const doubleJeopardy = await generateRound(
    date,
    1,
    "Double Jeopardy!",
    2,
    2,
    [...history.avoidCategories, ...jeopardy.briefs],
    [...history.avoidAnswers, ...jeopardyAnswers]
  );

  const rounds = [jeopardy.round, doubleJeopardy.round];
  const briefs = new Map<string, CategoryBrief>();
  jeopardy.briefs.forEach((b, c) => briefs.set(`0-${c}`, b));
  doubleJeopardy.briefs.forEach((b, c) => briefs.set(`1-${c}`, b));

  await dedupeBoardAnswers(rounds, briefs, [false, true], history.avoidAnswers);

  const allBriefs = [...history.avoidCategories, ...jeopardy.briefs, ...doubleJeopardy.briefs];
  const allAnswers = [
    ...history.avoidAnswers,
    ...rounds.flatMap((r) => r.categories.flatMap((c) => c.clues.map((cl) => cl.answer))),
  ];

  let final = await generateFinalJeopardy(date, allBriefs, allAnswers);
  const usedNorm = new Set(allAnswers.map(normalizeAnswer));
  for (let attempt = 0; usedNorm.has(normalizeAnswer(final.answer)) && attempt < 3; attempt++) {
    final = await generateFinalJeopardy(date, allBriefs, [...allAnswers, final.answer]);
  }

  return { boardId: randomUUID(), date, rounds, final };
}

// Generates a fresh board for the live-multiplayer pool. Seeded with today's
// date so it avoids repeating the last week of daily boards' categories/
// answers (recentHistory), giving multiplayer games new questions. Called
// ahead of time (pool seeding / a scheduled job), never in a request path.
export async function generateFreshBoard(): Promise<Board> {
  return generateBoard(todayKey());
}

// Builds one custom round from up to 6 category titles. Values scale with the
// round (Jeopardy! 200–1000, Double Jeopardy! 400–2000) and clue ids are
// prefixed by the round index, matching the daily-board id scheme.
async function buildCustomRound(
  titles: string[],
  roundIndex: number,
  avoidAnswers: string[]
): Promise<{ round: Round; briefs: CategoryBrief[] }> {
  const harder = roundIndex > 0;
  const multiplier = roundIndex + 1; // round 0 → 200s, round 1 → 400s
  const briefs: CategoryBrief[] = titles.map((t) => ({ title: t, theme: t }));
  const clueSets = await Promise.all(briefs.map((b) => generateClues(b, harder, avoidAnswers)));

  const categories: Category[] = briefs.map((brief, c) => ({
    title: brief.title,
    clues: clueSets[c].map((raw, r) => ({
      id: `${roundIndex}-${c}-${r}`,
      value: (r + 1) * 200 * multiplier,
      clue: raw.clue,
      answer: raw.answer,
      acceptable: raw.acceptable ?? [],
      dailyDouble: false,
    })),
  }));
  // Real Jeopardy! has one Daily Double in round 1 and two in round 2.
  placeDailyDoubles(categories, roundIndex === 0 ? 1 : 2);

  return { round: { name: harder ? "Double Jeopardy!" : "Jeopardy!", categories }, briefs };
}

// A user-defined board: the player supplies category titles and we write the
// clues. `roundCount` is 1 (6 categories, one round) or 2 (up to 12 categories,
// Jeopardy! + Double Jeopardy!). Kept to at most two parallel waves of clue
// calls plus one final so it still fits inside a request without hitting
// Amplify's SSR timeout (unlike the daily board, pre-generated off-request).
export async function generateCustomBoard(titles: string[], roundCount: 1 | 2 = 1): Promise<Board> {
  const clean = titles
    .map((t) => (t ?? "").replace(/\s+/g, " ").trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, roundCount === 2 ? 12 : 6);
  if (clean.length === 0) throw new Error("Enter at least one category.");

  // Split the titles across rounds (first 6 → Jeopardy!, next up to 6 → Double).
  const round1Titles = clean.slice(0, 6);
  const round2Titles = roundCount === 2 ? clean.slice(6, 12) : [];

  const first = await buildCustomRound(round1Titles, 0, []);
  const rounds: Round[] = [first.round];
  const allBriefs: CategoryBrief[] = [...first.briefs];
  const harderByRound = [false];
  const briefMap = new Map<string, CategoryBrief>();
  first.briefs.forEach((b, c) => briefMap.set(`0-${c}`, b));

  if (round2Titles.length > 0) {
    const round1Answers = first.round.categories.flatMap((c) => c.clues.map((cl) => cl.answer));
    const second = await buildCustomRound(round2Titles, 1, round1Answers);
    rounds.push(second.round);
    allBriefs.push(...second.briefs);
    harderByRound.push(true);
    second.briefs.forEach((b, c) => briefMap.set(`1-${c}`, b));
  }

  await dedupeBoardAnswers(rounds, briefMap, harderByRound);

  const allAnswers = rounds.flatMap((r) => r.categories.flatMap((c) => c.clues.map((cl) => cl.answer)));
  const final = await generateFinalJeopardy(todayKey(), allBriefs, allAnswers);

  return { boardId: randomUUID(), date: todayKey(), rounds, final };
}

// Generates + persists a custom board, returning its play key (`custom-{id}`)
// which the whole play/judge flow already understands via getBoardForDate.
export async function createCustomBoard(
  uid: string,
  titles: string[],
  roundCount: 1 | 2 = 1
): Promise<string> {
  const board = await generateCustomBoard(titles, roundCount);
  const id = randomUUID().replace(/-/g, "").slice(0, 12);
  await db().collection(CUSTOM_BOARDS).doc(id).set({
    ownerUid: uid,
    rounds: board.rounds,
    final: board.final ?? null,
    categoryTitles: board.rounds.flatMap((r) => r.categories.map((c) => c.title)),
    createdAt: FieldValue.serverTimestamp(),
  });
  return `custom-${id}`;
}

// Everyone worldwide plays the same board; the day rolls over on US Pacific time.
export function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date());
}

export function isValidDateKey(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

// A playable board key is a date (daily/historical board) or a custom-board
// key. Used by the play/judge/scores routes so custom boards flow through the
// same endpoints.
export function isValidBoardKey(key: string): boolean {
  return isValidDateKey(key) || /^custom-[A-Za-z0-9]{6,}$/.test(key);
}

const BOARDS = "jeopardyBoards";
const HISTORICAL_BOARDS = "historicalBoards";
const CUSTOM_BOARDS = "customBoards";

// Boards are immutable once written, so a per-instance memo is safe and keeps
// judge calls from re-reading Firestore on every answer.
const memo = new Map<string, Board>();

function boardFromDoc(data: FirebaseFirestore.DocumentData): Board {
  // `final` is undefined for boards persisted before Final Jeopardy shipped
  // — that's expected, not an error (see the Board.final doc comment).
  return { boardId: data.boardId, date: data.date, rounds: data.rounds, final: data.final };
}

// Returns the board for a date: from memo, then Firestore. Only today's board
// is generated on demand — a past date with no stored board never existed.
export async function getBoardForDate(date: string): Promise<Board | null> {
  const cached = memo.get(date);
  if (cached) return cached;

  // Custom user-generated boards are keyed `custom-{id}` so they flow through
  // the same play/judge path (the id is the answeredClues namespace too).
  if (date.startsWith("custom-")) {
    const snap = await db().collection(CUSTOM_BOARDS).doc(date.slice(7)).get();
    if (!snap.exists) return null;
    const d = snap.data()!;
    const board: Board = { boardId: date, date, rounds: d.rounds, final: d.final ?? undefined };
    memo.set(date, board);
    return board;
  }

  const ref = db().collection(BOARDS).doc(date);
  const snap = await ref.get();
  if (snap.exists) {
    const board = boardFromDoc(snap.data()!);
    memo.set(date, board);
    return board;
  }

  // Historical J-Archive boards are keyed by real air date (e.g. 1995-03-10),
  // which never collides with a daily-board date, so falling back here makes
  // every real episode fully playable/judgeable through the exact same flow.
  const hist = await db().collection(HISTORICAL_BOARDS).doc(date).get();
  if (hist.exists) {
    const data = hist.data()!;
    const board: Board = {
      boardId: `jarchive-${data.gameId ?? date}`,
      date,
      rounds: data.rounds,
      final: data.final ?? undefined,
    };
    memo.set(date, board);
    return board;
  }

  if (date !== todayKey()) return null;

  const board = await generateBoard(date);
  try {
    await ref.create({
      boardId: board.boardId,
      date: board.date,
      rounds: board.rounds,
      final: board.final,
      categoryTitles: board.rounds.flatMap((r) => r.categories.map((c) => c.title)),
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch {
    // Lost a concurrent-generation race — the first writer's board is canonical.
    const existing = await ref.get();
    if (!existing.exists) throw new Error("Failed to save the generated board");
    const winner = boardFromDoc(existing.data()!);
    memo.set(date, winner);
    return winner;
  }
  memo.set(date, board);
  return board;
}

export interface BoardSummary {
  date: string;
  categoryTitles: string[];
  topScore: { name: string; score: number } | null;
}

export async function listBoards(): Promise<BoardSummary[]> {
  // No orderBy: combining orderBy(documentId) with a projection (.select())
  // requires a composite index Firestore won't auto-create. The collection
  // grows by one doc/day, so fetching and sorting client-side is cheap for
  // the foreseeable future.
  const snap = await db().collection(BOARDS).select("categoryTitles", "topScore").get();
  return snap.docs
    .map((doc) => ({
      date: doc.id,
      categoryTitles: (doc.get("categoryTitles") as string[] | undefined) ?? [],
      topScore: (doc.get("topScore") as { name: string; score: number } | undefined) ?? null,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 120);
}

export function toPublicBoard(board: Board): PublicBoard {
  return {
    boardId: board.boardId,
    date: board.date,
    rounds: board.rounds.map((round) => ({
      name: round.name,
      categories: round.categories.map((cat) => ({
        title: cat.title,
        clues: cat.clues.map(({ id, value, clue, dailyDouble }) => ({ id, value, clue, dailyDouble })),
      })),
    })),
    final: board.final ? { category: board.final.category, clue: board.final.clue } : undefined,
  };
}

export function findClue(
  board: Board,
  clueId: string
): { clue: Clue; category: Category; roundIndex: number } | null {
  for (let roundIndex = 0; roundIndex < board.rounds.length; roundIndex++) {
    for (const category of board.rounds[roundIndex].categories) {
      const clue = category.clues.find((c) => c.id === clueId);
      if (clue) return { clue, category, roundIndex };
    }
  }
  return null;
}

export function totalClueCount(board: Board): number {
  const gridClues = board.rounds.reduce(
    (n, round) => n + round.categories.reduce((m, cat) => m + cat.clues.length, 0),
    0
  );
  return gridClues + (board.final ? 1 : 0);
}

export function roundTopValue(board: Board, roundIndex: number): number {
  const round = board.rounds[roundIndex];
  return round ? Math.max(...round.categories.flatMap((c) => c.clues.map((cl) => cl.value))) : 0;
}

// Deliberately typed as structural subsets of Category/Clue (title-only;
// clue/answer/acceptable-only) rather than the full interfaces, so the
// Final Jeopardy clue — which has no `id`/`value`/`dailyDouble` — can reuse
// this without being force-fit into the grid-clue shape.
export async function judgeAnswer(
  category: { title: string },
  clue: { clue: string; answer: string; acceptable: string[] },
  playerAnswer: string
): Promise<{ correct: boolean; comment: string }> {
  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 512,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: JUDGE_SCHEMA },
    },
    system:
      "You judge answers for a Jeopardy!-style trivia game. Be lenient the way a human host is: accept last names alone, obvious misspellings, missing articles, answers with or without the \"what is / who is\" framing, and answers that contain the essential words of the correct response even if reordered. Exception: when the category is about rhyme, wordplay, spelling, sequence, or word order, the order IS the answer, so a reordered response is wrong. Reject answers that are genuinely a different thing, too vague, or hedged lists of guesses. Your comment is one short, playful sentence addressed to the player — never reveal information beyond whether they were right and the correct answer.",
    messages: [
      {
        role: "user",
        content: `Category: ${category.title}
Clue: ${clue.clue}
Correct answer: ${clue.answer}
Also acceptable: ${clue.acceptable.length ? clue.acceptable.join("; ") : "(none listed)"}

Player's response: ${JSON.stringify(playerAnswer)}

Was the player correct?`,
      },
    ],
  });
  return parseJson<{ correct: boolean; comment: string }>(message);
}

// Second-opinion pass for an appealed ruling. The player is contesting a
// rejection, so reconsider generously and give the benefit of the doubt on
// close calls — but still uphold the rejection for answers that are genuinely
// a different thing or clearly wrong.
export async function judgeAppeal(
  category: { title: string },
  clue: { clue: string; answer: string; acceptable: string[] },
  playerAnswer: string,
  reason = ""
): Promise<{ correct: boolean; comment: string }> {
  const cleanReason = (reason ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 512,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: JUDGE_SCHEMA },
    },
    system:
      "You are reviewing an APPEALED ruling in a Jeopardy!-style game — the player's answer was marked wrong and they're contesting it. They may include a reason explaining why they think they're right; weigh it fairly but don't accept a wrong answer just because they argue well. Reconsider generously and give the benefit of the doubt on genuinely close calls: if the response is a defensible match — a valid alternate name, phrasing, spelling, or close-enough form — rule it CORRECT. Only uphold the rejection if the answer is genuinely a different thing or clearly wrong (including a reordered answer when the category is about rhyme, wordplay, or sequence). Your comment is one short, friendly sentence explaining the appeal decision.",
    messages: [
      {
        role: "user",
        content: `Category: ${category.title}
Clue: ${clue.clue}
Correct answer: ${clue.answer}
Also acceptable: ${clue.acceptable.length ? clue.acceptable.join("; ") : "(none listed)"}

Player's response: ${JSON.stringify(playerAnswer)}
Player's appeal reason: ${cleanReason ? JSON.stringify(cleanReason) : "(none given)"}

On appeal, should this count as correct?`,
      },
    ],
  });
  return parseJson<{ correct: boolean; comment: string }>(message);
}
