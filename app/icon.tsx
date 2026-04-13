import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default async function Icon() {
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
          borderRadius: "8px",
        }}
      >
        <span
          style={{
            fontSize: 22,
            fontFamily: "Bagel Fat One",
            color: "#111827",
            lineHeight: 1,
            marginTop: -3,
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
