"use client";

import type { User } from "firebase/auth";
import type { DmMessage } from "@/lib/dm";

async function req<T>(user: User, url: string, init?: RequestInit): Promise<T> {
  const token = await user.getIdToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Something went wrong.");
  return data as T;
}

export const fetchDmThread = (user: User, withUid: string) =>
  req<{ messages: DmMessage[] }>(user, `/api/dm?with=${encodeURIComponent(withUid)}`).then((d) => d.messages);

export const fetchDmUnread = (user: User) =>
  req<{ unread: Record<string, number> }>(user, "/api/dm").then((d) => d.unread ?? {});

export const sendDmMessage = (user: User, toUid: string, text: string) =>
  req(user, "/api/dm", { method: "POST", body: JSON.stringify({ toUid, text }) });
