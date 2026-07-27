/*
 * One-off backfill for historicalBoards: normalize every category's `clues`
 * array to a dense 5-element array indexed by row, with an explicit
 * `unrevealed: true` placeholder for any clue that was never asked on the
 * original broadcast (the round ran out of time before it was played — see
 * jarchive-import.js's parseGame for the up-to-date scraper that now writes
 * these placeholders directly for anything imported from now on).
 *
 * The old scraper simply skipped an unrevealed clue instead of recording its
 * position, so a category missing a clue in the *middle* (not just at the
 * end) ended up with its later clues compacted one slot too early — e.g.
 * [$400, $800, $1200, $2000] instead of [$400, $800, $1200, null, $2000].
 * The client's board grid reads clues by array position (row), so this
 * silently displayed the $2000 clue in the $1600 slot and left the true
 * bottom row blank.
 *
 * This is pure computation from data already in Firestore — each existing
 * clue's own `id` (format "{roundIndex}-{col}-{row}") records its true row,
 * so no re-scraping is needed. Idempotent — a category already at length 5
 * is left untouched; safe to re-run.
 *
 * Usage:
 *   node scripts/backfill-unrevealed-clues.js --dry   # report only, no writes
 *   node scripts/backfill-unrevealed-clues.js         # actually write
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS (Admin SDK).
 */

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const dry = process.argv.includes("--dry");

const db = getFirestore(initializeApp({ credential: applicationDefault() }));

// Rebuilds one category's clues into a dense 5-slot array. Returns null if
// the category is already correct (length 5 already implies correct
// placement — a complete category's clues were pushed in row order by the
// original scraper with no gaps to misplace).
function fixCategory(cat, roundIndex, col) {
  if (cat.clues.length === 5) return null;

  const multiplier = roundIndex + 1;
  const byRow = new Map();
  for (const clue of cat.clues) {
    const row = Number(clue.id.split("-")[2]);
    byRow.set(row, clue);
  }

  const rebuilt = [];
  for (let row = 0; row < 5; row++) {
    const existing = byRow.get(row);
    if (existing) {
      rebuilt.push(existing);
    } else {
      rebuilt.push({
        id: `${roundIndex}-${col}-${row}`,
        value: (row + 1) * 200 * multiplier,
        unrevealed: true,
        clue: "",
        answer: "",
        acceptable: [],
        dailyDouble: false,
      });
    }
  }
  return rebuilt;
}

async function main() {
  const snap = await db.collection("historicalBoards").get();
  console.log(`Scanning ${snap.size} historicalBoards doc(s)...`);

  let docsChanged = 0;
  let categoriesFixed = 0;
  let batch = db.batch();
  let pending = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    let changed = false;
    const newRounds = data.rounds.map((round, roundIndex) => ({
      ...round,
      categories: round.categories.map((cat, col) => {
        const rebuilt = fixCategory(cat, roundIndex, col);
        if (!rebuilt) return cat;
        changed = true;
        categoriesFixed++;
        return { ...cat, clues: rebuilt };
      }),
    }));

    if (!changed) continue;
    docsChanged++;
    console.log(`${dry ? "[dry] would fix" : "fixing"}: ${doc.id}`);
    if (!dry) {
      batch.update(doc.ref, { rounds: newRounds });
      pending++;
      if (pending >= 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
  }
  if (pending > 0) await batch.commit();

  console.log(
    `\n${dry ? "Would fix" : "Fixed"} ${categoriesFixed} categor${categoriesFixed === 1 ? "y" : "ies"} across ${docsChanged} board(s).`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
