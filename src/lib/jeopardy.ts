import Anthropic from "@anthropic-ai/sdk";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { db } from "@/lib/firebaseAdmin";

// Two tiers to keep credit spend down. Generation (writing categories, clues,
// Final Jeopardy) is a once-per-day-per-board cost where quality matters most,
// so it uses Sonnet. Judging runs on every answer (though verdicts are cached
// across users by clue+answer), so it uses the much cheaper Haiku — plenty for
// "is this response acceptable for this clue."
const GENERATION_MODEL = "claude-sonnet-5";
const JUDGE_MODEL = "claude-haiku-4-5";
// Used only if the primary judge model errors (an API incompatibility like the
// Haiku effort-param 400, or a transient failure). A judged answer is worth a
// pricier call rather than blocking the player mid-game — one model's outage
// degrades to costlier judging instead of taking the whole game down.
const JUDGE_FALLBACK_MODEL = "claude-sonnet-5";

export interface Clue {
  id: string;
  value: number;
  clue: string;
  answer: string;
  acceptable: string[];
  dailyDouble: boolean;
  // True only for a historical (J-Archive) clue that was never asked on the
  // original broadcast — the round ran out of time before it was played, not
  // a data-import failure. clue/answer/acceptable are empty placeholders;
  // every consumer that walks a category's clues to decide what's answerable
  // (currentRoundClueIds/roundClueIds, totalClueCount, findClue) excludes
  // these. Never set by board generation — only by the J-Archive importer and
  // its one-time migration.
  unrevealed?: boolean;
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
  unrevealed?: boolean;
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

// Programmatic backstop for the "HARD BAN on letter-mechanic gimmicks" prompt
// rule below — models occasionally write one anyway (e.g. a "Double the
// Letters" category claiming every answer has a repeated letter, when one
// doesn't: "harpsichord" has no e's at all). These require exact
// letter-by-letter verification the model can't reliably do itself, and
// there's no cheap way to verify an arbitrary letter claim after the fact —
// so instead of trying, just detect the pattern in the category's own
// title/theme and reject it outright.
const LETTER_GIMMICK_PATTERN =
  /\b(hidden word|double(?:d)? the letters?|doubled letters?|repeated letters?|shares? (?:a|the) letter|share the same letter|silent letter|same starting letter|starts? with the same letter|anagram|acrostic|word within a word|word inside (?:a|another) word)\b/i;

function isLetterGimmickCategory(brief: CategoryBrief): boolean {
  return LETTER_GIMMICK_PATTERN.test(brief.title) || LETTER_GIMMICK_PATTERN.test(brief.theme);
}

// Rotating topic pool so a board's category *types* vary day to day and between
// rounds, instead of always hitting the same few buckets (history / arts / pop
// culture / wordplay). The date seeds a deterministic pick, so everyone still
// gets the same board on a given day, but the required domains rotate across
// days. (Sonnet doesn't support a `temperature` bump — it's deprecated on the
// model — so prompt-level rotation is how we get variety.)
const TOPIC_DOMAINS = [
  "world history",
  "U.S. history",
  "geography & places",
  "science & nature",
  "space & astronomy",
  "the human body & medicine",
  "animals & the natural world",
  "technology & inventions",
  "literature & authors",
  "poetry & language",
  "art & architecture",
  "classical or modern music",
  "film",
  "television",
  "pop culture & celebrities",
  "sports",
  "games & hobbies",
  "food & drink",
  "mythology & folklore",
  "world religions",
  "business & brands",
  "politics & world leaders",
  "law & crime",
  "money & economics",
  "fashion & design",
  "transportation",
  "world cultures & holidays",
] as const;

// Wordplay is a Jeopardy! staple, but the *style* of the one wordplay category
// rotates too so it isn't always "rhymes." All of these are framing-only (no
// letter-mechanic gimmicks, which are banned separately).
const WORDPLAY_STYLES = [
  'rhyming answers (each answer rhymes with a given word)',
  "puns or double meanings in the clue framing",
  '"before & after" — two facts joined by an overlapping shared word',
  "fill-in-the-blank famous phrases, titles, or sayings",
  "two-word phrases or compound words sharing a theme",
] as const;

// Tiny deterministic PRNG (FNV-1a hash → mulberry32) driving a seeded shuffle,
// so a given seed always yields the same pick but picks spread well across
// seeds. Used to rotate the required topic domains per board.
function seededPick<T>(arr: readonly T[], count: number, seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

async function generateCategories(
  date: string,
  roundLabel: string,
  harder: boolean,
  avoidCategories: CategoryBrief[] = []
): Promise<CategoryBrief[]> {
  // Rotate which domains this board must cover (4 required + 1 wordplay + 1
  // free = 6), seeded by date+round so it varies day to day and between rounds.
  const domains = seededPick(TOPIC_DOMAINS, 4, `${date}|${roundLabel}`);
  const wordplayStyle = seededPick(WORDPLAY_STYLES, 1, `${date}|${roundLabel}|wp`)[0];
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const message = await client().messages.create({
      model: GENERATION_MODEL,
      // Generous ceiling on purpose: Sonnet's structured-output (json_schema)
      // mode burns far more tokens than the visible JSON, and a cap near the
      // expected size makes it thrash and consume the whole budget (→ truncated
      // JSON, "Unterminated string" parse errors). With headroom it finishes
      // cleanly in a fraction of the tokens. You're only billed for tokens
      // actually generated, so the high ceiling is free.
      max_tokens: 4096,
      output_config: { format: { type: "json_schema", schema: CATEGORIES_SCHEMA } },
      system:
        "You are the head writer for a Jeopardy!-style trivia game. You write clever, varied boards for a general audience.",
      messages: [
        {
          role: "user",
          content: `Create exactly 6 categories for the ${roundLabel} round of the daily board of ${date}.

Requirements:
- Cover a varied spread of subjects. For THIS board, make sure each of these domains is represented by at least one of the 6 categories: ${domains.join("; ")}. Pick the remaining categories from any OTHER domains you like (not a repeat of those) to round out the board.
- Include exactly one LIGHT wordplay category in this style: ${wordplayStyle}. The answers should be ordinary knowledge and the wordplay is just the framing.
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
    const clean = categories.slice(0, 6);
    const hasGimmick = clean.some(isLetterGimmickCategory);
    if (!hasGimmick || attempt === MAX_ATTEMPTS) {
      if (hasGimmick) {
        console.error(
          `Letter-gimmick category slipped through after ${MAX_ATTEMPTS} attempts for ${date} ${roundLabel}:`,
          clean.filter(isLetterGimmickCategory).map((c) => c.title)
        );
      }
      return clean;
    }
    // Ask for a fresh batch of 6 rather than patching just the offending
    // one — simpler than building a single-category regeneration path for
    // what should be a rare backstop case.
  }
  throw new Error("unreachable");
}

async function generateClues(
  category: CategoryBrief,
  harder: boolean,
  avoidAnswers: string[] = []
): Promise<{ clue: string; answer: string; acceptable: string[] }[]> {
  const message = await client().messages.create({
    model: GENERATION_MODEL,
    max_tokens: 4096, // headroom for structured output — see generateCategories
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
    model: GENERATION_MODEL,
    max_tokens: 4096, // headroom for structured output — see generateCategories
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

const STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "in", "on", "at", "to", "for", "is", "are", "was", "were",
]);

// Programmatic backstop for the "never give the answer away" prompt rule
// (models occasionally ignore it anyway): true if the clue text contains the
// full answer, or any single significant word (4+ letters, not a stopword)
// from it, as a whole word. Catches "shin" leaking from an answer like "the
// shin bone" appearing verbatim in the clue, not just exact full-answer echoes.
function clueLeaksAnswer(clueText: string, answer: string): boolean {
  const clueNorm = ` ${clueText.toLowerCase().replace(/[^a-z0-9\s]/g, " ")} `;
  const fullAnswer = normalizeAnswer(answer);
  if (fullAnswer.length >= 4 && clueText.toLowerCase().replace(/[^a-z0-9]/g, "").includes(fullAnswer)) {
    return true;
  }
  const words = answer
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  return words.some((w) => clueNorm.includes(` ${w} `));
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
        while (
          (seen.has(norm) || clueLeaksAnswer(clue.clue, clue.answer)) &&
          brief &&
          attempts < 3 &&
          regenerations < MAX_TOTAL_REGENERATIONS
        ) {
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
            console.error("Clue regeneration failed; keeping it as-is:", error);
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
    model: GENERATION_MODEL,
    max_tokens: 4096, // headroom for structured output — see generateCategories
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
// `name` is an optional creator-given title; when absent, UIs fall back to
// the board's category list so two custom boards never look identical.
export async function createCustomBoard(
  uid: string,
  titles: string[],
  roundCount: 1 | 2 = 1,
  name?: string
): Promise<string> {
  const board = await generateCustomBoard(titles, roundCount);
  const id = randomUUID().replace(/-/g, "").slice(0, 12);
  const cleanName = (name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  await db().collection(CUSTOM_BOARDS).doc(id).set({
    ownerUid: uid,
    name: cleanName || null,
    rounds: board.rounds,
    final: board.final ?? null,
    categoryTitles: board.rounds.flatMap((r) => r.categories.map((c) => c.title)),
    createdAt: FieldValue.serverTimestamp(),
  });
  return `custom-${id}`;
}

// Display label for a custom board: the creator's name for it, else its
// category list — never the bare, indistinguishable words "Custom board".
export function customBoardLabel(name: string | null | undefined, categoryTitles: string[]): string {
  const n = (name ?? "").trim();
  if (n) return n;
  if (categoryTitles.length === 0) return "Custom board";
  const shown = categoryTitles.slice(0, 3).join(" · ");
  return categoryTitles.length > 3 ? `${shown} …` : shown;
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

// A playable board key is a date (daily/historical board), a custom-board
// key, or a `hist-{date}` key — a historical episode whose air date collides
// with an existing daily board's (see jarchive-import.js and
// getBoardForDate's "hist-" branch below). Used by the play/judge/scores
// routes so every board kind flows through the same endpoints.
export function isValidBoardKey(key: string): boolean {
  return (
    isValidDateKey(key) ||
    /^custom-[A-Za-z0-9]{6,}$/.test(key) ||
    /^hist-\d{4}-\d{2}-\d{2}$/.test(key)
  );
}

const BOARDS = "jeopardyBoards";
const HISTORICAL_BOARDS = "historicalBoards";
const CUSTOM_BOARDS = "customBoards";

export interface BoardMeta {
  key: string;
  kind: "daily" | "historical" | "custom";
  date: string; // real YYYY-MM-DD for daily/historical; "" for custom
  categoryTitles: string[];
  showNumber?: number; // historical only
  name?: string; // custom only
}

// Lightweight board summary for SEO metadata — a single projected read (just
// the fields a title/description needs), not the full board with clues.
// Resolves the key the same way getBoardForDate does.
// Projected single-doc read: a field projection (.select) is only available on
// a query, not a DocumentReference, so we query the collection by document id.
async function projectDoc(
  collection: string,
  id: string,
  fields: string[]
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  const snap = await db()
    .collection(collection)
    .where(FieldPath.documentId(), "==", id)
    .select(...fields)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

export async function getBoardMeta(key: string): Promise<BoardMeta | null> {
  if (key.startsWith("custom-")) {
    const doc = await projectDoc(CUSTOM_BOARDS, key.slice(7), ["categoryTitles", "name"]);
    if (!doc) return null;
    return {
      key,
      kind: "custom",
      date: "",
      categoryTitles: (doc.get("categoryTitles") as string[] | undefined) ?? [],
      name: (doc.get("name") as string | null | undefined) ?? undefined,
    };
  }
  if (key.startsWith("hist-")) {
    const doc = await projectDoc(HISTORICAL_BOARDS, key, ["categoryTitles", "showNumber"]);
    if (!doc) return null;
    return {
      key,
      kind: "historical",
      date: key.slice(-10),
      categoryTitles: (doc.get("categoryTitles") as string[] | undefined) ?? [],
      showNumber: Number(doc.get("showNumber") ?? 0) || undefined,
    };
  }
  // Plain date: daily board first, then historical (matches getBoardForDate).
  const daily = await projectDoc(BOARDS, key, ["categoryTitles"]);
  if (daily) {
    return { key, kind: "daily", date: key, categoryTitles: (daily.get("categoryTitles") as string[] | undefined) ?? [] };
  }
  const hist = await projectDoc(HISTORICAL_BOARDS, key, ["categoryTitles", "showNumber"]);
  if (hist) {
    return {
      key,
      kind: "historical",
      date: key,
      categoryTitles: (hist.get("categoryTitles") as string[] | undefined) ?? [],
      showNumber: Number(hist.get("showNumber") ?? 0) || undefined,
    };
  }
  return null;
}

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

  // A historical episode whose air date collided with an existing daily
  // board's gets a "hist-" prefixed id instead of losing the date slot to
  // the daily board (see jarchive-import.js). The prefix already
  // unambiguously means "historical", so this skips the jeopardyBoards
  // check entirely — unlike the plain-date case below, there's no
  // ambiguity to resolve by priority.
  if (date.startsWith("hist-")) {
    const hist = await db().collection(HISTORICAL_BOARDS).doc(date).get();
    if (!hist.exists) return null;
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

  const ref = db().collection(BOARDS).doc(date);
  const snap = await ref.get();
  if (snap.exists) {
    const board = boardFromDoc(snap.data()!);
    memo.set(date, board);
    return board;
  }

  // Historical J-Archive boards are keyed by real air date (e.g. 1995-03-10).
  // Falling back here (after the daily-board check above) makes every real
  // episode fully playable/judgeable through the exact same flow — except
  // for a date that collides with a daily board, which never reaches this
  // point under its plain date at all; see the "hist-" branch above.
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
        clues: cat.clues.map(({ id, value, clue, dailyDouble, unrevealed }) => ({
          id,
          value,
          clue,
          dailyDouble,
          unrevealed,
        })),
      })),
    })),
    final: board.final ? { category: board.final.category, clue: board.final.clue } : undefined,
  };
}

// Never returns an unrevealed placeholder — callers (the judge routes, live
// resolve) treat "not found" and "never aired" identically: there's nothing
// to judge either way. This also makes findClue a safety net against a
// judge request naming an unrevealed clue's id directly, independent of
// currentRoundClueIds already excluding it from what's pickable.
export function findClue(
  board: Board,
  clueId: string
): { clue: Clue; category: Category; roundIndex: number } | null {
  for (let roundIndex = 0; roundIndex < board.rounds.length; roundIndex++) {
    for (const category of board.rounds[roundIndex].categories) {
      const clue = category.clues.find((c) => c.id === clueId && !c.unrevealed);
      if (clue) return { clue, category, roundIndex };
    }
  }
  return null;
}

// Excludes unrevealed placeholders — they can never be answered, so counting
// them would make a historical board with a gap permanently "unfinished"
// (this gates score submission in /api/scores).
export function totalClueCount(board: Board): number {
  const gridClues = board.rounds.reduce(
    (n, round) =>
      n + round.categories.reduce((m, cat) => m + cat.clues.filter((c) => !c.unrevealed).length, 0),
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
// Runs a judge request against JUDGE_MODEL, falling back once to
// JUDGE_FALLBACK_MODEL if the primary errors, so a single model's failure
// (e.g. the Haiku effort-param 400) degrades to a pricier judgment instead of
// blocking the answer. No `effort` param: Haiku 4.5 rejects it with a 400, and
// it's already a fast, low-cost model, so there's nothing to dial down.
async function runJudge(system: string, userContent: string): Promise<{ correct: boolean; comment: string }> {
  const params = {
    // Headroom so neither Haiku nor the Sonnet fallback thrashes near a tight
    // cap on structured output (see generateCategories). The verdict is tiny,
    // so actual usage — and cost — stays low regardless of the ceiling.
    max_tokens: 2048,
    output_config: { format: { type: "json_schema" as const, schema: JUDGE_SCHEMA } },
    system,
    messages: [{ role: "user" as const, content: userContent }],
  };
  try {
    return parseJson(await client().messages.create({ model: JUDGE_MODEL, ...params }));
  } catch (error) {
    console.error(`Judge model ${JUDGE_MODEL} failed; retrying on ${JUDGE_FALLBACK_MODEL}:`, error);
    return parseJson(await client().messages.create({ model: JUDGE_FALLBACK_MODEL, ...params }));
  }
}

export async function judgeAnswer(
  category: { title: string },
  clue: { clue: string; answer: string; acceptable: string[] },
  playerAnswer: string
): Promise<{ correct: boolean; comment: string }> {
  return runJudge(
    "You judge answers for a Jeopardy!-style trivia game. Be lenient the way a human host is: accept last names alone, obvious misspellings, missing articles, answers with or without the \"what is / who is\" framing, and answers that contain the essential words of the correct response even if reordered. Exception: when the category is about rhyme, wordplay, spelling, sequence, or word order, the order IS the answer, so a reordered response is wrong. Reject answers that are genuinely a different thing, too vague, or hedged lists of guesses. Your comment is one short, playful sentence addressed to the player — never reveal information beyond whether they were right and the correct answer.",
    `Category: ${category.title}
Clue: ${clue.clue}
Correct answer: ${clue.answer}
Also acceptable: ${clue.acceptable.length ? clue.acceptable.join("; ") : "(none listed)"}

Player's response: ${JSON.stringify(playerAnswer)}

Was the player correct?`
  );
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
  return runJudge(
    "You are reviewing an APPEALED ruling in a Jeopardy!-style game — the player's answer was marked wrong and they're contesting it. They may include a reason explaining why they think they're right; weigh it fairly but don't accept a wrong answer just because they argue well. Reconsider generously and give the benefit of the doubt on genuinely close calls: if the response is a defensible match — a valid alternate name, phrasing, spelling, or close-enough form — rule it CORRECT. Only uphold the rejection if the answer is genuinely a different thing or clearly wrong (including a reordered answer when the category is about rhyme, wordplay, or sequence). Your comment is one short, friendly sentence explaining the appeal decision.",
    `Category: ${category.title}
Clue: ${clue.clue}
Correct answer: ${clue.answer}
Also acceptable: ${clue.acceptable.length ? clue.acceptable.join("; ") : "(none listed)"}

Player's response: ${JSON.stringify(playerAnswer)}
Player's appeal reason: ${cleanReason ? JSON.stringify(cleanReason) : "(none given)"}

On appeal, should this count as correct?`
  );
}
