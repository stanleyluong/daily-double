"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { fetchFriends, type FriendsData } from "@/lib/friendsClient";

interface FriendsCtx {
  data: FriendsData | null;
  // True only until the FIRST fetch of this signed-in session resolves — not
  // reset on the 12s background re-polls, so consumers can tell "we don't
  // have an answer yet" apart from "we asked and the answer is empty" without
  // every poll flickering a loading state over already-good data.
  loading: boolean;
  refresh: () => void;
}

const Ctx = createContext<FriendsCtx>({ data: null, loading: true, refresh: () => {} });

export function useFriends(): FriendsCtx {
  return useContext(Ctx);
}

// One poller for the whole app: when signed in, hits GET /api/friends every
// ~12s (which also refreshes this user's presence) so friends' online dots
// and incoming invites stay current everywhere.
export default function FriendsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [data, setData] = useState<FriendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const userRef = useRef(user);
  userRef.current = user;

  const refresh = useCallback(() => {
    const u = userRef.current;
    if (!u) return;
    fetchFriends(u)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) {
      setData(null);
      setLoading(false); // signed out — nothing to load, not a pending state
      return;
    }
    setLoading(true);
    refresh();
    const t = setInterval(refresh, 12_000);
    return () => clearInterval(t);
  }, [user, refresh]);

  return <Ctx.Provider value={{ data, loading, refresh }}>{children}</Ctx.Provider>;
}
