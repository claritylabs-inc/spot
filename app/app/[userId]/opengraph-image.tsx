import { ImageResponse } from "next/og";

export const alt = "Upload Your Policy | Spot";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const GLOBE_PATH =
  "M31.1839 0H33.7892C33.7984 0.00163511 33.8076 0.00327022 33.8168 0.00490534C35.7548 0.103479 37.6654 0.343031 39.5637 0.756107C47.2996 2.48727 54.1398 6.97839 58.8034 13.3888C61.8198 17.5301 63.8104 22.3281 64.6122 27.3885C64.7439 28.1992 64.8423 29.015 64.907 29.8338C64.9314 30.1443 64.9549 30.873 65 31.1436V33.8838C64.9343 34.504 64.9168 35.1609 64.8518 35.7998C64.709 37.0884 64.5017 38.3687 64.2307 39.6364C62.6136 46.7854 58.6333 53.1803 52.9331 57.7875C48.8608 61.0864 44.0473 63.3455 38.908 64.3703C37.9425 64.5626 36.9691 64.7137 35.9909 64.8235C35.6881 64.8565 34.4008 64.9499 34.204 65H30.7301C30.435 64.9295 29.5167 64.8727 29.1607 64.8346C28.2788 64.7448 27.4013 64.616 26.5308 64.4487C21.7957 63.5756 17.3165 61.6519 13.4231 58.8193C7.00216 54.1649 2.50137 47.3265 0.766127 39.5884C0.345341 37.6771 0.106663 35.7729 0.00478197 33.8248C0.00318798 33.8159 0.00159399 33.8073 0 33.7984V31.2061C0.0720288 30.9269 0.0875815 29.9317 0.115877 29.5899C0.193066 28.7192 0.307883 27.8523 0.460005 26.9916C1.32508 21.9138 3.39165 17.1164 6.48737 12.9994C11.1318 6.80142 17.8355 2.4641 25.3926 0.767676C26.9685 0.426121 28.6008 0.184783 30.2088 0.0716999C30.5151 0.0501601 30.8518 0.0500306 31.1532 0.004891L31.1839 0Z";

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
          position: "relative",
        }}
      >
        {/* Content */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            gap: 28,
          }}
        >
          {/* Logo */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <svg width="28" height="28" viewBox="0 0 65 65" fill="none">
              <circle
                cx="32.5"
                cy="32.5"
                r="31"
                fill="none"
                stroke="#A0D2FA"
                strokeWidth="1.25"
              />
              <path d={GLOBE_PATH} fill="#A0D2FA" />
            </svg>
            <span
              style={{
                fontFamily: "Bagel Fat One",
                fontSize: 28,
                color: "#111827",
                letterSpacing: "0.08em",
              }}
            >
              SPOT
            </span>
          </div>

          {/* Headline */}
          <div
            style={{
              fontSize: 64,
              fontFamily: "Instrument Serif",
              color: "#111827",
              lineHeight: 1.15,
              letterSpacing: "-0.02em",
              maxWidth: 800,
              textAlign: "center",
            }}
          >
            Upload your policy
          </div>

          {/* Subtext */}
          <div
            style={{
              fontSize: 22,
              fontFamily: "system-ui, sans-serif",
              color: "#6b7280",
              lineHeight: 1.5,
              maxWidth: 600,
              textAlign: "center",
            }}
          >
            Securely upload your insurance policy PDF. Spot will text you a
            plain-English breakdown.
          </div>

          {/* Upload icon area */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "#f0ede7",
              marginTop: 8,
            }}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#6b7280"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            position: "absolute",
            bottom: 32,
            display: "flex",
            alignItems: "center",
            gap: 4,
            color: "#9ca3af",
            fontSize: 14,
            fontFamily: "Geist",
          }}
        >
          <span>spot.claritylabs.inc</span>
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
