"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useDm } from "@/components/DmProvider";
import { useFriends } from "@/components/FriendsProvider";
import AuthModal from "@/components/AuthModal";
import { acceptFriend, addFriend, declineFriend, inviteFriend } from "@/lib/friendsClient";
import { liveCreate, liveJoin } from "@/lib/liveActions";

export default function FriendsPage() {
  const { user, loading } = useAuth();
  const { data, refresh } = useFriends();
  const { unread: dmUnread, open: openDm } = useDm();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [gameBusy, setGameBusy] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);

  // Jump straight into a friend's open lobby — no code needed.
  const joinLobby = async (friendUid: string, gameCode: string) => {
    if (!user) return;
    setGameBusy(`join:${friendUid}`);
    try {
      await liveJoin(user, gameCode, user.displayName ?? "");
      router.push(`/live/${gameCode}`);
    } finally {
      setGameBusy(null);
    }
  };

  // Start a fresh game and invite this friend to it.
  const inviteToGame = async (friendUid: string) => {
    if (!user) return;
    setGameBusy(`invite:${friendUid}`);
    try {
      const { code } = await liveCreate(user, user.displayName ?? "");
      await inviteFriend(user, friendUid, code);
      router.push(`/live/${code}`);
    } finally {
      setGameBusy(null);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return setShowAuth(true);
    if (!email.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await addFriend(user, email.trim());
      setMsg({ text: `Request sent to ${email.trim()}.`, ok: true });
      setEmail("");
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Couldn't send.", ok: false });
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      refresh();
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <main className="flex-1 w-full max-w-lg mx-auto px-4 py-12">
        <header className="text-center mb-8">
          <h1 className="font-display text-4xl md:text-5xl tracking-wider text-gold">Friends</h1>
          <p className="text-blue-200/70 mt-2">Add friends, see who&apos;s online, and invite them to a game.</p>
          <Link href="/live" className="inline-block mt-3 text-gold/80 hover:text-gold underline">
            ← Play with friends
          </Link>
        </header>

        {loading ? (
          <p className="text-center text-blue-200/50 py-10">Loading…</p>
        ) : !user ? (
          <div className="text-center bg-board-deep/60 border border-board rounded-lg p-8">
            <p className="text-blue-200/80 mb-4">Sign in to add friends.</p>
            <button
              onClick={() => setShowAuth(true)}
              className="font-display text-xl tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-6 py-2 rounded"
            >
              Sign in
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Add by email */}
            <form onSubmit={add} className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Friend's email"
                className="flex-1 rounded-lg bg-board border border-blue-300/30 focus:border-gold outline-none px-4 py-2.5 placeholder:text-blue-200/40"
              />
              <button
                type="submit"
                disabled={busy}
                className="font-display tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-5 rounded-lg disabled:opacity-50"
              >
                {busy ? "…" : "Add"}
              </button>
            </form>
            {msg && <p className={`text-sm text-center ${msg.ok ? "text-green-400/90" : "text-red-300"}`}>{msg.text}</p>}

            {/* Requests */}
            {data && data.requests.length > 0 && (
              <div>
                <p className="kicker font-mono text-xs uppercase tracking-widest text-gold mb-2">Friend requests</p>
                <ul className="space-y-2">
                  {data.requests.map((r) => (
                    <li
                      key={r.fromUid}
                      className="flex items-center gap-3 bg-board-deep/50 border border-board rounded-lg px-4 py-2.5"
                    >
                      <span className="flex-1 text-blue-100">{r.fromName}</span>
                      <button
                        onClick={() => act(() => acceptFriend(user, r.fromUid))}
                        className="font-display tracking-wide bg-gold hover:bg-gold-soft text-board-deep px-3 py-1 rounded text-sm"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => act(() => declineFriend(user, r.fromUid))}
                        className="text-blue-200/50 hover:text-blue-100 text-sm"
                      >
                        Decline
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Friends list */}
            <div>
              <p className="kicker font-mono text-xs uppercase tracking-widest text-blue-200/50 mb-2">
                Your friends {data ? `(${data.friends.length})` : ""}
              </p>
              {!data ? (
                <p className="text-blue-200/50 text-sm">Loading…</p>
              ) : data.friends.length === 0 ? (
                <p className="text-blue-200/50 text-sm">No friends yet — add someone by their email above.</p>
              ) : (
                <ul className="space-y-2">
                  {data.friends.map((f) => (
                    <li
                      key={f.uid}
                      className="flex items-center gap-3 bg-board-deep/50 border border-board rounded-lg px-4 py-2.5"
                    >
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${f.online ? "bg-green-400" : "bg-blue-200/25"}`}
                        title={f.online ? "Online" : "Offline"}
                      />
                      <span className="flex-1 min-w-0 truncate text-blue-100">
                        {f.name}
                        {f.game && <span className="ml-1.5 text-[10px] text-green-400 align-middle">● in a lobby</span>}
                      </span>
                      {f.h2h && f.h2h.games > 0 && (
                        <span className="text-xs text-blue-200/50 shrink-0" title="Head-to-head record">
                          {f.h2h.myWins}–{f.h2h.theirWins}
                          {f.h2h.ties > 0 ? `–${f.h2h.ties}` : ""}
                        </span>
                      )}
                      {(dmUnread[f.uid] ?? 0) > 0 && (
                        <span className="min-w-[1.2rem] h-5 px-1 grid place-items-center rounded-full bg-gold text-board-deep text-xs font-bold">
                          {dmUnread[f.uid]}
                        </span>
                      )}
                      <button
                        onClick={() => openDm(f.uid, f.name)}
                        className="font-display tracking-wide border border-gold/40 text-gold px-3 py-1 rounded text-sm hover:bg-board"
                      >
                        Message
                      </button>
                      {f.game ? (
                        <button
                          onClick={() => joinLobby(f.uid, f.game!.code)}
                          disabled={gameBusy === `join:${f.uid}`}
                          className="font-display tracking-wide bg-gold hover:bg-gold-soft text-board-deep px-3 py-1 rounded text-sm disabled:opacity-60"
                        >
                          {gameBusy === `join:${f.uid}` ? "…" : "Join"}
                        </button>
                      ) : (
                        f.online && (
                          <button
                            onClick={() => inviteToGame(f.uid)}
                            disabled={gameBusy === `invite:${f.uid}`}
                            className="font-display tracking-wide border border-gold/40 text-gold px-3 py-1 rounded text-sm hover:bg-board disabled:opacity-60"
                          >
                            {gameBusy === `invite:${f.uid}` ? "…" : "Invite"}
                          </button>
                        )
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-blue-200/40 mt-3">
                Friends with an open lobby show a Join button. Otherwise, Invite starts a new game and sends them
                straight to it.
              </p>
            </div>
          </div>
        )}
      </main>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} message="Sign in to add friends." />}
    </div>
  );
}
