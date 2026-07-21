/*
 * J-Archive importer for Daily Double.
 *
 * Scrapes real Jeopardy! games from j-archive.com (a fan-run archive; this app
 * is "Not affiliated with Jeopardy!") and stores them as boards keyed by air
 * date in the `historicalBoards` Firestore collection, in the same shape the
 * app already plays. Respectful by design: a slow, fixed delay between page
 * fetches and a descriptive User-Agent. Run OFFLINE (from a dev machine),
 * never in a request path.
 *
 * Usage:
 *   node scripts/jarchive-import.js --file <path>          # parse one saved page (dev/test)
 *   node scripts/jarchive-import.js --game <id> --dry      # fetch+parse one game, print, don't write
 *   node scripts/jarchive-import.js --from <id> --count <n>  # import a range (writes Firestore)
 *
 * Firestore writes require GOOGLE_APPLICATION_CREDENTIALS (Admin SDK).
 */

const DELAY_MS = 2500; // be gentle with a small fan site
const UA = "Mozilla/5.0 (compatible; DailyDoubleImport/1.0; personal hobby project; contact via github.com/stanleyluong)";

const ROUND_KEY = { J: 0, DJ: 1 };

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#0?160;/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function stripTags(s) {
  return decodeEntities(
    s
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\s+/g, " ")
    .trim();
}

// Extract the inner HTML of the <td id="..."> ... </td> for a given clue id.
function tdInner(html, id) {
  const start = html.indexOf(`id="${id}"`);
  if (start === -1) return null;
  const gt = html.indexOf(">", start);
  const end = html.indexOf("</td>", gt);
  if (gt === -1 || end === -1) return null;
  return html.slice(gt + 1, end);
}

function correctResponse(html, id) {
  // The response cell can contain a nested table (players' responses) before
  // the correct-response <em>, so we forward-search from the cell's id rather
  // than relying on the first </td>. Bounded so it can't reach another clue.
  const rid = html.indexOf(`id="${id}_r"`);
  if (rid === -1) return null;
  const m = html.slice(rid, rid + 8000).match(/<em class="correct_response">([\s\S]*?)<\/em>/);
  return m ? stripTags(m[1]) : null;
}

// Is the clue at this id a Daily Double? Its value cell sits just after the
// clue_text inside the same clue container.
function isDailyDouble(html, id) {
  const idPos = html.indexOf(`id="${id}"`);
  if (idPos === -1) return false;
  const window = html.slice(idPos, idPos + 900);
  return /clue_value_daily_double/.test(window);
}

function parseGame(html, gameId) {
  const titleM = html.match(/<title>[^<]*Show #(\d+), aired (\d{4}-\d{2}-\d{2})/);
  if (!titleM) throw new Error("no title/date");
  const showNumber = Number(titleM[1]);
  const airDate = titleM[2];

  const cats = [...html.matchAll(/class="category_name">([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]));
  // 6 (J) + 6 (DJ) + 1 (FJ) when a game is complete.
  if (cats.length < 13) throw new Error(`only ${cats.length} categories (incomplete game)`);

  const rounds = [];
  for (const [key, roundIndex] of Object.entries(ROUND_KEY)) {
    const catOffset = roundIndex * 6;
    const multiplier = roundIndex + 1;
    const categories = [];
    for (let col = 1; col <= 6; col++) {
      const title = cats[catOffset + col - 1];
      const clues = [];
      for (let row = 1; row <= 5; row++) {
        const id = `clue_${key}_${col}_${row}`;
        const rawText = tdInner(html, id);
        if (rawText === null) continue; // unrevealed / missing cell
        const answer = correctResponse(html, id);
        if (answer === null) continue;
        clues.push({
          id: `${roundIndex}-${col - 1}-${row - 1}`,
          value: row * 200 * multiplier, // normalized to the app's scale
          clue: stripTags(rawText),
          answer,
          acceptable: [],
          dailyDouble: isDailyDouble(html, id),
        });
      }
      categories.push({ title, clues });
    }
    rounds.push({ name: roundIndex === 0 ? "Jeopardy!" : "Double Jeopardy!", categories });
  }

  // Final Jeopardy
  const fjText = tdInner(html, "clue_FJ");
  const fjAnswer = correctResponse(html, "clue_FJ");
  const final =
    fjText && fjAnswer ? { category: cats[12], clue: stripTags(fjText), answer: fjAnswer, acceptable: [] } : null;

  const categoryTitles = [...rounds.flatMap((r) => r.categories.map((c) => c.title)), ...(final ? [final.category] : [])];

  return {
    source: "j-archive",
    gameId,
    showNumber,
    airDate,
    rounds,
    final,
    categoryTitles,
    categoriesLower: categoryTitles.map((c) => c.toLowerCase()),
  };
}

async function fetchGame(gameId) {
  const res = await fetch(`https://www.j-archive.com/showgame.php?game_id=${gameId}`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const dry = args.includes("--dry");

  if (arg("file")) {
    const fs = require("fs");
    const board = parseGame(fs.readFileSync(arg("file"), "utf8"), 0);
    console.log(JSON.stringify(board, null, 2));
    return;
  }

  // Firestore only needed for real writes.
  let db = null;
  if (!dry) {
    const { initializeApp, applicationDefault } = require("firebase-admin/app");
    const { getFirestore } = require("firebase-admin/firestore");
    db = getFirestore(initializeApp({ credential: applicationDefault() }));
  }

  const from = Number(arg("from") ?? arg("game"));
  const count = Number(arg("count") ?? 1);
  let ok = 0,
    skip = 0;
  for (let gid = from; gid < from + count; gid++) {
    try {
      const html = await fetchGame(gid);
      const board = parseGame(html, gid);
      if (dry) {
        console.log(`game ${gid}: ${board.airDate} — ${board.categoryTitles.length} categories`);
      } else {
        await db.collection("historicalBoards").doc(board.airDate).set(board, { merge: true });
        console.log(`✓ ${gid} → ${board.airDate}`);
      }
      ok++;
    } catch (e) {
      console.log(`· ${gid} skipped: ${e.message}`);
      skip++;
    }
    await sleep(DELAY_MS);
  }
  console.log(`\nDone. ${ok} imported, ${skip} skipped.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
