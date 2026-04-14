import { ImageResponse } from "next/og";

export const alt = "Spot is working on it";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OGImage() {
  const [instrumentSerifFont, bagelFont] = await Promise.all([
    fetch(
      "https://fonts.gstatic.com/s/instrumentserif/v5/jizBRFtNs2ka5fXjeivQ4LroWlx-2zI.ttf"
    ).then((res) => res.arrayBuffer()),
    fetch(
      "https://fonts.gstatic.com/s/bagelfatone/v2/hYkPPucsQOr5dy02WmQr5Zkd0B4.ttf"
    ).then((res) => res.arrayBuffer()),
  ]);

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
          background: "#faf8f4",
          gap: 40,
        }}
      >
        {/* Logo: SPOT */}
        <span
          style={{
            fontFamily: "Bagel Fat One",
            fontSize: 44,
            color: "#111827",
            letterSpacing: "0.08em",
          }}
        >
          SPOT
        </span>

        {/* Headline */}
        <div
          style={{
            fontSize: 96,
            fontFamily: "Instrument Serif",
            color: "#111827",
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
          }}
        >
          Working on it
        </div>

        {/* Progress dots — large and bold */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          {/* Completed */}
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              background: "#111827",
            }}
          />
          <div
            style={{
              width: 56,
              height: 5,
              borderRadius: 3,
              background: "#111827",
            }}
          />
          {/* Completed */}
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              background: "#111827",
            }}
          />
          <div
            style={{
              width: 56,
              height: 5,
              borderRadius: 3,
              background: "#e5e7eb",
            }}
          />
          {/* Active */}
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              border: "4px solid #111827",
              background: "white",
            }}
          />
          <div
            style={{
              width: 56,
              height: 5,
              borderRadius: 3,
              background: "#e5e7eb",
            }}
          />
          {/* Pending */}
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              border: "4px solid #e5e7eb",
              background: "white",
            }}
          />
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Instrument Serif",
          data: instrumentSerifFont,
          style: "normal",
          weight: 400,
        },
        {
          name: "Bagel Fat One",
          data: bagelFont,
          style: "normal",
          weight: 400,
        },
      ],
    }
  );
}
