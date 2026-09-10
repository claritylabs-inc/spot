import { ImageResponse } from "next/og";
import { ogFonts } from "../../../opengraph-image";
import {
  policyAsciiShaderDataUri,
  policyCardBranding,
} from "@/lib/policy-card-branding";
import { readCarrierIdentity } from "@/convex/lib/carrierIdentity";
import { SPOT_BLUE, SPOT_MARK_PATH } from "@/lib/spot-mark";
import { SPOT_WORDMARK } from "@/lib/spot-wordmark";
import {
  compactList,
  loadAppCardView,
  policyPeriod,
  policyLineBusinessLabels,
  truncate,
  type AppCardView,
  type Policy,
} from "./view";

type ImageParams = { token: string };

export const alt = "Spot shared record";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function kindLabel(kind: AppCardView["kind"]) {
  return kind[0].toUpperCase() + kind.slice(1);
}

function heroTitle(view: AppCardView) {
  return truncate(view.title, 82) ?? "Spot record";
}

function heroSubtitle(view: AppCardView) {
  if (view.policy) {
    return compactList([
      view.policy.carrier,
      policyLineBusinessLabels(view.policy).join(", "),
      policyPeriod(view.policy),
    ]);
  }
  if (view.certificate) {
    return compactList([
      view.certificate.holderName,
    ]);
  }
  return view.subtitle ?? "";
}

function detailStatus(view: AppCardView) {
  if (view.certificate) return "Certificate";
  return view.subtitle ?? "Shared record";
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: 7 }}>
      <div style={{ fontSize: 21, color: "#737373", fontWeight: 400 }}>{label}</div>
      <div style={{ fontSize: 30, color: "#000000", fontWeight: 500, lineHeight: 1.18 }}>
        {truncate(value, 44)}
      </div>
    </div>
  );
}

function spotLockupSvg(height: number, wordColor: string): string {
  const width = (SPOT_WORDMARK.width / SPOT_WORDMARK.height) * height;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SPOT_WORDMARK.width} ${SPOT_WORDMARK.height}" width="${width}" height="${height}" fill="none"><path d="${SPOT_WORDMARK.path}" fill="${wordColor}"/><g transform="translate(0 0) scale(3.076923)"><circle cx="32.5" cy="32.5" r="31" fill="none" stroke="${SPOT_BLUE}" stroke-width="1.25"/><path d="${SPOT_MARK_PATH}" fill="${SPOT_BLUE}"/></g></svg>`;
}

function spotLockupDataUri(height: number, wordColor: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(spotLockupSvg(height, wordColor))}`;
}

function SpotMark({ color = "#000000" }: { color?: string }) {
  const height = 34;
  const width = (SPOT_WORDMARK.width / SPOT_WORDMARK.height) * height;
  return (
    <img
      src={spotLockupDataUri(height, color)}
      alt="Spot"
      width={width}
      height={height}
    />
  );
}

function FallbackImage() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#ffffff",
        fontFamily: "Geist",
      }}
    >
      <SpotMark />
    </div>
  );
}

function PolicyDetails({ policy }: { policy: Policy }) {
  const coverageRows = policy.coverages.slice(0, 2);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, width: "100%" }}>
      <div style={{ display: "flex", gap: 24, width: "100%" }}>
        <DetailRow label="Named insured" value={policy.insuredName || "Not listed"} />
        <DetailRow label="Policy number" value={policy.policyNumber || "Not listed"} />
      </div>
      {coverageRows.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            border: "1px solid #e5e5e5",
            borderRadius: 8,
            overflow: "hidden",
            width: "100%",
          }}
        >
          {coverageRows.map((coverage, index) => (
            <div
              key={`${coverage.name}-${coverage.limit ?? ""}-${coverage.deductible ?? ""}`}
              style={{
                display: "flex",
                alignItems: "center",
                borderBottom: index === coverageRows.length - 1 ? "0" : "1px solid #eeeeee",
                padding: "16px 20px",
                gap: 18,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1 }}>
                <div style={{ fontSize: 24, fontWeight: 500, color: "#000000" }}>
                  {truncate(coverage.name, 52)}
                </div>
                <div style={{ fontSize: 19, color: "#737373" }}>
                  Deductible: {coverage.deductible ?? "Not listed"}
                </div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 500, color: "#000000" }}>
                {truncate(coverage.limit ?? "Not listed", 30)}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PolicyPattern({
  variant,
  color,
}: {
  variant: number;
  color: string;
}) {
  return (
    <img
      src={policyAsciiShaderDataUri(variant, color)}
      alt=""
      width={800}
      height={450}
      style={{
        position: "absolute",
        right: -32,
        top: 90,
        width: 800,
        height: 450,
        opacity: 0.14,
      }}
    />
  );
}

function BrandedPolicyImage({ policy, orgName }: { policy: Policy; orgName: string }) {
  const carrierIdentity = readCarrierIdentity(policy.carrierIdentity);
  const branding = carrierIdentity?.branding;
  const issuerName =
    carrierIdentity?.displayName ?? policy.carrier ?? "Insurance carrier";
  const lines = policyLineBusinessLabels(policy);
  const { cardColor, patternVariant, textColor } = policyCardBranding(
    issuerName,
    branding?.accentColor,
  );
  const details = [
    ["Named insured", policy.insuredName || "Not listed"],
    ["Policy number", policy.policyNumber || "Not listed"],
    [
      "Policy period",
      policyPeriod(policy),
    ],
  ];

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backgroundColor: cardColor,
        color: textColor,
        fontFamily: "Geist",
        padding: "54px 66px",
      }}
    >
      <PolicyPattern variant={patternVariant} color={textColor} />
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SpotMark color={textColor} />
        <div style={{ fontSize: 23, color: textColor, opacity: 0.65 }}>Policy</div>
      </div>
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 18, marginTop: 48 }}>
        {branding?.iconUrl ? (
          <img
            src={branding.iconUrl}
            alt=""
            width={56}
            height={56}
            style={{ borderRadius: 10, objectFit: "contain", backgroundColor: "#ffffff" }}
          />
        ) : (
          <div
            style={{
              width: 56,
              height: 56,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 10,
              backgroundColor: "#ffffff",
              color: "#0F172A",
              fontSize: 25,
              fontWeight: 600,
            }}
          >
            {issuerName[0]}
          </div>
        )}
        <div style={{ fontSize: 27, color: textColor, fontWeight: 500, opacity: 0.85 }}>
          {truncate(issuerName, 58)}
        </div>
      </div>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", marginTop: 42 }}>
        <div style={{ fontSize: 20, color: textColor, opacity: 0.55 }}>Product lines</div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 7 }}>
          {(lines.length ? lines : ["Policy"]).slice(0, 3).map((line) => (
            <div key={line} style={{ fontSize: 38, lineHeight: 1.13, color: textColor, fontWeight: 500 }}>
              {truncate(line, 48)}
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          position: "relative",
          display: "flex",
          gap: 30,
          marginTop: "auto",
          borderTop: `1px solid ${textColor}33`,
          paddingTop: 22,
        }}
      >
        {details.map(([label, value]) => (
          <div key={label} style={{ display: "flex", minWidth: 0, flex: 1, flexDirection: "column" }}>
            <div style={{ fontSize: 18, color: textColor, opacity: 0.55 }}>{label}</div>
            <div style={{ marginTop: 6, fontSize: 24, color: textColor, opacity: 0.85 }}>
              {truncate(value, 34)}
            </div>
          </div>
        ))}
      </div>
      <div style={{ position: "relative", display: "flex", justifyContent: "space-between", marginTop: 24, fontSize: 17, color: textColor, opacity: 0.48 }}>
        <div>{truncate(orgName, 70)}</div>
        <div>app.spot.insure</div>
      </div>
    </div>
  );
}

export default async function Image({
  params,
}: {
  params: ImageParams | Promise<ImageParams>;
}) {
  const { token } = await params;
  const fonts = await ogFonts();
  const view = await loadAppCardView(token).catch(() => null);

  if (!view) {
    return new ImageResponse(<FallbackImage />, {
      ...size,
      ...(fonts ? { fonts } : {}),
    });
  }

  if (view.kind === "policy" && view.policy) {
    return new ImageResponse(
      <BrandedPolicyImage policy={view.policy} orgName={view.orgName} />,
      { ...size, ...(fonts ? { fonts } : {}) },
    );
  }

  const subtitle = heroSubtitle(view);
  const title = heroTitle(view);
  const titleSize = title.length > 62 ? 46 : title.length > 42 ? 54 : 62;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#ffffff",
          color: "#000000",
          fontFamily: "Geist",
          padding: "58px 70px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <SpotMark />
          <div style={{ fontSize: 24, color: "#737373", fontWeight: 500 }}>
            {kindLabel(view.kind)}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 52 }}>
          <div
            style={{
              fontSize: titleSize,
              lineHeight: 1.04,
              fontWeight: 500,
              color: "#000000",
              letterSpacing: 0,
              maxWidth: 1000,
            }}
          >
            {title}
          </div>
          {subtitle ? (
            <div
              style={{
                fontSize: 30,
                lineHeight: 1.22,
                color: "#525252",
                maxWidth: 1000,
              }}
            >
              {truncate(subtitle, 130)}
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", flex: 1, alignItems: "flex-end", width: "100%" }}>
          {view.policy ? (
            <PolicyDetails policy={view.policy} />
          ) : (
            <div style={{ display: "flex", gap: 24, width: "100%" }}>
              <DetailRow label="Organization" value={view.orgName} />
              <DetailRow label="Status" value={detailStatus(view)} />
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: "1px solid #eeeeee",
            marginTop: 30,
            paddingTop: 20,
            width: "100%",
            fontSize: 22,
            color: "#737373",
          }}
        >
          <div>{truncate(view.orgName, 70)}</div>
          <div>app.spot.insure</div>
        </div>
      </div>
    ),
    { ...size, ...(fonts ? { fonts } : {}) },
  );
}
