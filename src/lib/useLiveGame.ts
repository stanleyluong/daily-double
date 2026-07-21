"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { firestore } from "@/lib/firebaseClient";
import type { LiveGame } from "@/lib/liveTypes";

// Realtime subscription to a live-game doc. This is the one place the app
// reads Firestore straight from the browser; security rules require the
// caller to be a member of the game (uid in playerUids), so callers must
// have joined via the API before mounting this.
export function useLiveGame(gameId: string | null): {
  game: LiveGame | null;
  error: string | null;
  loading: boolean;
} {
  const [game, setGame] = useState<LiveGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscribedId, setSubscribedId] = useState<string | null>(null);

  // Reset view state when the target game changes — adjusted during render
  // (React's documented pattern) rather than in the effect, so the effect
  // body only ever wires up the subscription and never sets state directly.
  if (gameId !== subscribedId) {
    setSubscribedId(gameId);
    setGame(null);
    setError(null);
    setLoading(true);
  }

  useEffect(() => {
    if (!gameId) return;
    const unsub = onSnapshot(
      doc(firestore, "liveGames", gameId),
      (snap) => {
        setLoading(false);
        if (!snap.exists()) {
          setGame(null);
          setError("This game no longer exists.");
          return;
        }
        setError(null);
        setGame({ id: snap.id, ...(snap.data() as Omit<LiveGame, "id">) });
      },
      () => {
        setLoading(false);
        setError("Lost the connection to this game. Reconnecting…");
      }
    );
    return () => unsub();
  }, [gameId]);

  return { game, error, loading };
}
