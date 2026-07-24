/*
 * One-off backfill for users/{uid}/playedBoards.
 *
 * The playedBoards ledger (src/lib/played.ts) was only added 2026-07-21 —
 * anything played before that date never got a doc written, so "Boards
 * you've played" is missing entries that "Completed" (backed by the older
 * users/{uid}/scores collection) still shows correctly.
 *
 * This walks every users/{uid}/scores/{date} doc via a collectionGroup
 * query and creates the matching playedBoards/{date} doc if it's missing.
 * Idempotent — safe to re-run; only ever fills gaps, never overwrites an
 * existing playedBoards doc's lastPlayedAt.
 *
 * Usage:
 *   node scripts/backfill-played-boards.js --dry   # report only, no writes
 *   node scripts/backfill-played-boards.js         # actually write
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS (Admin SDK).
 */

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const dry = process.argv.includes("--dry");

const db = getFirestore(initializeApp({ credential: applicationDefault() }));

function kindFor(key) {
  if (key.startsWith("custom-")) return "custom";
  return key < "2026-07-17" ? "historical" : "daily";
}

async function main() {
  // collectionGroup("scores") matches BOTH jeopardyBoards/{date}/scores/{uid}
  // (the leaderboard mirror) and users/{uid}/scores/{date} (the per-user
  // mirror) — same collection name, different parents. Only the second is
  // what we want; filter on the grandparent collection being "users".
  const scoreDocs = await db.collectionGroup("scores").get();
  const userScoreDocs = scoreDocs.docs.filter(
    (doc) => doc.ref.parent.parent?.parent?.id === "users"
  );
  console.log(
    `Found ${scoreDocs.size} "scores" doc(s) total; ${userScoreDocs.length} are users/{uid}/scores/{date} entries.`
  );

  let checked = 0;
  let filled = 0;
  let alreadyPresent = 0;
  let skippedNoUid = 0;

  for (const doc of userScoreDocs) {
    checked++;
    const uid = doc.ref.parent.parent?.id;
    if (!uid) {
      skippedNoUid++;
      continue;
    }
    const date = String(doc.get("date") ?? doc.id);
    const submittedAt = doc.get("submittedAt");

    const playedRef = db.collection("users").doc(uid).collection("playedBoards").doc(date);
    const existing = await playedRef.get();
    if (existing.exists) {
      alreadyPresent++;
      continue;
    }

    filled++;
    console.log(
      `${dry ? "[dry] would fill" : "filling"}: uid=${uid} date=${date} kind=${kindFor(date)}`
    );
    if (!dry) {
      await playedRef.set({
        boardKey: date,
        // Best available timestamp for "last played" — the score submission
        // time, falling back to now if for some reason it's missing.
        lastPlayedAt: submittedAt ?? new Date(),
      });
    }
  }

  console.log(
    `\nChecked ${checked} score doc(s): ${alreadyPresent} already had a playedBoards entry, ` +
      `${filled} ${dry ? "would be" : "were"} filled in, ${skippedNoUid} skipped (no uid).`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
