import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Not found — Daily Double",
};

export default function NotFound() {
  return (
    <div className="flex flex-1 min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-7xl md:text-8xl tracking-widest text-gold mb-3">404</p>
      <p className="font-display text-2xl tracking-wide text-blue-100 mb-2">This clue isn&apos;t on the board</p>
      <p className="text-blue-200/70 max-w-sm mb-8">
        The page you&apos;re after doesn&apos;t exist — or it never aired. Head back and pick another.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="font-display text-lg tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-6 py-2.5 rounded"
        >
          Today&apos;s board
        </Link>
        <Link
          href="/archive"
          className="font-display text-lg tracking-wider bg-board hover:bg-board-deep text-gold border border-[color:var(--hairline-strong)] px-6 py-2.5 rounded"
        >
          Browse the archive
        </Link>
      </div>
    </div>
  );
}
