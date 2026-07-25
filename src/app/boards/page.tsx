import { redirect } from "next/navigation";

// The standalone AI-daily-boards list was superseded when daily boards were
// merged into the Archive (with a kind filter) — nothing links here anymore.
// Individual boards still live at /boards/[date]; only the list moved.
export default function BoardsPage() {
  redirect("/archive?kind=daily");
}
