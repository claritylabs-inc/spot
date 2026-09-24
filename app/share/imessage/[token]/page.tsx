import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { BrandIcon } from "@claritylabs-inc/ui/components/brand-icon";
import { SpotWordmark } from "@claritylabs-inc/ui/components/brand/spot-wordmark";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
} from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { policyCardBranding } from "@/lib/policy-card-branding";
import { readCarrierIdentity } from "@/convex/lib/carrierIdentity";
import { buildCoverageBreakdown } from "@/convex/lib/coverageBreakdown";
import { CoverageBreakdownCards } from "@/app/policies/[id]/policy-coverage-breakdown";
import {
  formatDate,
  loadAppCardView,
  metadataDescription,
  policyPeriod,
  policyLineBusinessLabels,
  type Policy,
} from "./view";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const view = await loadAppCardView(token).catch(() => null);
  if (!view) return { title: { absolute: "Spot" } };
  const description = metadataDescription(view);
  const image = `/share/imessage/${token}/opengraph-image`;
  return {
    title: { absolute: view.title },
    description,
    openGraph: {
      title: view.title,
      description,
      siteName: "Spot",
      type: "website",
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: view.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: view.title,
      description,
      images: [image],
    },
  };
}

function BrandedPolicyIdentity({ policy }: { policy: Policy }) {
  const carrierIdentity = readCarrierIdentity(policy.carrierIdentity);
  const branding = carrierIdentity?.branding;
  const issuerName =
    carrierIdentity?.displayName ?? policy.carrier ?? "Insurance carrier";
  const linesOfBusiness = policyLineBusinessLabels(policy);
  const { patternStyle, surfaceClassName, surfaceStyle } = policyCardBranding(
    issuerName,
    branding?.accentColor,
  );

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-current/6 p-5",
        surfaceClassName,
      )}
      style={surfaceStyle}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70"
        style={patternStyle}
      />
      <div className="relative z-10 flex min-w-0 items-center gap-3">
        <BrandIcon
          src={branding?.iconUrl}
          name={issuerName}
          size="lg"
          className="size-10 rounded-lg bg-background"
        />
        <p className={`truncate text-current opacity-85 ${typeStyle("body.medium")}`}>
          {issuerName}
        </p>
      </div>
      <div className="relative z-10 mt-7">
        <p className={`mb-1 text-current opacity-55 ${typeStyle("caption.medium")}`}>
          Product lines
        </p>
        {linesOfBusiness.length > 0 ? (
          <ul className="space-y-0.5">
            {linesOfBusiness.map((line) => (
              <li key={line} className={`text-current ${typeStyle("body.medium")}`}>
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p className={`text-current ${typeStyle("body.medium")}`}>Policy</p>
        )}
      </div>
      <dl className="relative z-10 mt-7 grid gap-5 border-t border-current/15 pt-4 sm:grid-cols-3">
        {[
          ["Named insured", policy.insuredName || "Not listed"],
          ["Policy number", policy.policyNumber || "Not listed"],
          ["Policy period", policyPeriod(policy)],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className={`text-current opacity-55 ${typeStyle("caption.default")}`}>{label}</dt>
            <dd className={`mt-1 break-words text-current opacity-85 ${typeStyle("body.default")}`}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function PolicyPanel({
  policy,
  branded,
}: {
  policy: Policy;
  branded: boolean;
}) {
  const coverageBreakdown =
    policy.coverageBreakdown ?? buildCoverageBreakdown(policy);

  return (
    <section className="space-y-5 py-7">
      {branded ? (
        <BrandedPolicyIdentity policy={policy} />
      ) : (
        <OperationalLabelValueList>
          <OperationalLabelValueRow label="Named insured" value={policy.insuredName} />
          <OperationalLabelValueRow label="Carrier" value={policy.carrier ?? "Not listed"} />
          <OperationalLabelValueRow label="Policy number" value={policy.policyNumber} />
          <OperationalLabelValueRow
            label="Lines of business"
            value={policyLineBusinessLabels(policy).join(", ") || "Not listed"}
          />
          <OperationalLabelValueRow label="Policy period" value={policyPeriod(policy)} />
        </OperationalLabelValueList>
      )}

      <CoverageBreakdownCards breakdown={coverageBreakdown} />
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className={`text-muted-foreground ${typeStyle("body.default")}`}>{label}</div>
      <div className={`mt-1 break-words text-foreground ${typeStyle("body.default")}`}>{value}</div>
    </div>
  );
}

export default async function ImessageSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const view = await loadAppCardView(token).catch(() => null);

  if (!view) {
    return (
      <main className="min-h-screen bg-background px-5 py-7 text-foreground sm:px-8 sm:py-10">
        <div className="mx-auto max-w-3xl">
          <SpotWordmark />
          <h1 className={`mt-5 ${typeStyle("heading.micro")}`}>
            Link unavailable
          </h1>
          <p className={`mt-3 max-w-xl text-muted-foreground ${typeStyle("body.default")}`}>
            This shared record could not be found.
          </p>
        </div>
      </main>
    );
  }

  const rawLabel = view.label?.trim();
  const label =
    rawLabel && !rawLabel.toLowerCase().endsWith(" details") ? rawLabel : null;

  return (
    <main className="min-h-screen bg-background px-5 py-7 text-foreground sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="border-b border-border pb-7">
          <div className="flex items-center justify-between gap-4">
            <SpotWordmark />
            <p className={`truncate text-muted-foreground ${typeStyle("body.default")}`}>{view.orgName}</p>
          </div>
          <div className="mt-8 flex max-w-3xl flex-col items-start gap-3">
            <div className="min-w-0">
              <h1 className={`text-foreground ${typeStyle("heading.micro")}`}>
                {view.title}
              </h1>
              {view.subtitle ? (
                <p className={`mt-2 text-muted-foreground ${typeStyle("body.default")}`}>
                  {view.subtitle}
                </p>
              ) : null}
              {label ? (
                <p className={`mt-3 text-muted-foreground ${typeStyle("body.default")}`}>{label}</p>
              ) : null}
            </div>
            {view.policy ? (
              <PillButton
                href={`/policies/${view.policy.id}`}
                size="compact"
                className="w-fit"
              >
                <FileText className="h-3.5 w-3.5" />
                Open full policy
              </PillButton>
            ) : null}
          </div>
        </header>

        {view.certificate ? (
          <section className="border-b border-border py-7">
            <div className="grid gap-5 md:grid-cols-[240px_1fr]">
              <div>
                <h2 className={`text-foreground ${typeStyle("heading.micro")}`}>
                  Certificate
                </h2>
                <p className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}>
                  {view.certificate.holderName}
                </p>
              </div>
              <div className="grid gap-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Info label="Issued" value={formatDate(view.certificate.createdAt)} />
                  <Info
                    label="Version"
                    value={view.certificate.versionNumber ? String(view.certificate.versionNumber) : "Not listed"}
                  />
                </div>
                {view.certificate.fileUrl ? (
                  <div>
                    <PillButton
                      href={view.certificate.fileUrl}
                      variant="secondary"
                      className="w-fit"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Open PDF
                    </PillButton>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {view.policy ? (
          <PolicyPanel policy={view.policy} branded={view.kind === "policy"} />
        ) : null}
      </div>
    </main>
  );
}
