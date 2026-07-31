import type { MetadataRoute } from "next";
import { db } from "@/lib/firebaseAdmin";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.playdailydouble.com";

// Regenerated daily — the board set only grows (new daily board each day, plus
// any newly imported real episodes), so a stale-by-a-day sitemap is harmless.
export const revalidate = 86400;

const STATIC_PATHS = ["", "/archive", "/rankings", "/play", "/host", "/create", "/patch-notes", "/privacy", "/terms", "/shortcuts"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((p) => ({
    url: `${SITE_URL}${p}`,
    changeFrequency: "weekly",
    priority: p === "" ? 1 : 0.6,
  }));

  try {
    const [histRefs, dailySnap] = await Promise.all([
      // ids only, no per-doc reads; historicalBoards has no phantom parents.
      db().collection("historicalBoards").listDocuments(),
      // Real query (not listDocuments): jeopardyBoards accrues phantom parent
      // docs from played-board scores subcollections, which listDocuments would
      // include. .select().get() returns only actual daily-board docs.
      db().collection("jeopardyBoards").select().get(),
    ]);
    const boardEntries: MetadataRoute.Sitemap = [
      ...histRefs.map((r) => r.id),
      ...dailySnap.docs.map((d) => d.id),
    ].map((id) => ({
      url: `${SITE_URL}/boards/${id}`,
      changeFrequency: "yearly",
      priority: 0.5,
    }));
    return [...staticEntries, ...boardEntries];
  } catch (error) {
    console.error("sitemap board listing failed; serving static only:", error);
    return staticEntries;
  }
}
