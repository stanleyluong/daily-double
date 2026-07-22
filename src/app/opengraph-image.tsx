import { ImageResponse } from "next/og";

// Branded social-preview card (1200x630). Next auto-wires this as og:image and
// twitter:image, resolved to an absolute URL via metadataBase.
export const alt = "Daily Double — AI-generated Jeopardy";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#05081f",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 132,
            height: 132,
            border: "6px solid #f0c14b",
            borderRadius: 24,
            color: "#f0c14b",
            fontSize: 68,
            fontWeight: 800,
            letterSpacing: 6,
            marginBottom: 44,
          }}
        >
          DD
        </div>
        <div style={{ color: "#f0c14b", fontSize: 100, fontWeight: 800, letterSpacing: 14 }}>
          DAILY DOUBLE
        </div>
        <div style={{ color: "#c9d2ff", fontSize: 36, letterSpacing: 2, marginTop: 28 }}>
          AI-generated Jeopardy — a fresh board every day
        </div>
      </div>
    ),
    { ...size }
  );
}
