"use client";

// Route error boundary — replaces Next.js's raw error screen when a page
// throws at runtime. Must be a Client Component and accept `reset`, which
// re-renders the failed segment so a transient error can recover in place.
import { useEffect } from "react";
import Link from "next/link";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Route error boundary caught:", error);
  }, [error]);

  return (
    <div className="flex flex-1 min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-6xl md:text-7xl tracking-widest text-gold mb-3">Yikes</p>
      <p className="font-display text-2xl tracking-wide text-blue-100 mb-2">Something went wrong</p>
      <p className="text-blue-200/70 max-w-sm mb-8">
        That wasn&apos;t supposed to happen. Try again — if it keeps happening, head back to the board.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={reset}
          className="font-display text-lg tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-6 py-2.5 rounded"
        >
          Try again
        </button>
        <Link
          href="/"
          className="font-display text-lg tracking-wider bg-board hover:bg-board-deep text-gold border border-[color:var(--hairline-strong)] px-6 py-2.5 rounded"
        >
          Today&apos;s board
        </Link>
      </div>
    </div>
  );
}
