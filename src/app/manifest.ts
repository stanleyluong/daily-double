import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Daily Double — AI-generated Jeopardy",
    short_name: "Daily Double",
    description: "A fresh Jeopardy!-style trivia board every day, written and judged by Claude.",
    start_url: "/",
    display: "standalone",
    background_color: "#05081f",
    theme_color: "#05081f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
