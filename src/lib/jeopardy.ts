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
}

export interface Category {
  title: string;
  clues: Clue[];
}

export interface Board {
  boardId: string;
  date: string;
  categories: Category[];
}

// What the browser is allowed to see — no answers.
export interface PublicClue {
  id: string;
  value: number;
  clue: string;
}

export interface PublicBoard {
  boardId: string;
  date: string;
  categories: { title: string; clues: PublicClue[] }[];
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

async function generateCategories(date: string): Promise<{ title: string; theme: string }[]> {
  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 1024,
    output_config: { format: { type: "json_schema", schema: CATEGORIES_SCHEMA } },
    system:
      "You are the head writer for a Jeopardy!-style trivia game. You write clever, varied boards for a general audience.",
    messages: [
      {
        role: "user",
        content: `Create exactly 6 categories for the daily board of ${date}.

Requirements:
- A diverse mix across the 6: at least one from history/geography/science, one from arts/literature, one from pop culture/sports/food, and one wordplay or gimmick category (e.g. all answers share a letter, rhyme, or contain a hidden word).
- Titles are short and punchy, puns welcome, ALL CAPS not required.
- For each category, write a one-sentence "theme" that a clue writer would use to stay on-brief (for gimmick categories, state the gimmick precisely).
- Vary topics day to day; let the date seed your choices but never mention the date in titles.`,
      },
    ],
  });
  const { categories } = parseJson<{ categories: { title: string; theme: string }[] }>(message);
  if (!Array.isArray(categories) || categories.length < 6) {
    throw new Error("Model returned fewer than 6 categories");
  }
  return categories.slice(0, 6);
}

async function generateClues(category: { title: string; theme: string }): Promise<
  { clue: string; answer: string; acceptable: string[] }[]
> {
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
- Order from easiest (worth $200) to hardest (worth $1000). $200 should be gettable by most people; $1000 should challenge a trivia fan.
- Answers must be short (a name, term, title, or place — not a sentence) and factually correct beyond doubt. Do not write clues you are not certain about.
- "acceptable" lists alternate correct forms: last name only, common nicknames, alternate spellings, with/without articles. Empty array if none.
- Never include the answer text inside its own clue.`,
      },
    ],
  });
  const { clues } = parseJson<{ clues: { clue: string; answer: string; acceptable: string[] }[] }>(message);
  if (!Array.isArray(clues) || clues.length < 5) {
    throw new Error(`Model returned fewer than 5 clues for "${category.title}"`);
  }
  return clues.slice(0, 5);
}

// One board is ~30 clues. Generating it in a single request runs long enough
// to threaten Amplify's SSR response window, so we fan out: one fast call for
// categories, then all 6 clue calls in parallel.
async function generateBoard(date: string): Promise<Board> {
  const categoryBriefs = await generateCategories(date);
  const clueSets = await Promise.all(categoryBriefs.map((c) => generateClues(c)));

  const categories: Category[] = categoryBriefs.map((brief, c) => ({
    title: brief.title,
    clues: clueSets[c].map((raw, r) => ({
      id: `${c}-${r}`,
      value: (r + 1) * 200,
      clue: raw.clue,
      answer: raw.answer,
      acceptable: raw.acceptable ?? [],
    })),
  }));

  return { boardId: randomUUID(), date, categories };
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

const BOARDS = "jeopardyBoards";

// Boards are immutable once written, so a per-instance memo is safe and keeps
// judge calls from re-reading Firestore on every answer.
const memo = new Map<string, Board>();

function boardFromDoc(data: FirebaseFirestore.DocumentData): Board {
  return { boardId: data.boardId, date: data.date, categories: data.categories };
}

// Returns the board for a date: from memo, then Firestore. Only today's board
// is generated on demand — a past date with no stored board never existed.
export async function getBoardForDate(date: string): Promise<Board | null> {
  const cached = memo.get(date);
  if (cached) return cached;

  const ref = db().collection(BOARDS).doc(date);
  const snap = await ref.get();
  if (snap.exists) {
    const board = boardFromDoc(snap.data()!);
    memo.set(date, board);
    return board;
  }

  if (date !== todayKey()) return null;

  const board = await generateBoard(date);
  try {
    await ref.create({
      boardId: board.boardId,
      date: board.date,
      categories: board.categories,
      categoryTitles: board.categories.map((c) => c.title),
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
    categories: board.categories.map((cat) => ({
      title: cat.title,
      clues: cat.clues.map(({ id, value, clue }) => ({ id, value, clue })),
    })),
  };
}

export function findClue(board: Board, clueId: string): { clue: Clue; category: Category } | null {
  for (const category of board.categories) {
    const clue = category.clues.find((c) => c.id === clueId);
    if (clue) return { clue, category };
  }
  return null;
}

export async function judgeAnswer(
  category: Category,
  clue: Clue,
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
      "You judge answers for a Jeopardy!-style trivia game. Be lenient the way a human host is: accept last names alone, obvious misspellings, missing articles, and answers with or without the \"what is / who is\" framing. Reject answers that are genuinely a different thing, too vague, or hedged lists of guesses. Your comment is one short, playful sentence addressed to the player — never reveal information beyond whether they were right and the correct answer.",
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
