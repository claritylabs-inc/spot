"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { InlineFieldCard, InlineFieldRow } from "@/components/ui/inline-fields";
import { PillButton } from "@/components/ui/pill-button";
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

/** Read-only, best-effort public tech-stack findings for underwriting questions. */
export function WebsiteTechSection({
  orgId,
  readOnly,
}: {
  orgId: Id<"organizations">;
  readOnly: boolean;
}) {
  const result = useQuery(api.websiteTech.getForOperator, { orgId });
  const rescan = useMutation(api.websiteTech.rescanForOperator);
  const [error, setError] = useState<string | null>(null);
  if (result === undefined) return <Loader2 className="size-5 animate-spin" />;
  if (!result?.website)
    return (
      <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
        Add a website in Account to scan this company’s tech stack.
      </p>
    );
  const profile = result.profile;
  const scanning = profile?.status === "pending" || profile?.status === "running";
  const rows = profile ? rowsFor(profile) : null;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
          {scanning
            ? `Scanning ${profile.domain}…`
            : profile?.status === "failed" && !profile.signals.length
              ? `Could not scan ${profile.domain}. Confirm with the client.`
              : profile
                ? `Public signals for ${profile.domain}. Confirm with the client before relying on them.`
                : "Not scanned yet."}
        </p>
        {!readOnly && (
          <PillButton
            variant="secondary"
            size="compact"
            disabled={scanning}
            onClick={() => {
              setError(null);
              rescan({ orgId }).catch((reason) =>
                setError(getUserFacingErrorMessage(reason, "Could not start scan")),
              );
            }}
          >
            {scanning ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Rescan
          </PillButton>
        )}
      </div>
      {error && <p className={`text-destructive ${typeStyle("body.default")}`}>{error}</p>}
      {rows && profile && (
        <>
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
      )}
    </div>
  );
}
