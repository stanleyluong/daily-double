import type { Metadata } from "next";
import { notFound } from "next/navigation";
import HostGame from "@/components/HostGame";

// A plain date, a "hist-" collision-safe historical key, or a "custom-" key.
const KEY_RE = /^(?:hist-)?\d{4}-\d{2}-\d{2}$|^custom-[A-Za-z0-9]{6,}$/;

export const metadata: Metadata = {
  title: "Host a game — Daily Double",
};

export default async function HostBoardPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!KEY_RE.test(key)) notFound();
  return <HostGame boardKey={key} />;
}
