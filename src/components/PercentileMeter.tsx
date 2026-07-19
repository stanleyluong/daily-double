"use client";

import { useEffect, useState } from "react";

interface Props {
  fillFraction: number; // 0..1
  topPercent: number;
  isFirst: boolean;
  isSolo: boolean;
}

const SIZE = 132;
const STROKE = 14;
const R = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;

// A single-ratio meter, not a categorical pie: one hue (gold) for the fill,
// the same hue at low opacity for the track, per the design system's meter
// spec. Animates in on mount so the reveal reads as a result, not a static gauge.
export default function PercentileMeter({ fillFraction, topPercent, isFirst, isSolo }: Props) {
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setAnimated(fillFraction));
    return () => cancelAnimationFrame(raf);
  }, [fillFraction]);

  const offset = CIRCUMFERENCE * (1 - animated);

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={
        isSolo
          ? "First player on today's board"
          : isFirst
            ? "Highest score today"
            : `Beat ${100 - topPercent}% of today's players — top ${topPercent}%`
      }>
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="var(--gold)"
          strokeOpacity={0.18}
          strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="var(--gold)"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{ transition: "stroke-dashoffset 900ms ease-out" }}
        />
        <text
          x="50%"
          y="47%"
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-foreground font-sans font-semibold"
          style={{ fontSize: 26 }}
        >
          {isSolo ? "1st" : isFirst ? "#1" : `${100 - topPercent}%`}
        </text>
        <text
          x="50%"
          y="66%"
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-blue-200/60 font-sans"
          style={{ fontSize: 10, letterSpacing: "0.04em" }}
        >
          {isSolo || isFirst ? "TODAY" : "PERCENTILE"}
        </text>
      </svg>
      <p className="text-sm text-blue-200/80">
        {isSolo
          ? "You're the first to play today's board."
          : isFirst
            ? "Top score on today's board!"
            : `You're in the top ${topPercent}% today.`}
      </p>
    </div>
  );
}
