/*
 * Pre-deploy model smoke test. Makes one real API call of each shape the app
 * uses — a generation call (Sonnet, structured output) and a judge call
 * (Haiku, structured output) — and fails loudly if either is rejected.
 *
 * This exists because a model/param incompatibility (like Haiku 4.5 rejecting
 * the `output_config.effort` parameter) passes typecheck and build but 400s at
 * the real API — the only way to catch it before production is to actually
 * call it. Costs a few cents. Mirrors the exact request shapes in
 * src/lib/jeopardy.ts; keep them in sync if those change.
 *
 * Usage: ANTHROPIC_API_KEY=... node scripts/smoke-models.mjs
 * (or rely on .env.local being loaded, e.g. `node --env-file=.env.local scripts/smoke-models.mjs`)
 */

import Anthropic from "@anthropic-ai/sdk";

const GENERATION_MODEL = "claude-sonnet-5";
const JUDGE_MODEL = "claude-haiku-4-5";

const client = new Anthropic();

const GEN_SCHEMA = {
  type: "object",
  properties: { clue: { type: "string" }, answer: { type: "string" } },
  required: ["clue", "answer"],
  additionalProperties: false,
};
const JUDGE_SCHEMA = {
  type: "object",
  properties: { correct: { type: "boolean" }, comment: { type: "string" } },
  required: ["correct", "comment"],
  additionalProperties: false,
};

function textOf(message) {
  const block = message.content.find((b) => b.type === "text");
  if (!block) throw new Error(`no text block (stop_reason: ${message.stop_reason})`);
  return JSON.parse(block.text);
}

async function checkGeneration() {
  const message = await client.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 512,
    output_config: { format: { type: "json_schema", schema: GEN_SCHEMA } },
    system: "You write one Jeopardy clue.",
    messages: [{ role: "user", content: "Write one easy clue about the sky and its answer." }],
  });
  const out = textOf(message);
  if (typeof out.clue !== "string" || typeof out.answer !== "string") {
    throw new Error(`generation returned unexpected shape: ${JSON.stringify(out)}`);
  }
  return out;
}

async function checkJudge() {
  const message = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 512,
    output_config: { format: { type: "json_schema", schema: JUDGE_SCHEMA } },
    system: "You judge a trivia answer. Reply with correct (bool) and a one-sentence comment.",
    messages: [{ role: "user", content: "Correct answer: Paris. Player: paris. Correct?" }],
  });
  const out = textOf(message);
  if (typeof out.correct !== "boolean" || typeof out.comment !== "string") {
    throw new Error(`judge returned unexpected shape: ${JSON.stringify(out)}`);
  }
  return out;
}

async function main() {
  let failed = false;
  for (const [name, fn] of [
    [`generation (${GENERATION_MODEL})`, checkGeneration],
    [`judge (${JUDGE_MODEL})`, checkJudge],
  ]) {
    try {
      const out = await fn();
      console.log(`✓ ${name} OK — ${JSON.stringify(out)}`);
    } catch (e) {
      failed = true;
      console.error(`✗ ${name} FAILED — ${e.status ?? ""} ${e.message}`);
    }
  }
  if (failed) {
    console.error("\nSmoke test failed — do not deploy.");
    process.exit(1);
  }
  console.log("\nAll model calls succeeded.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
