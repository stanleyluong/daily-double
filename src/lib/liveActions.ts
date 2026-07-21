"use client";

import type { User } from "firebase/auth";

// Thin client wrappers over the /api/live/* routes. Every live-game mutation
// goes through these (never a direct Firestore write) so the server stays
// authoritative. Each throws Error(message) on failure for the UI to surface.
async function post<T = unknown>(user: User, path: string, body: Record<string, unknown>): Promise<T> {
  const token = await user.getIdToken();
  const res = await fetch(`/api/live/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Something went wrong.");
  return data as T;
}

export const liveCreate = (
  user: User,
  name: string,
  mode: "normal" | "ranked" = "normal",
  boardKey?: string
) => post<{ code: string }>(user, "create", { name, mode, boardKey });
export const livePause = (user: User, gameId: string, paused: boolean) =>
  post(user, "pause", { gameId, paused });
export const liveJoin = (user: User, code: string, name: string) =>
  post<{ code: string }>(user, "join", { code, name });
export const liveStart = (user: User, gameId: string) => post(user, "start", { gameId });
export const livePick = (user: User, gameId: string, clueId: string) =>
  post(user, "pick", { gameId, clueId });
export const liveSubmit = (user: User, gameId: string, clueId: string, answer: string) =>
  post(user, "submit", { gameId, clueId, answer });
export const liveResolve = (user: User, gameId: string) => post(user, "resolve", { gameId });
export const liveContinue = (user: User, gameId: string) => post(user, "continue", { gameId });
export const liveHeartbeat = (user: User, gameId: string) => post(user, "heartbeat", { gameId });
export const liveLeave = (user: User, gameId: string) => post(user, "leave", { gameId });
export const liveReportDrop = (user: User, gameId: string, droppedUid: string) =>
  post(user, "disconnect", { gameId, droppedUid });
