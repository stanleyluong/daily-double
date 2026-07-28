"use client";

// Catches errors thrown in the root layout itself, which the segment-level
// error.tsx cannot — it replaces the whole document, so it must render its own
// <html>/<body> and can't rely on the app's layout, fonts, or CSS. Kept to
// inline styles for that reason. Only shown in production.
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Global error boundary caught:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          background: "#05081f",
          color: "#e6ecff",
          fontFamily: "system-ui, -apple-system, Arial, sans-serif",
          textAlign: "center",
          padding: 24,
        }}
      >
        <p style={{ fontSize: 40, letterSpacing: 2, color: "#f0c14b", margin: 0, fontWeight: 700 }}>
          Daily Double
        </p>
        <p style={{ fontSize: 20, margin: 0 }}>Something went wrong.</p>
        <button
          onClick={reset}
          style={{
            marginTop: 8,
            background: "#f0c14b",
            color: "#05081f",
            border: "none",
            borderRadius: 6,
            padding: "10px 24px",
            fontSize: 16,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
