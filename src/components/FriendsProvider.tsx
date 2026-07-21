"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { fetchFriends, type FriendsData } from "@/lib/friendsClient";

interface FriendsCtx {
  data: FriendsData | null;
  refresh: () => void;
}

const Ctx = createContext<FriendsCtx>({ data: null, refresh: () => {} });

export function useFriends(): FriendsCtx {
  return useContext(Ctx);
}

// One poller for the whole app: when signed in, hits GET /api/friends every
// ~12s (which also refreshes this user's presence) so friends' online dots
// and incoming invites stay current everywhere.
export default function FriendsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [data, setData] = useState<FriendsData | null>(null);
  const userRef = useRef(user);
  userRef.current = user;

  const refresh = useCallback(() => {
    const u = userRef.current;
    if (!u) return;
    fetchFriends(u)
      .then(setData)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) {
      setData(null);
      return;
    }
    refresh();
    const t = setInterval(refresh, 12_000);
    return () => clearInterval(t);
  }, [user, refresh]);

  return <Ctx.Provider value={{ data, refresh }}>{children}</Ctx.Provider>;
}
