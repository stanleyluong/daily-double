"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { useAuth } from "@/components/AuthProvider";
import { useDm } from "@/components/DmProvider";
import { useFriends } from "@/components/FriendsProvider";
import AuthModal from "@/components/AuthModal";
import {
  isMuted,
  isMusicMuted,
  restartMainTheme,
  setMuted as storeMuted,
  setMusicMuted as storeMusicMuted,
  stopSound,
} from "@/lib/sounds";

// Primary destinations, shown as tabs in the top bar (Hextech-client style).
const TABS: { href: string; label: string }[] = [
  { href: "/", label: "Today" },
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
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [muted, setMuted] = useState(false); // sound effects
  const [musicMuted, setMusicMuted] = useState(false); // main theme
  useEffect(() => {
    setMuted(isMuted());
    setMusicMuted(isMusicMuted());
  }, []);
  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    storeMuted(next);
  };
  const toggleMusic = () => {
    const next = !musicMuted;
    setMusicMuted(next);
    storeMusicMuted(next);
    if (next) stopSound("maintheme");
    else restartMainTheme();
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
            <button
              onClick={toggleMusic}
              title={musicMuted ? "Music off — click to turn on" : "Music on — click to turn off"}
              aria-label={musicMuted ? "Turn music on" : "Turn music off"}
              className={`grid place-items-center h-9 w-9 text-2xl leading-none transition-colors ${
                musicMuted ? "text-blue-200/25 hover:text-blue-200/50" : "text-blue-200/75 hover:text-gold"
              } hover:bg-shell-raised`}
            >
              🎵
            </button>
            <span className="h-5 w-px bg-[color:var(--hairline)]" aria-hidden />
            <button
              onClick={toggleMute}
              title={muted ? "Sound effects off — click to turn on" : "Sound effects on — click to turn off"}
              aria-label={muted ? "Unmute sound effects" : "Mute sound effects"}
              className="grid place-items-center h-9 w-9 text-2xl leading-none text-blue-200/75 hover:text-gold hover:bg-shell-raised transition-colors"
            >
              {muted ? "🔇" : "🔊"}
            </button>
            <span className="h-5 w-px bg-[color:var(--hairline)]" aria-hidden />
            <Link
              href="/settings"
              title="Settings"
              aria-label="Settings"
              className={`grid place-items-center h-9 w-9 text-2xl leading-none transition-colors ${
                isActive(pathname, "/settings")
                  ? "text-gold bg-shell-raised"
                  : "text-blue-200/75 hover:text-gold hover:bg-shell-raised"
              }`}
            >
              ⚙
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
            return (
              <Link
                key={t.href}
                href={t.href}
                onClick={() => setMenuOpen(false)}
                className={`px-2 py-2.5 font-display text-xl tracking-wide ${
                  active ? "text-gold" : "text-blue-200/70"
                }`}
              >
                {t.label}
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
