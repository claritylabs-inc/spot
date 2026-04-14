import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { ImageResponse } from "next/og";
import { categoryLabel, loadOgFonts } from "@/app/lib/og";

export const alt = "Firemark — Spot";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand colors
const BG = "#faf8f4";
const FG = "#111827";
const MUTED = "#8a8578";
const CARD_BG = "#ffffff";
const BRAND_BLUE = "#A0D2FA";
const BORDER = "#e5e7eb";
const BODY_FONT = "system-ui, sans-serif";

function renderFallback() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: BG,
        gap: 24,
      }}
    >
      <div style={{ fontFamily: "Bagel Fat One", fontSize: 28, color: FG, letterSpacing: "0.08em" }}>
        SPOT
      </div>
      <div style={{ fontSize: 48, fontFamily: "Instrument Serif", color: FG }}>
        Your policy firemark
      </div>
      <div style={{ fontSize: 18, fontFamily: BODY_FONT, color: MUTED }}>
        A plain-English breakdown of your coverage
      </div>
    </div>
  );
}

export default async function FiremarkOgImage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const fonts = await loadOgFonts();

  let policy: {
    category: string;
    documentType: string;
    carrier?: string | null;
    policyNumber?: string | null;
    effectiveDate?: string | null;
    expirationDate?: string | null;
    premium?: string | null;
    insuredName?: string | null;
  } | null = null;

  try {
    policy = await fetchQuery(api.policies.getFiremarkOg, { token });
  } catch {
    // fall through
  }

  if (!policy) {
    return new ImageResponse(renderFallback(), { ...size, fonts });
  }

  const cat = categoryLabel(policy.category);
  // Keep to max 3 details so text stays large
  const details: { label: string; value: string }[] = [];
  if (policy.policyNumber) details.push({ label: "Policy #", value: policy.policyNumber });
  if (policy.premium) details.push({ label: "Premium", value: policy.premium });
  if (policy.expirationDate) details.push({ label: "Expires", value: policy.expirationDate });
  else if (policy.effectiveDate) details.push({ label: "Effective", value: policy.effectiveDate });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: CARD_BG,
          padding: "56px 72px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Top accent */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 24,
            background: `linear-gradient(to right, ${BRAND_BLUE}, ${BRAND_BLUE}88, transparent)`,
            display: "flex",
          }}
        />

        {/* Header row: pills left, SPOT right */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 32,
          }}
        >
          {/* Category + type */}
          <div style={{ display: "flex", gap: 12 }}>
            <div
              style={{
                backgroundColor: `${BRAND_BLUE}26`,
                borderRadius: 100,
                padding: "14px 30px",
                fontSize: 36,
                fontFamily: BODY_FONT,
                color: FG,
              }}
            >
              {cat}
            </div>
            <div
              style={{
                backgroundColor: BG,
                borderRadius: 100,
                padding: "14px 30px",
                fontSize: 36,
                fontFamily: BODY_FONT,
                color: MUTED,
                textTransform: "capitalize",
              }}
            >
              {policy.documentType}
            </div>
          </div>
          <div
            style={{
              fontFamily: "Bagel Fat One",
              fontSize: 40,
              color: MUTED,
              letterSpacing: "0.08em",
            }}
          >
            SPOT
          </div>
        </div>

        {/* Carrier name — the hero */}
        <div
          style={{
            fontSize: policy.carrier && policy.carrier.length > 25 ? 84 : 108,
            fontFamily: "Instrument Serif",
            color: FG,
            lineHeight: 1.1,
            letterSpacing: "-0.01em",
            marginBottom: 10,
          }}
        >
          {policy.carrier || cat}
        </div>

        {/* Insured name */}
        {policy.insuredName && (
          <div
            style={{
              fontSize: 44,
              fontFamily: BODY_FONT,
              color: MUTED,
              marginBottom: 20,
            }}
          >
            {policy.insuredName}
          </div>
        )}

        {/* Spacer */}
        <div style={{ display: "flex", flex: 1 }} />

        {/* Details row at bottom */}
        {details.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 56,
            }}
          >
            {details.map((d) => (
              <div key={d.label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div
                  style={{
                    fontSize: 32,
                    fontFamily: BODY_FONT,
                    color: `${MUTED}aa`,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  {d.label}
                </div>
                <div
                  style={{
                    fontSize: 48,
                    fontFamily: BODY_FONT,
                    color: FG,
                  }}
                >
                  {d.value}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    ),
    { ...size, fonts }
  );
}
