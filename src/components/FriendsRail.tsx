"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { useDm } from "@/components/DmProvider";
import { useFriends } from "@/components/FriendsProvider";
import {
  acceptFriend,
  addFriend,
  clearInvite,
  declineFriend,
  inviteFriend,
} from "@/lib/friendsClient";
import { liveCreate } from "@/lib/liveActions";

// Persistent right-hand social panel (docked on desktop, like the League
// client). Shows game invites, friend requests, and the full friends list
// with presence, plus one-click "invite to a new game".
export default function FriendsRail() {
  const { user } = useAuth();
  const { data, refresh } = useFriends();
  const { unread, open: openDm } = useDm();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [addEmail, setAddEmail] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      refresh();
    } catch {
      /* the poller will reconcile */
    } finally {
      setBusy(null);
    }
  };

  // Start a fresh game and drop an invite in the friend's inbox, then head to
  // the lobby — the "invite to lobby" flow from the LoL client.
  const inviteToGame = (friendUid: string) =>
    act(`invite:${friendUid}`, async () => {
      if (!user) return;
      const { code } = await liveCreate(user, user.displayName ?? "");
      await inviteFriend(user, friendUid, code);
      router.push(`/live/${code}`);
    });

  const joinInvite = (gameCode: string, fromUid: string) =>
    act(`join:${fromUid}`, async () => {
      if (!user) return;
      router.push(`/live/${gameCode}`);
      await clearInvite(user, fromUid);
    });

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !addEmail.trim()) return;
    setNote(null);
    try {
      await addFriend(user, addEmail.trim());
      setNote(`Request sent to ${addEmail.trim()}.`);
      setAddEmail("");
      refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't send.");
    }
  };

  const friends = data?.friends ?? [];
  const online = friends.filter((f) => f.online);
  const offline = friends.filter((f) => !f.online);

  return (
    <aside className="hidden lg:flex flex-col w-72 shrink-0 border-l border-[color:var(--hairline)] bg-shell sticky top-14 h-[calc(100vh-3.5rem)]">
      <div className="flex items-center justify-between px-4 h-11 border-b border-[color:var(--hairline)]">
        <span className="font-display tracking-[0.25em] text-gold text-sm">SOCIAL</span>
        {user && (
          <span className="text-[11px] text-blue-200/50 tabular-nums">
            <span className="text-online">●</span> {online.length}/{friends.length}
          </span>
        )}
      </div>

      {!user ? (
        <div className="flex-1 grid place-items-center px-6 text-center">
          <p className="text-sm text-blue-200/60">Sign in to see your friends and invites here.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-4">
          {/* Game invites */}
          {(data?.invites.length ?? 0) > 0 && (
            <Section label="Game invites">
              {data!.invites.map((inv) => (
                <div
                  key={inv.fromUid}
                  className="rounded-sm border border-gold/40 bg-shell-raised px-3 py-2.5"
                >
                  <p className="text-sm text-blue-100">
                    <span className="text-gold font-medium">{inv.fromName}</span> invited you
                  </p>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => joinInvite(inv.gameCode, inv.fromUid)}
                      disabled={busy === `join:${inv.fromUid}`}
                      className="flex-1 font-display tracking-wide text-sm bg-gold hover:bg-gold-soft text-board-deep rounded-sm py-1.5 disabled:opacity-60"
                    >
                      Join {inv.gameCode}
                    </button>
                    <button
                      onClick={() => act(`decl-inv:${inv.fromUid}`, () => clearInvite(user, inv.fromUid))}
                      className="px-3 text-blue-200/50 hover:text-blue-100 text-sm"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </Section>
          )}

          {/* Friend requests */}
          {(data?.requests.length ?? 0) > 0 && (
            <Section label="Friend requests">
              {data!.requests.map((req) => (
                <div
                  key={req.fromUid}
                  className="rounded-sm border border-[color:var(--hairline)] bg-shell-panel px-3 py-2.5"
                >
                  <p className="text-sm text-blue-100 truncate">{req.fromName}</p>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => act(`acc:${req.fromUid}`, () => acceptFriend(user, req.fromUid))}
                      disabled={busy === `acc:${req.fromUid}`}
                      className="flex-1 text-sm bg-shell-raised border border-gold/40 text-gold rounded-sm py-1.5 hover:bg-board-deep disabled:opacity-60"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => act(`dec:${req.fromUid}`, () => declineFriend(user, req.fromUid))}
                      className="px-3 text-blue-200/50 hover:text-blue-100 text-sm"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </Section>
          )}

          {/* Online friends */}
          <Section label={`Online — ${online.length}`}>
            {online.length === 0 && (
              <p className="text-xs text-blue-200/40 px-1 py-1">Nobody online right now.</p>
            )}
            {online.map((f) => (
              <FriendRow
                key={f.uid}
                name={f.name}
                online
                unread={unread[f.uid] ?? 0}
                busy={busy === `invite:${f.uid}`}
                onInvite={() => inviteToGame(f.uid)}
                onMessage={() => openDm(f.uid, f.name)}
              />
            ))}
          </Section>

          {/* Offline friends */}
          {offline.length > 0 && (
            <Section label={`Offline — ${offline.length}`}>
              {offline.map((f) => (
                <FriendRow
                  key={f.uid}
                  name={f.name}
                  online={false}
                  unread={unread[f.uid] ?? 0}
                  onMessage={() => openDm(f.uid, f.name)}
                />
              ))}
            </Section>
          )}

          {friends.length === 0 && (data?.requests.length ?? 0) === 0 && (
            <p className="text-xs text-blue-200/45 px-1">
              No friends yet — add someone by email below.
            </p>
          )}
        </div>
      )}

      {/* Add-friend footer */}
      {user && (
        <div className="border-t border-[color:var(--hairline)] px-3 py-3">
          <form onSubmit={add} className="flex gap-1.5">
            <input
              type="email"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              placeholder="Add by email"
              className="flex-1 min-w-0 rounded-sm bg-shell-panel border border-[color:var(--hairline)] focus:border-gold outline-none px-2.5 py-1.5 text-sm placeholder:text-blue-200/35"
            />
            <button
              type="submit"
              className="px-3 rounded-sm border border-[color:var(--hairline-strong)] text-gold text-sm hover:bg-shell-raised"
            >
              Add
            </button>
          </form>
          {note && <p className="text-[11px] text-blue-200/55 mt-1.5">{note}</p>}
          <Link href="/friends" className="block text-[11px] text-blue-200/45 hover:text-gold mt-2">
            Manage friends →
          </Link>
        </div>
      )}
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[10px] uppercase tracking-[0.18em] text-blue-200/40 px-1">{label}</p>
      {children}
    </div>
  );
}

function FriendRow({
  name,
  online,
  unread = 0,
  busy,
  onInvite,
  onMessage,
}: {
  name: string;
  online: boolean;
  unread?: number;
  busy?: boolean;
  onInvite?: () => void;
  onMessage?: () => void;
}) {
  return (
    <div className="group flex items-center gap-2.5 px-2 py-1.5 rounded-sm hover:bg-shell-panel">
      <span
        className={`h-2 w-2 rounded-full shrink-0 ${online ? "bg-online" : "bg-blue-200/25"}`}
        aria-hidden
      />
      <button
        onClick={onMessage}
        className={`flex-1 min-w-0 text-left truncate text-sm hover:text-gold ${
          online ? "text-blue-100" : "text-blue-200/45"
        }`}
        title={`Message ${name}`}
      >
        {name}
      </button>
      {unread > 0 && (
        <span className="min-w-[1.1rem] h-[1.1rem] px-1 grid place-items-center rounded-full bg-gold text-board-deep text-[11px] font-bold">
          {unread}
        </span>
      )}
      {onMessage && (
        <button
          onClick={onMessage}
          title={`Message ${name}`}
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-blue-200/50 hover:text-gold transition-opacity"
          aria-label={`Message ${name}`}
        >
          💬
        </button>
      )}
      {online && onInvite && (
        <button
          onClick={onInvite}
          disabled={busy}
          title="Invite to a game"
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-xs font-display tracking-wide text-gold border border-gold/40 rounded-sm px-2 py-0.5 hover:bg-shell-raised disabled:opacity-60 transition-opacity"
        >
          {busy ? "…" : "Invite"}
        </button>
      )}
    </div>
  );
}
