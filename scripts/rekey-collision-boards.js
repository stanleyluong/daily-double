/*
 * One-off: re-key historicalBoards docs whose plain-date id collides with an
 * existing jeopardyBoards (daily AI board) date, moving them to a
 * "hist-{date}" id instead of losing them. See jarchive-import.js (which now
 * does this automatically for new imports) and getBoardForDate's "hist-"
 * branch in jeopardy.ts for why this collision matters: getBoardForDate
 * always resolves a plain date to the daily board first, so the historical
 * episode is unreachable under the shared date until it has its own key.
 *
 * Copies the document body verbatim (nothing in it encodes its own key) to
 * the new id, then deletes the old one. Idempotent — skips any date that no
 * longer collides or has already been moved.
 *
 * Usage:
 *   node scripts/rekey-collision-boards.js --dry   # report only, no writes
 *   node scripts/rekey-collision-boards.js         # actually write
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS (Admin SDK).
 */

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const dry = process.argv.includes("--dry");

const db = getFirestore(initializeApp({ credential: applicationDefault() }));

async function main() {
  const dailyDocs = await db.collection("jeopardyBoards").select().get();
  const dailyDates = new Set(dailyDocs.docs.map((d) => d.id));

  const histDocs = await db.collection("historicalBoards").select().get();
  const colliding = histDocs.docs.map((d) => d.id).filter((id) => dailyDates.has(id));

  console.log(`Found ${colliding.length} colliding date(s): ${colliding.join(", ") || "(none)"}`);

  for (const date of colliding) {
    const newId = `hist-${date}`;
    console.log(`${dry ? "[dry] would move" : "moving"}: historicalBoards/${date} -> historicalBoards/${newId}`);
    if (!dry) {
      const snap = await db.collection("historicalBoards").doc(date).get();
      await db.collection("historicalBoards").doc(newId).set(snap.data());
      await db.collection("historicalBoards").doc(date).delete();
    }
  }

  console.log(`\n${dry ? "Would move" : "Moved"} ${colliding.length} board(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
