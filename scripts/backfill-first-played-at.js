/*
 * One-off backfill for users/{uid}/playedBoards/{key}.firstPlayedAt.
 *
 * markPlayed() (src/lib/played.ts) only started writing firstPlayedAt on
 * this deploy — existing playedBoards docs never got it and never will (the
 * .create()-first logic always falls through to .set(merge) for a doc that
 * already exists). Backfills firstPlayedAt = lastPlayedAt for any doc
 * missing it — not the true original start time, but the closest thing we
 * have, and far better than "Created" showing blank forever.
 *
 * Usage:
 *   node scripts/backfill-first-played-at.js --dry
 *   node scripts/backfill-first-played-at.js
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS (Admin SDK).
 */

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const dry = process.argv.includes("--dry");
const db = getFirestore(initializeApp({ credential: applicationDefault() }));

async function main() {
  const snap = await db.collectionGroup("playedBoards").get();
  console.log(`Found ${snap.size} playedBoards doc(s) across all users.`);

  let filled = 0;
  let alreadyPresent = 0;
  let skippedNoLastPlayed = 0;

  for (const doc of snap.docs) {
    if (doc.get("firstPlayedAt")) {
      alreadyPresent++;
      continue;
    }
    const lastPlayedAt = doc.get("lastPlayedAt");
    if (!lastPlayedAt) {
      skippedNoLastPlayed++;
      continue;
    }
    const uid = doc.ref.parent.parent?.id;
    filled++;
    console.log(`${dry ? "[dry] would fill" : "filling"}: uid=${uid} boardKey=${doc.id}`);
    if (!dry) {
      await doc.ref.set({ firstPlayedAt: lastPlayedAt }, { merge: true });
    }
  }

  console.log(
    `\n${alreadyPresent} already had firstPlayedAt, ${filled} ${dry ? "would be" : "were"} filled in, ` +
      `${skippedNoLastPlayed} skipped (no lastPlayedAt either).`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
