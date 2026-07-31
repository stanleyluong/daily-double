import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Game from "@/components/Game";
import { getBoardMeta, type BoardMeta } from "@/lib/jeopardy";

// Accepts a plain date or a "hist-" prefixed collision-safe historical key
// (see jarchive-import.js) — never a custom-{id} key, those route to /custom.
const DATE_RE = /^(?:hist-)?\d{4}-\d{2}-\d{2}$/;

function longDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// SEO title/description built from the board's real categories, so a search
// like "jeopardy shakespeare category 2005" can surface the exact board.
function seoText(meta: BoardMeta): { title: string; description: string; heading: string; sub: string } {
  const cats = meta.categoryTitles.filter(Boolean);
  const catList = cats.slice(0, 6).join(", ") + (cats.length > 6 ? "…" : "");
  const day = meta.date ? longDate(meta.date) : "";
  if (meta.kind === "historical") {
    const show = meta.showNumber ? ` (Show #${meta.showNumber})` : "";
    return {
      title: `Jeopardy! — ${day}${show}: ${cats.slice(0, 4).join(", ")} | Daily Double`,
      description: `Play the real Jeopardy! episode that aired ${day}${show}. Categories: ${catList}. Answer every clue — written history, judged by AI.`,
      heading: `Real Jeopardy! Episode`,
      sub: `Aired ${day}${show}`,
    };
  }
  return {
    title: `AI Jeopardy board — ${day}: ${cats.slice(0, 4).join(", ")} | Daily Double`,
    description: `Play the AI-generated Daily Double board from ${day}. Categories: ${catList}. Two rounds, 60 clues, judged by AI.`,
    heading: `Daily Board`,
    sub: day,
  };
}

export async function generateMetadata({ params }: { params: Promise<{ date: string }> }): Promise<Metadata> {
  const { date } = await params;
  if (!DATE_RE.test(date)) return { title: "Board not found — Daily Double" };
  const meta = await getBoardMeta(date).catch(() => null);
  const url = `/boards/${date}`;
  if (!meta) {
    const display = date.slice(-10);
    return { title: `${display} board — Daily Double`, alternates: { canonical: url } };
  }
  const { title, description } = seoText(meta);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, type: "website", url },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PastBoardPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!DATE_RE.test(date)) notFound();
  const meta = await getBoardMeta(date).catch(() => null);
  if (!meta) notFound();

  const { description, heading, sub } = seoText(meta);
  const cats = meta.categoryTitles.filter(Boolean);

  // JSON-LD so crawlers get structured board info even though the interactive
  // board itself renders client-side.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Game",
    name: meta.kind === "historical" ? `Jeopardy! — ${sub}` : `Daily Double board — ${sub}`,
    description,
    genre: "Trivia",
    ...(cats.length ? { keywords: cats.join(", ") } : {}),
  };

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <main className="flex-1 w-full px-4 md:px-8 py-10">
        {/* Server-rendered so search engines see real content (categories, air
            date) rather than only the client-rendered board. */}
        <header className="text-center mb-8">
          <p className="font-display tracking-wider text-gold/80 text-sm uppercase">{heading}</p>
          <h1 className="font-display text-4xl md:text-6xl tracking-wider text-gold mt-1">Daily Double</h1>
          {sub && <p className="text-blue-200/80 mt-2">{sub}</p>}
          {cats.length > 0 && (
            <p className="text-blue-200/60 text-sm mt-2 max-w-2xl mx-auto">Categories: {cats.join(" · ")}</p>
          )}
          <p className="text-blue-200/70 mt-3 text-sm">
            <Link href="/archive" className="text-gold/80 hover:text-gold underline">
              Browse the archive
            </Link>{" "}
            ·{" "}
            <Link href="/" className="text-gold/80 hover:text-gold underline">
              Today&apos;s board
            </Link>
          </p>
        </header>
        <Game date={date} />
      </main>
      <footer className="text-center text-xs text-blue-200/60 py-6">
        Built by Stanley Luong · Historical clues via the J! Archive · Not affiliated with Jeopardy!
      </footer>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </div>
  );
}
