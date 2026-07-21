"use client";

import type { User } from "firebase/auth";
import type { FriendRow, InviteRow, RequestRow } from "@/lib/friends";

export interface FriendsData {
  friends: FriendRow[];
  requests: RequestRow[];
  invites: InviteRow[];
}

async function call<T>(user: User, method: "GET" | "POST", body?: Record<string, unknown>): Promise<T> {
  const token = await user.getIdToken();
  const res = await fetch("/api/friends", {
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

// GET also refreshes the caller's presence server-side.
export const fetchFriends = (user: User) => call<FriendsData>(user, "GET");
export const addFriend = (user: User, email: string) => call(user, "POST", { action: "add", email });
export const acceptFriend = (user: User, fromUid: string) => call(user, "POST", { action: "accept", fromUid });
export const declineFriend = (user: User, fromUid: string) => call(user, "POST", { action: "decline", fromUid });
export const inviteFriend = (user: User, friendUid: string, gameCode: string) =>
  call(user, "POST", { action: "invite", friendUid, gameCode });
export const clearInvite = (user: User, fromUid: string) => call(user, "POST", { action: "clearInvite", fromUid });
