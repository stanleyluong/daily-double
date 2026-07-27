"use client";

// Shared pill-button filter row — Archive (kind) and History (type/progress)
// both had their own copy of this same markup with a couple of pixels'
// difference in padding. One component now, one look everywhere it's used.
export default function FilterPills<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`font-display text-sm tracking-wide px-3.5 py-1.5 rounded-full border transition-colors ${
            value === o.value
              ? "bg-gold text-board-deep border-gold"
              : "border-blue-300/30 text-blue-200/70 hover:text-blue-100 hover:border-blue-300/50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
