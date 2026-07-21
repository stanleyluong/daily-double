"use client";

// Tiny synthesized sound effects via the Web Audio API — no audio files to
// host, no external requests. Lazily creates one AudioContext on first play
// (after a user gesture, so autoplay policies are satisfied), and honors a
// persisted mute toggle.

const MUTE_KEY = "daily-double-muted";

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

export function isMuted(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(MUTE_KEY) === "1";
}

export function setMuted(v: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(MUTE_KEY, v ? "1" : "0");
}

type OscType = "sine" | "square" | "sawtooth" | "triangle";

function tone(freq: number, start: number, dur: number, type: OscType = "sine", peak = 0.16): void {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = c.currentTime + start;
  // Short attack + exponential release, so notes don't click.
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export type SoundName = "tick" | "go" | "correct" | "wrong" | "timeup" | "win" | "lose" | "pick";

const RECIPES: Record<SoundName, () => void> = {
  tick: () => tone(520, 0, 0.09, "triangle", 0.12),
  go: () => tone(720, 0, 0.16, "sine", 0.18),
  correct: () => {
    tone(523, 0, 0.14, "sine"); // C5
    tone(659, 0.1, 0.16, "sine"); // E5
    tone(784, 0.2, 0.28, "sine"); // G5
  },
  wrong: () => {
    tone(196, 0, 0.32, "sawtooth", 0.14);
    tone(146, 0.06, 0.34, "sawtooth", 0.12);
  },
  timeup: () => tone(220, 0, 0.5, "square", 0.12),
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.13, 0.22, "sine", 0.18));
  },
  lose: () => {
    [392, 330, 262].forEach((f, i) => tone(f, i * 0.16, 0.3, "triangle", 0.14));
  },
  pick: () => tone(880, 0, 0.1, "triangle", 0.14),
};

export function playSound(name: SoundName): void {
  if (isMuted()) return;
  try {
    RECIPES[name]();
  } catch {
    /* audio unavailable — silent no-op */
  }
}
