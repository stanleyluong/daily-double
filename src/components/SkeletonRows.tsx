// Animated placeholder rows for a loading table/list — same bg-board
// animate-pulse block style already used for the home board's skeleton
// (src/components/Game.tsx), staggered the same way so a page that's
// about to show a table reads as "loading that table" instead of just
// going blank until data arrives.
export default function SkeletonRows({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-lg border border-board overflow-hidden divide-y divide-board" aria-hidden>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className="h-4 rounded-sm bg-board animate-pulse"
              style={{
                width: c === 0 ? "32%" : `${68 / (cols - 1)}%`,
                animationDelay: `${(r * cols + c) * 40}ms`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
