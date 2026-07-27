import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebaseAdmin";

// Durable, cross-instance spend guards for the model-calling paths — the
// backstop the in-memory rateLimit() (per-instance, resets on deploy, IP-only)
// can't provide. Everything here is a defense-in-depth layer *under* the hard
// spend cap set in the Anthropic Console, which is the real guarantee.
//
// Counters live at usageLimits/{scope}:{day} and are read+incremented inside a
// single transaction so concurrent requests can't race past a ceiling. State
// is keyed by day and simply stops being read after that day rolls over (old
// docs are harmless and tiny; a TTL policy could sweep them).

const COLLECTION = "usageLimits";

// Custom board generation is the most expensive path (~15 model calls per
// board, uncached), so it's capped three ways per Pacific day. IP and account
// are both enforced so one account can't rotate IPs and one IP can't be shared
// to multiply boards; the global cap bounds total spend even against a
// distributed / many-identity attack. Each global unit is one board (~15
// calls) — at 100/day that's ~1,500 generation calls/day worst case.
const IP_DAILY_CAP = 1;
const ACCOUNT_DAILY_CAP = 1;
const GLOBAL_DAILY_CAP = 100;

// Which ceiling a request hit, or "ok" if it was admitted (and all three
// counters incremented). The route maps each to its own message.
export type CustomBoardLimit = "ok" | "ip" | "account" | "global";

// Pacific day, matching the game's daily rollover (todayKey in jeopardy.ts).
// Duplicated here rather than imported to keep this module free of the heavy
// (Anthropic-importing) jeopardy module and avoid an import cycle.
function dayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

function countOf(snap: FirebaseFirestore.DocumentSnapshot): number {
  return (snap.exists ? (snap.get("count") as number | undefined) : 0) ?? 0;
}

// Atomically checks all three custom-board ceilings and, only if none is
// exceeded, increments all three. Doing it in one transaction (rather than
// three separate consume-or-deny checks) means a request never burns one
// counter's slot only to be rejected by another — either the board is
// admitted and all three tick up together, or nothing changes. Fail-open on a
// Firestore error: a limiter outage shouldn't take down board creation, and
// the Console spend cap still bounds the worst case.
export async function checkCustomBoardLimits(ip: string, uid: string): Promise<CustomBoardLimit> {
  const day = dayKey();
  const ipRef = db().collection(COLLECTION).doc(`custom-ip:${ip}:${day}`);
  const acctRef = db().collection(COLLECTION).doc(`custom-acct:${uid}:${day}`);
  const globalRef = db().collection(COLLECTION).doc(`custom-global:${day}`);
  try {
    return await db().runTransaction(async (tx) => {
      const [ipSnap, acctSnap, globalSnap] = await tx.getAll(ipRef, acctRef, globalRef);
      const ipCount = countOf(ipSnap);
      const acctCount = countOf(acctSnap);
      const globalCount = countOf(globalSnap);

      if (ipCount >= IP_DAILY_CAP) return "ip";
      if (acctCount >= ACCOUNT_DAILY_CAP) return "account";
      if (globalCount >= GLOBAL_DAILY_CAP) return "global";

      const stamp = { updatedAt: FieldValue.serverTimestamp() };
      tx.set(ipRef, { count: ipCount + 1, ...stamp }, { merge: true });
      tx.set(acctRef, { count: acctCount + 1, ...stamp }, { merge: true });
      tx.set(globalRef, { count: globalCount + 1, ...stamp }, { merge: true });
      return "ok";
    });
  } catch (error) {
    console.error("usageLimits checkCustomBoardLimits failed; allowing:", error);
    return "ok";
  }
}
