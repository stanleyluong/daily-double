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

// Sound effects (correct/wrong/daily-double/final cues, etc.) and the main
// theme (music) mute independently, so you can silence the music but keep the
// effects, or vice versa.
export function isMuted(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(MUTE_KEY) === "1";
}

export function setMuted(v: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(MUTE_KEY, v ? "1" : "0");
}

const MUSIC_MUTE_KEY = "daily-double-music-muted";

export function isMusicMuted(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(MUSIC_MUTE_KEY) === "1";
}

export function setMusicMuted(v: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(MUSIC_MUTE_KEY, v ? "1" : "0");
}

// Per-channel volume (0–1), independent of the mute toggles above — muting
// hides a channel entirely; volume scales it while still on.
const SFX_VOLUME_KEY = "daily-double-sfx-volume";
const MUSIC_VOLUME_KEY = "daily-double-music-volume";

function readVolume(key: string): number {
  if (typeof window === "undefined") return 1;
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 1;
}
function writeVolume(key: string, v: number): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, String(Math.min(1, Math.max(0, v))));
}

export const getSfxVolume = () => readVolume(SFX_VOLUME_KEY);
export const setSfxVolume = (v: number) => writeVolume(SFX_VOLUME_KEY, v);
export const getMusicVolume = () => readVolume(MUSIC_VOLUME_KEY);
export const setMusicVolume = (v: number) => {
  writeVolume(MUSIC_VOLUME_KEY, v);
  const a = els["maintheme"];
  if (a) a.volume = v; // apply live if the theme's already loaded/playing
};

type OscType = "sine" | "square" | "sawtooth" | "triangle";

function tone(freq: number, start: number, dur: number, type: OscType = "sine", peak = 0.16): void {
  const c = getCtx();
  if (!c) return;
  peak *= getSfxVolume();
  if (peak <= 0) return;
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

export type SoundName =
  | "tick"
  | "go"
  | "correct"
  | "wrong"
  | "timeup"
  | "win"
  | "lose"
  | "pick"
  | "dailydouble"
  | "final"
  | "maintheme";

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
  // These normally play from files (below); the synth entries are just
  // fallbacks if a file is missing (maintheme stays silent rather than beep).
  dailydouble: () => {
    [440, 554, 659].forEach((f, i) => tone(f, i * 0.08, 0.2, "triangle", 0.16));
  },
  final: () => tone(294, 0, 0.6, "sine", 0.12),
  maintheme: () => {},
};

// Optional audio-file overrides. Drop matching files in public/sounds/ and
// they play instead of the synthesized version; anything missing silently
// falls back to synth. Files you add are yours to source/license.
//   tick    — countdown tick        go      — clue opens
//   correct — right answer          wrong   — wrong answer / buzzer
//   timeup  — time's up             pick    — selecting a clue
//   win     — you win               lose    — you lose
const FILES: Record<SoundName, string> = {
  tick: "/sounds/tick.mp3",
  go: "/sounds/go.mp3",
  correct: "/sounds/correct.mp3",
  wrong: "/sounds/incorrect.mp3",
  timeup: "/sounds/timeup.mp3",
  win: "/sounds/win.mp3",
  lose: "/sounds/lose.mp3",
  pick: "/sounds/pick.mp3",
  dailydouble: "/sounds/dailydouble.mp3",
  final: "/sounds/final.mp3",
  maintheme: "/sounds/maintheme.mp3",
};

// Per-sound element cache. undefined = not tried yet; null = load failed (use
// synth); element = created (may still be loading). Lazily created on first
// play, so there's at most one request per sound and none if a sound is unused.
const els: Partial<Record<SoundName, HTMLAudioElement | null>> = {};

function getEl(name: SoundName): HTMLAudioElement | null {
  if (name in els) return els[name] ?? null;
  if (typeof window === "undefined" || typeof Audio === "undefined") {
    els[name] = null;
    return null;
  }
  const a = new Audio(FILES[name]);
  a.preload = "auto";
  a.volume = name === "maintheme" ? getMusicVolume() : getSfxVolume();
  a.addEventListener("error", () => { els[name] = null; }, { once: true }); // missing file -> synth
  els[name] = a;
  return a;
}

export function playSound(name: SoundName): void {
  // The main theme is music; everything else is a sound effect.
  if (name === "maintheme" ? isMusicMuted() : isMuted()) return;
  const a = getEl(name);
  // readyState >= 2 (HAVE_CURRENT_DATA) means the file is ready to play now.
  if (a && a.readyState >= 2) {
    try {
      a.volume = name === "maintheme" ? getMusicVolume() : getSfxVolume();
      a.currentTime = 0;
      void a.play();
      return;
    } catch {
      /* fall through to synth */
    }
  }
  try {
    RECIPES[name]();
  } catch {
    /* audio unavailable — silent no-op */
  }
}

// Start (or resume) the looping main theme, but only if it's paused — so
// calling it on every navigation/gesture never restarts music that's already
// playing. Loading happens without a gesture; this play() needs one.
export function playMainTheme(): void {
  if (isMusicMuted()) return;
  // Only resume an element that already exists (Game creates it via
  // preloadSounds on the board), so this never spawns the theme off the board.
  const a = els["maintheme"];
  if (a && a.paused) {
    try {
      void a.play();
    } catch {
      /* blocked until a gesture — caller retries on interaction */
    }
  }
}

// Restart the theme from the top (used by the music toggle turning back on).
export function restartMainTheme(): void {
  if (isMusicMuted()) return;
  const a = els["maintheme"];
  if (a) {
    try {
      a.currentTime = 0;
      void a.play();
    } catch {
      /* no-op */
    }
  }
}

// Pause (keep position) — used to duck the main theme during Daily Double /
// Final so their music doesn't overlap; playMainTheme() resumes it.
export function pauseSound(name: SoundName): void {
  const a = els[name];
  if (a) {
    try {
      a.pause();
    } catch {
      /* no-op */
    }
  }
}

// Stop a playing file (e.g. the final music when it resolves). No-op for synth
// sounds — those are short one-shots.
export function stopSound(name: SoundName): void {
  const a = els[name];
  if (a) {
    try {
      a.pause();
      a.currentTime = 0;
    } catch {
      /* no-op */
    }
  }
}

// Kick off loading of all sound files up front (creating an Audio element with
// preload="auto" starts the download). Playing still needs a user gesture, but
// loading doesn't — so by the time a sound fires (e.g. the Daily Double cue),
// the file is ready instead of falling back to the synth on first play.
export function preloadSounds(): void {
  (Object.keys(FILES) as SoundName[]).forEach(getEl);
}

export function stopAllSounds(): void {
  for (const a of Object.values(els)) {
    if (a) {
      try {
        a.pause();
        a.currentTime = 0;
      } catch {
        /* no-op */
      }
    }
  }
}
