"use client";

import type { User } from "firebase/auth";
import type { MatchStatus, QueueStatus } from "@/lib/matchmaking";

async function call<T>(user: User, path: string, method: "GET" | "POST", body?: Record<string, unknown>): Promise<T> {
  const token = await user.getIdToken();
  const res = await fetch(`/api/matchmaking/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Something went wrong.");
  return data as T;
}

export const mmJoin = (user: User, name: string) => call<QueueStatus>(user, "join", "POST", { name });
export const mmLeave = (user: User) => call<{ ok: true }>(user, "leave", "POST");
export const mmStatus = (user: User) => call<{ queue: QueueStatus; match: MatchStatus | null }>(user, "status", "GET");
export const mmReady = (user: User, matchId: string) =>
  call<{ gameCode: string | null }>(user, "ready", "POST", { matchId });
export const mmDecline = (user: User, matchId: string) => call<{ ok: true }>(user, "decline", "POST", { matchId });
