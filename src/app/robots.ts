import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.playdailydouble.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Ephemeral game sessions, API routes, and auth-gated per-user pages
      // aren't useful in a search index.
      disallow: ["/api/", "/live/", "/friends", "/history", "/settings"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
