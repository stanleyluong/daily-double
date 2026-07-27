import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebaseAdmin";

// Durable, cross-instance spend guards for the model-calling paths — the
// backstop the in-memory rateLimit() (per-instance, resets on deploy, IP-only)
// can't provide. Everything here is a defense-in-depth layer *under* the hard
// spend cap set in the Anthropic Console, which is the real guarantee.
//
// Counters live at usageLimits/{scope}:{day} and are consumed inside a
// transaction so concurrent requests can't race past the ceiling. State is
// keyed by day and simply stops being read after that day rolls over (old
// docs are harmless; a TTL policy could sweep them, but they're tiny).

const COLLECTION = "usageLimits";

// Pacific day, matching the game's daily rollover (todayKey in jeopardy.ts).
// Duplicated here rather than imported to keep this module free of the heavy
// (Anthropic-importing) jeopardy module and avoid an import cycle.
function dayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

// Atomically increments today's counter for `scope` and returns whether the
// caller is still within `max`. Returns true (fail-open) if Firestore itself
// errors — a limiter outage should never take down board creation, and the
// Console spend cap still bounds the worst case.
async function consumeDaily(scope: string, max: number): Promise<boolean> {
  const ref = db().collection(COLLECTION).doc(`${scope}:${dayKey()}`);
  try {
    return await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const count = (snap.exists ? (snap.get("count") as number | undefined) : 0) ?? 0;
      if (count >= max) return false;
      tx.set(ref, { count: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
  } catch (error) {
    console.error(`usageLimits consumeDaily(${scope}) failed; allowing:`, error);
    return true;
  }
}

// One custom board per IP per Pacific day. Custom board generation is the most
// expensive path (~15 model calls per board, uncached), so this is the primary
// per-caller guard. Consume this BEFORE the global check so a single IP
// retrying can't burn through the global ceiling on denied attempts.
export function allowCustomBoardForIp(ip: string): Promise<boolean> {
  return consumeDaily(`custom-ip:${ip}`, 1);
}

// Hard ceiling on custom-board generations across ALL callers per day, so total
// spend stays bounded even under a distributed / many-IP attack that slips past
// the per-IP limit. Tune to your budget: each unit here is one custom board
// (~15 model calls). At 100/day that's ~1,500 generation calls/day worst case.
const GLOBAL_CUSTOM_CAP = 100;
export function allowGlobalCustomBoard(): Promise<boolean> {
  return consumeDaily("custom-global", GLOBAL_CUSTOM_CAP);
}
