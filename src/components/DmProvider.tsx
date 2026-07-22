"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { fetchDmThread, fetchDmUnread, sendDmMessage } from "@/lib/dmClient";
import type { DmMessage } from "@/lib/dm";

interface DmCtx {
  unread: Record<string, number>;
  totalUnread: number;
  open: (uid: string, name: string) => void;
  refreshUnread: () => void;
}

const Ctx = createContext<DmCtx>({ unread: {}, totalUnread: 0, open: () => {}, refreshUnread: () => {} });

export function useDm(): DmCtx {
  return useContext(Ctx);
}

// Owns direct-message state for the whole app: a background unread poll (for
// badges) and a single open conversation window rendered bottom-right.
export default function DmProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [openWith, setOpenWith] = useState<{ uid: string; name: string } | null>(null);
  const userRef = useRef(user);
  userRef.current = user;

  const refreshUnread = useCallback(() => {
    const u = userRef.current;
    if (!u) return;
    fetchDmUnread(u)
      .then(setUnread)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) {
      setUnread({});
      setOpenWith(null);
      return;
    }
    refreshUnread();
    const t = setInterval(refreshUnread, 12_000);
    return () => clearInterval(t);
  }, [user, refreshUnread]);

  const open = useCallback((uid: string, name: string) => setOpenWith({ uid, name }), []);

  const totalUnread = Object.values(unread).reduce((n, c) => n + c, 0);

  return (
    <Ctx.Provider value={{ unread, totalUnread, open, refreshUnread }}>
      {children}
      {user && openWith && (
        <DmWindow
          key={openWith.uid}
          withUid={openWith.uid}
          withName={openWith.name}
          onClose={() => setOpenWith(null)}
          onRead={refreshUnread}
        />
      )}
    </Ctx.Provider>
  );
}

function DmWindow({
  withUid,
  withName,
  onClose,
  onRead,
}: {
  withUid: string;
  withName: string;
  onClose: () => void;
  onRead: () => void;
}) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<DmMessage[] | null>(null);
  const [text, setText] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    if (!user) return;
    fetchDmThread(user, withUid)
      .then((m) => {
        setMessages(m);
        onRead(); // reading the thread cleared its unread server-side
      })
      .catch(() => setMessages([]));
  }, [user, withUid, onRead]);

  // Load on open, then poll while the window is open.
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || !user) return;
    setText("");
    try {
      await sendDmMessage(user, withUid, t);
      load();
    } catch {
      /* rate-limit or transient; poll will catch up */
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-[color:var(--hairline)] bg-shell shadow-2xl flex flex-col">
      <div className="flex items-center justify-between px-3 h-11 border-b border-[color:var(--hairline)]">
        <span className="font-display tracking-wide text-gold truncate">{withName}</span>
        <button onClick={onClose} className="text-blue-200/50 hover:text-blue-100 text-lg leading-none">
          ✕
        </button>
      </div>
      <div ref={logRef} className="h-72 overflow-y-auto px-3 py-2 flex flex-col gap-1.5">
        {messages === null && <p className="text-xs text-blue-200/40 m-auto">Loading…</p>}
        {messages?.length === 0 && (
          <p className="text-xs text-blue-200/40 m-auto text-center">
            No messages yet. Say hello to {withName} 👋
          </p>
        )}
        {messages?.map((m) => {
          const mine = m.fromUid === user?.uid;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <span
                className={`inline-block max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm break-words ${
                  mine ? "bg-gold/90 text-board-deep" : "bg-shell-panel text-blue-100"
                }`}
              >
                {m.text}
              </span>
            </div>
          );
        })}
      </div>
      <form onSubmit={send} className="flex gap-1.5 p-2 border-t border-[color:var(--hairline)]">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
          placeholder={`Message ${withName}…`}
          className="flex-1 min-w-0 rounded-sm bg-shell-panel border border-[color:var(--hairline)] focus:border-gold outline-none px-2.5 py-1.5 text-sm placeholder:text-blue-200/35"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="px-3 rounded-sm bg-gold hover:bg-gold-soft text-board-deep font-display tracking-wide text-sm disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
