import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  const fontData = await fetch(
    "https://fonts.gstatic.com/s/bagelfatone/v2/hYkPPucsQOr5dy02WmQr5Zkd0B4.ttf"
  ).then((res) => res.arrayBuffer());

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#A0D2FA",
          borderRadius: "40px",
        }}
      >
        <span
          style={{
            fontSize: 120,
            fontFamily: "Bagel Fat One",
            color: "#111827",
            lineHeight: 1,
            marginTop: -16,
          }}
        >
          S
        </span>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Bagel Fat One",
          data: fontData,
          style: "normal",
          weight: 400,
        },
      ],
    }
  );
}
