"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { useAuth } from "@/components/AuthProvider";
import { useDm } from "@/components/DmProvider";
import { useFriends } from "@/components/FriendsProvider";
import AuthModal from "@/components/AuthModal";
import {
  getMusicVolume,
  isMuted,
  isMusicMuted,
  onMainThemeEnded,
  pauseSound,
  playMainTheme,
  setMuted as storeMuted,
  setMusicMuted as storeMusicMuted,
  setMusicVolume,
} from "@/lib/sounds";

// Matching line-icon set for the music/sound/settings control — same stroke
// weight and corner style, so they read as one family instead of whatever
// random design language each platform's emoji font happens to use.
function MusicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function VolumeIcon({ muted, className }: { muted: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      {muted ? (
        <>
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </>
      ) : (
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
      )}
    </svg>
  );
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// Primary destinations, shown as tabs in the top bar (Hextech-client style).
const TABS: { href: string; label: string }[] = [
  { href: "/", label: "Today" },
  { href: "/play", label: "Play" },
  { href: "/live", label: "Live" },
  { href: "/rankings", label: "Rankings" },
  { href: "/archive", label: "Archive" },
  { href: "/friends", label: "Friends" },
  { href: "/history", label: "History" },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

export default function NavBar() {
  const { user, loading } = useAuth();
  const { data } = useFriends();
  const { totalUnread } = useDm();
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  // Settings has no real "home" of its own — clicking the gear while already
  // there should return to wherever you came from, not just reload itself.
  const onSettingsClick = (e: React.MouseEvent) => {
    if (isActive(pathname, "/settings")) {
      e.preventDefault();
      router.back();
    }
  };
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [muted, setMuted] = useState(false); // sound effects
  const [musicMuted, setMusicMuted] = useState(false); // main theme
  const [musicVol, setMusicVol] = useState(1);
  useEffect(() => {
    setMuted(isMuted());
    setMusicMuted(isMusicMuted());
    setMusicVol(getMusicVolume());
  }, []);
  // The theme doesn't loop — when it plays through to the end on its own,
  // reflect that in the icon instead of leaving it showing "on" for a track
  // that's no longer playing.
  useEffect(() => onMainThemeEnded(() => setMusicMuted(true)), []);
  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    storeMuted(next);
  };
  const toggleMusic = () => {
    const next = !musicMuted;
    setMusicMuted(next);
    storeMusicMuted(next);
    // Pause keeps position (so turning it back on resumes, not restarts);
    // playMainTheme() only restarts from 0 if it had already played through
    // to the end, which is native <audio> behavior on a non-looping track.
    if (next) pauseSound("maintheme");
    else playMainTheme();
  };

  // Badge count for pending invites + friend requests + unread DMs (draws the
  // eye to the social panel the way the LoL client's friends button pulses).
  const pending = (data?.invites.length ?? 0) + (data?.requests.length ?? 0) + totalUnread;

  return (
    <header className="sticky top-0 z-40 bg-shell/95 backdrop-blur border-b border-[color:var(--hairline)]">
      <div className="flex items-center h-14 px-3 sm:px-5 gap-2">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2 shrink-0 group">
          <span
            aria-hidden
            className="grid place-items-center h-8 w-8 rounded-sm border border-[color:var(--hairline-strong)] text-gold font-display text-lg leading-none group-hover:bg-shell-raised transition-colors"
          >
            DD
          </span>
          <span className="hidden sm:block font-display text-xl tracking-[0.2em] text-gold">
            DAILY DOUBLE
          </span>
        </Link>

        {/* Primary tabs — desktop */}
        <nav className="hidden md:flex items-center gap-1 ml-4">
          {TABS.map((t) => {
            const active = isActive(pathname, t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`relative px-3.5 py-2 font-display text-lg tracking-wide transition-colors ${
                  active ? "text-gold" : "text-blue-200/60 hover:text-blue-100"
                }`}
              >
                {t.label}
                {t.href === "/friends" && pending > 0 && (
                  <span className="absolute top-1 -right-0.5 min-w-[1.05rem] h-[1.05rem] px-1 grid place-items-center rounded-full bg-gold text-board-deep text-[10px] font-bold">
                    {pending}
                  </span>
                )}
                {active && (
                  <span className="absolute left-2 right-2 -bottom-[1px] h-[2px] bg-gold rounded-full" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        {/* Account — desktop */}
        <div className="hidden md:flex items-center gap-3 text-sm">
          {/* Music / sound / settings, grouped in one bordered control so they read
              as a unit and don't get lost as bare small glyphs. */}
          <div className="flex items-center rounded-sm border border-[color:var(--hairline)] overflow-hidden">
            <div className="relative group/music">
              <button
                onClick={toggleMusic}
                title={musicMuted ? "Music off — click to turn on" : "Music on — click to turn off"}
                aria-label={musicMuted ? "Turn music on" : "Turn music off"}
                className={`grid place-items-center h-9 w-9 transition-colors ${
                  musicMuted ? "text-blue-200/25 hover:text-blue-200/50" : "text-blue-200/75 hover:text-gold"
                } hover:bg-shell-raised`}
              >
                <MusicIcon className="h-4.5 w-4.5" />
              </button>
              {/* Hover (or keyboard-focus) reveal — volume for the main theme,
                  separate from the on/off toggle above it. */}
              <div
                className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-32 rounded-sm border border-[color:var(--hairline-strong)] bg-shell-panel p-2.5 shadow-lg z-50 invisible opacity-0 group-hover/music:visible group-hover/music:opacity-100 group-focus-within/music:visible group-focus-within/music:opacity-100 transition-opacity"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] uppercase tracking-wider text-blue-200/50">Music</span>
                  <span className="text-[10px] text-blue-200/50 tabular-nums">{Math.round(musicVol * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={musicVol}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setMusicVol(v);
                    setMusicVolume(v);
                  }}
                  aria-label="Music volume"
                  className="w-full accent-gold h-1"
                />
              </div>
            </div>
            <span className="h-5 w-px bg-[color:var(--hairline)]" aria-hidden />
            <button
              onClick={toggleMute}
              title={muted ? "Sound effects off — click to turn on" : "Sound effects on — click to turn off"}
              aria-label={muted ? "Unmute sound effects" : "Mute sound effects"}
              className="grid place-items-center h-9 w-9 text-blue-200/75 hover:text-gold hover:bg-shell-raised transition-colors"
            >
              <VolumeIcon muted={muted} className="h-4.5 w-4.5" />
            </button>
            <span className="h-5 w-px bg-[color:var(--hairline)]" aria-hidden />
            <Link
              href="/settings"
              onClick={onSettingsClick}
              title={isActive(pathname, "/settings") ? "Back" : "Settings"}
              aria-label={isActive(pathname, "/settings") ? "Back" : "Settings"}
              className={`grid place-items-center h-9 w-9 transition-colors ${
                isActive(pathname, "/settings")
                  ? "text-gold bg-shell-raised"
                  : "text-blue-200/75 hover:text-gold hover:bg-shell-raised"
              }`}
            >
              <GearIcon className="h-4.5 w-4.5" />
            </Link>
          </div>
          {loading ? (
            <div className="h-8 w-24" aria-hidden />
          ) : user ? (
            <>
              <Link
                href="/history"
                className={`truncate max-w-[12rem] underline-offset-2 hover:underline ${
                  isActive(pathname, "/history") ? "text-gold" : "text-blue-200/85 hover:text-gold"
                }`}
              >
                {user.displayName || user.email}
              </Link>
              <button onClick={() => signOut(auth)} className="text-blue-200/50 hover:text-blue-100">
                Sign out
              </button>
            </>
          ) : (
            <button
              onClick={() => setModalOpen(true)}
              className="rounded-sm border border-[color:var(--hairline-strong)] text-gold px-4 py-1.5 font-display tracking-wide hover:bg-shell-raised transition-colors"
            >
              Sign in
            </button>
          )}
        </div>

        {/* Mobile menu toggle */}
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="md:hidden relative grid place-items-center h-9 w-9 rounded-sm border border-[color:var(--hairline)] text-gold"
          aria-label="Menu"
          aria-expanded={menuOpen}
        >
          <span className="text-lg leading-none">{menuOpen ? "✕" : "☰"}</span>
          {pending > 0 && !menuOpen && (
            <span className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 grid place-items-center rounded-full bg-gold text-board-deep text-[11px] font-bold">
              {pending}
            </span>
          )}
        </button>
      </div>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <nav className="md:hidden border-t border-[color:var(--hairline)] bg-shell px-3 py-2 flex flex-col">
          {[...TABS, { href: "/settings", label: "Settings" }].map((t) => {
            const active = isActive(pathname, t.href);
            const isSettingsBack = t.href === "/settings" && active;
            return (
              <Link
                key={t.href}
                href={t.href}
                onClick={(e) => {
                  if (isSettingsBack) {
                    e.preventDefault();
                    router.back();
                  }
                  setMenuOpen(false);
                }}
                className={`px-2 py-2.5 font-display text-xl tracking-wide ${
                  active ? "text-gold" : "text-blue-200/70"
                }`}
              >
                {isSettingsBack ? "← Back" : t.label}
              </Link>
            );
          })}
          <button
            onClick={toggleMusic}
            className="text-left px-2 py-2.5 font-display text-xl tracking-wide text-blue-200/70"
          >
            {musicMuted ? "🎵 Music off" : "🎵 Music on"}
          </button>
          <button
            onClick={toggleMute}
            className="text-left px-2 py-2.5 font-display text-xl tracking-wide text-blue-200/70"
          >
            {muted ? "🔇 Sound off" : "🔊 Sound on"}
          </button>
          <div className="border-t border-[color:var(--hairline)] mt-2 pt-2 flex items-center justify-between">
            {user ? (
              <>
                <Link
                  href="/history"
                  onClick={() => setMenuOpen(false)}
                  className="px-2 py-2 text-blue-200/85 truncate max-w-[12rem]"
                >
                  {user.displayName || user.email}
                </Link>
                <button
                  onClick={() => {
                    signOut(auth);
                    setMenuOpen(false);
                  }}
                  className="px-2 py-2 text-blue-200/60"
                >
                  Sign out
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  setModalOpen(true);
                  setMenuOpen(false);
                }}
                className="px-2 py-2 text-gold font-display tracking-wide"
              >
                Sign in
              </button>
            )}
          </div>
        </nav>
      )}

      {modalOpen && <AuthModal onClose={() => setModalOpen(false)} />}
    </header>
  );
}
