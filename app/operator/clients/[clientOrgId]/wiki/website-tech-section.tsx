"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Globe, Layers, Loader2 } from "lucide-react";
import { EmptyStateCard } from "@claritylabs-inc/ui/components/empty-state-card";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { InlineFieldCard, InlineFieldRow } from "@/components/ui/inline-fields";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";

type Profile = NonNullable<
  NonNullable<FunctionReturnType<typeof api.websiteTech.getForOperator>>["profile"]
>;
type Row = { key: string; name: string; detail?: string; evidence: string; href?: string };

const INFERENCE_TOPICS: Record<Profile["inferences"][number]["topic"], string> = {
  payment_processor: "Payment processor",
  hosting_provider: "Hosting provider",
  data_region: "Data region",
};

const SIGNAL_CATEGORIES: Record<string, string> = {
  website: "Website platform",
  framework: "Framework",
  ecommerce: "Ecommerce",
  email: "Email",
  crm: "CRM",
  marketing: "Marketing",
  support: "Support",
  analytics: "Analytics",
  monitoring: "Monitoring",
  identity: "Identity",
  saas: "Business software",
};

function rowsFor(profile: Profile) {
  const disclosed = (category: Profile["disclosures"][number]["category"]) =>
    profile.disclosures
      .filter((item) => item.category === category)
      .map((item) => ({
        key: `${item.category}:${item.name}`,
        name: item.name,
        detail: item.detail,
        evidence: `“${item.quote}”`,
        href: item.sourceUrl,
      }));
  const detected = (categories: string[]) =>
    profile.signals
      .filter((signal) => categories.includes(signal.category))
      .map((signal) => ({
        key: `${signal.category}:${signal.name}`,
        name: signal.name,
        detail: signal.region ? `Region ${signal.region}` : undefined,
        evidence: `Detected from ${signal.evidence}`,
      }));
  return {
    payments: [...disclosed("payment_processor"), ...detected(["payments"])],
    data: [...disclosed("hosting_provider"), ...disclosed("data_region")],
    website: detected(["hosting", "cloud", "cdn"]),
    subprocessors: disclosed("subprocessor"),
    other: Object.entries(SIGNAL_CATEGORIES).flatMap(([category, label]) =>
      detected([category]).map((row) => ({ ...row, detail: row.detail ?? label })),
    ),
  };
}

function TechCard({ title, rows, empty }: { title: string; rows: Row[]; empty: string }) {
  return (
    <InlineFieldCard title={title}>
      {rows.length ? (
        rows.map((row) => (
          <InlineFieldRow key={row.key} label={row.name}>
            <div className="py-1.5">
              {row.detail && <div>{row.detail}</div>}
              <div className={`text-muted-foreground ${typeStyle("caption.default")}`}>
                {row.href ? (
                  <a href={row.href} target="_blank" rel="noreferrer" className="hover:underline">
                    {row.evidence}
                  </a>
                ) : (
                  row.evidence
                )}
              </div>
            </div>
          </InlineFieldRow>
        ))
      ) : (
        <p className={`px-4 py-3 text-muted-foreground ${typeStyle("body.default")}`}>{empty}</p>
      )}
    </InlineFieldCard>
  );
}

export type WebsiteTechScan = ReturnType<typeof useWebsiteTechScan>;

/** Query and rescan control, owned by the page so Rescan can live in the top bar. */
export function useWebsiteTechScan(orgId: Id<"organizations">, enabled: boolean) {
  const result = useQuery(api.websiteTech.getForOperator, enabled ? { orgId } : "skip");
  const rescanMutation = useMutation(api.websiteTech.rescanForOperator);
  const [error, setError] = useState<string | null>(null);
  const profile = result?.profile;
  const scanning = profile?.status === "pending" || profile?.status === "running";
  return {
    result,
    error,
    scanning,
    canRescan: !!result?.website,
    rescan: () => {
      setError(null);
      rescanMutation({ orgId }).catch((reason) =>
        setError(getUserFacingErrorMessage(reason, "Could not start scan")),
      );
    },
  };
}

/** Read-only, best-effort public tech-stack findings for underwriting questions. */
export function WebsiteTechSection({ scan }: { scan: WebsiteTechScan }) {
  const { result, error, scanning } = scan;
  if (result === undefined) return <Loader2 className="size-5 animate-spin" />;
  if (!result?.website)
    return (
      <EmptyStateCard
        icon={<Globe className="size-6" />}
        title="No website yet"
        description="Add a website in Account to scan this company’s tech stack."
      />
    );
  const profile = result.profile;
  const rows = profile ? rowsFor(profile) : null;
  const failed = profile?.status === "failed" && !profile.signals.length;
  const nothingFound =
    !!rows &&
    !!profile &&
    !profile.inferences.length &&
    Object.values(rows).every((list) => !list.length);
  return (
    <div className="space-y-4">
      {error && <p className={`text-destructive ${typeStyle("body.default")}`}>{error}</p>}
      {scanning ? (
        <EmptyStateCard
          icon={<Loader2 className="size-6 animate-spin" />}
          title="Scanning…"
          description={`Looking at public signals for ${profile?.domain}. This can take a few minutes.`}
        />
      ) : !profile ? (
        <EmptyStateCard
          icon={<Layers className="size-6" />}
          title="Not scanned yet"
          description="Rescan to find public signals about this company’s payment processor, hosting and technology."
        />
      ) : failed ? (
        <EmptyStateCard
          icon={<Layers className="size-6" />}
          title={`Could not scan ${profile.domain}`}
          description="Rescan, or confirm the tech stack with the client."
        />
      ) : nothingFound ? (
        <EmptyStateCard
          icon={<Layers className="size-6" />}
          title="No technology found"
          description={`No public signals were found for ${profile.domain}. Confirm with the client.`}
        />
      ) : (
        rows &&
        profile && (
          <>
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              Public signals for {profile.domain}. Confirm with the client before relying on them.
            </p>
            <TechCard
              title="Likely answers"
              rows={profile.inferences.map((item) => ({
                key: item.topic,
                name: INFERENCE_TOPICS[item.topic],
                detail: item.answer,
                evidence: `Evidence score ${Math.round(item.confidence * 100)}%, from the findings below`,
              }))}
              empty="Not enough evidence for a confident answer."
            />
            <TechCard title="Payment processor" rows={rows.payments} empty="No payment processor found." />
            <TechCard
              title="Data hosting"
              rows={rows.data}
              empty="No published hosting provider or data region found."
            />
            <TechCard
              title="Website infrastructure"
              rows={rows.website}
              empty="No hosting or CDN signals found."
            />
            {rows.subprocessors.length > 0 && (
              <TechCard title="Published subprocessors" rows={rows.subprocessors} empty="" />
            )}
            <TechCard title="Other technology" rows={rows.other} empty="No other technology detected." />
          </>
        )
      )}
    </div>
  );
}
