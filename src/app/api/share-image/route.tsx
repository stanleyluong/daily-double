import { ImageResponse } from "next/og";
import { formatBoardDate, formatMoney } from "@/lib/format";

export const runtime = "edge";

// A shareable result card (1200x630), built from query params so it needs no
// auth or DB read — the client already has its own score, this just renders
// it as an image. /share result posts this URL; /me could link to a specific
// day's card the same way.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? "";
  const score = Number(searchParams.get("score") ?? 0);
  const correct = Number(searchParams.get("correct") ?? 0);
  const wrong = Number(searchParams.get("wrong") ?? 0);
  const passed = Number(searchParams.get("passed") ?? 0);
  const scoreColor = score < 0 ? "#f87171" : "#f0c14b";

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
            gap: 16,
            marginBottom: 36,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 64,
              height: 64,
              border: "4px solid #f0c14b",
              borderRadius: 12,
              color: "#f0c14b",
              fontSize: 30,
              fontWeight: 800,
              letterSpacing: 2,
            }}
          >
            DD
          </div>
          <div style={{ color: "#f0c14b", fontSize: 44, fontWeight: 800, letterSpacing: 6 }}>
            DAILY DOUBLE
          </div>
        </div>

        {date && (
          <div style={{ color: "#c9d2ff", fontSize: 26, marginBottom: 8 }}>{formatBoardDate(date)}</div>
        )}

        <div style={{ color: scoreColor, fontSize: 120, fontWeight: 800, letterSpacing: 2 }}>
          {formatMoney(score)}
        </div>

        <div style={{ display: "flex", gap: 28, marginTop: 30, fontSize: 30 }}>
          <div style={{ color: "#4ade80" }}>{correct} correct</div>
          <div style={{ color: "#f87171" }}>{wrong} wrong</div>
          <div style={{ color: "#c9d2ff99" }}>{passed} passed</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
