"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Globe, Layers, Loader2 } from "lucide-react";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { EmptyStateCard } from "@claritylabs-inc/ui/components/empty-state-card";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { InlineFieldCard, InlineFieldRow } from "@/components/ui/inline-fields";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";
import { regionCountry } from "@/convex/lib/websiteTech";

type Profile = NonNullable<
  NonNullable<FunctionReturnType<typeof api.websiteTech.getForOperator>>["profile"]
>;
type Row = { key: string; name: string; detail?: string; evidence: string; href?: string };

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

const SOURCE_EVIDENCE: Record<Profile["signals"][number]["source"], string> = {
  html: "Found on the website",
  headers: "Seen in the website’s response headers",
  dns: "Found in DNS records",
  browser: "Loaded while browsing the site",
};

function locationLabel(region: string | undefined) {
  if (!region) return undefined;
  const country = regionCountry(region);
  return country ? `${country} (${region})` : region;
}

/** One row per vendor or country, merging the evidence from every source that found it. */
function merge(rows: Row[]) {
  const byName = new Map<string, Row>();
  for (const row of rows) {
    const key = row.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing) byName.set(key, { ...row, key });
    else if (!existing.evidence.includes(row.evidence))
      byName.set(key, {
        ...existing,
        detail: existing.detail ?? row.detail,
        evidence: `${existing.evidence} · ${row.evidence}`,
        href: existing.href ?? row.href,
      });
  }
  return [...byName.values()];
}

/**
 * Jev's reconciliation keeps only candidates the evidence supports, strongest first. Without
 * a reconciliation (older scan or a failed Jev stage) every finding is shown.
 */
function reconcile(profile: Profile, topic: Profile["inferences"][number]["topic"], rows: Row[]) {
  const merged = merge(rows);
  const ranked = profile.inferences.filter((item) => item.topic === topic);
  if (!ranked.length) return { kept: merged, dropped: [] };
  const rank = (row: Row) =>
    ranked.findIndex((item) => item.answer.toLowerCase() === row.name.toLowerCase());
  return {
    kept: merged.filter((row) => rank(row) >= 0).sort((left, right) => rank(left) - rank(right)),
    dropped: merged.filter((row) => rank(row) < 0),
  };
}

function rowsFor(profile: Profile) {
  const disclosed = (category: Profile["disclosures"][number]["category"]) =>
    profile.disclosures
      .filter((item) => item.category === category)
      .map((item) => ({
        key: item.name,
        name: item.name,
        detail: item.detail,
        evidence: `“${item.quote}”`,
        href: item.sourceUrl,
      }));
  const detected = (categories: string[]) =>
    profile.signals
      .filter((signal) => categories.includes(signal.category))
      .map((signal) => ({
        key: signal.name,
        name: signal.name,
        detail: locationLabel(signal.region),
        evidence: SOURCE_EVIDENCE[signal.source],
      }));
  const located = profile.signals.flatMap((signal) =>
    signal.region
      ? [
          {
            key: signal.region,
            name: regionCountry(signal.region) ?? signal.region,
            detail: `${signal.name} region ${signal.region}`,
            evidence: SOURCE_EVIDENCE[signal.source],
          },
        ]
      : [],
  );
  const hosting = reconcile(profile, "hosting_provider", [
    ...disclosed("hosting_provider"),
    ...detected(["hosting", "cloud"]),
  ]);
  return {
    payments: reconcile(profile, "payment_processor", [
      ...disclosed("payment_processor"),
      ...detected(["payments"]),
    ]).kept,
    hosting: hosting.kept,
    location: reconcile(profile, "data_region", [...disclosed("data_region"), ...located]).kept,
    // Hosts Jev did not accept as product hosting still describe the marketing site.
    website: merge([...hosting.dropped, ...detected(["cdn"])]),
    subprocessors: merge(disclosed("subprocessor")),
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

type Browse = NonNullable<Profile["browse"]>;
type SkillStatus = NonNullable<Browse["skills"]>[number]["status"];

const SKILL_STATUS: Record<
  SkillStatus,
  { label: string; variant: "secondary" | "destructive" | "outline" }
> = {
  succeeded: { label: "Completed", variant: "secondary" },
  blocked: { label: "Blocked", variant: "destructive" },
  failed: { label: "Failed", variant: "destructive" },
  skipped: { label: "Skipped", variant: "outline" },
};

const SKILL_LABELS = new Map([
  ["account.signup", "Account signup"],
  ["account.sign_in", "Sign in"],
  ["account.verify_email", "Email verification"],
  ["account.enter_otp", "Verification code"],
  ["account.cleanup", "Account cleanup"],
  ["inbox.wait_for_email", "Verification email"],
  ["challenge.captcha", "CAPTCHA"],
  ["site.find_pages", "Site pages"],
  ["page.dismiss_overlays", "Page overlays"],
  ["checkout.observe_payment", "Payment page"],
]);

/** Plain operator labels for known browser procedures; unknown procedures fall back to their name. */
function skillLabel(name: string) {
  const known = SKILL_LABELS.get(name);
  if (known) return known;
  const words = name.replace(/[._-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function visitStatus(browse: Browse) {
  if (browse.finished) return "Finished";
  return browse.steps > 0 ? "Stopped before finishing" : "No steps recorded";
}

/** What the browser could do on the latest scan; outcomes are not proof of a vendor. */
function BrowserResearchCard({ browse }: { browse: Profile["browse"] }) {
  const skills = browse?.skills ?? [];
  return (
    <InlineFieldCard title="Browser research">
      <p className={`px-4 py-3 text-muted-foreground ${typeStyle("caption.default")}`}>
        From the latest scan. These show what the browser could reach on the site, not confirmed
        vendors.
      </p>
      {browse ? (
        <InlineFieldRow label="Site visit">
          <div className="py-1.5">
            <div>{visitStatus(browse)}</div>
            {browse.steps > 0 && (
              <div className={`text-muted-foreground ${typeStyle("caption.default")}`}>
                {browse.steps} {browse.steps === 1 ? "step" : "steps"}
              </div>
            )}
          </div>
        </InlineFieldRow>
      ) : null}
      {skills.map((skill, index) => {
        const status = SKILL_STATUS[skill.status];
        return (
          <InlineFieldRow key={`${skill.name}:${index}`} label={skillLabel(skill.name)}>
            <div className="space-y-1 py-1.5">
              <Badge variant={status.variant}>{status.label}</Badge>
              {skill.summary && (
                <div className={`text-muted-foreground ${typeStyle("caption.default")}`}>
                  {skill.summary}
                </div>
              )}
            </div>
          </InlineFieldRow>
        );
      })}
      {!skills.length && (
        <p className={`px-4 py-3 text-muted-foreground ${typeStyle("body.default")}`}>
          {browse
            ? "No signup, email verification or checkout results were reported for this scan."
            : "No browser visit is recorded for this scan. Rescan to run one."}
        </p>
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
            <TechCard title="Payment processor" rows={rows.payments} empty="No payment processor found." />
            <TechCard
              title="Data hosting"
              rows={rows.hosting}
              empty="No hosting provider found for the product or customer data."
            />
            <TechCard
              title="Data location"
              rows={rows.location}
              empty="No country found for customer data."
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
      {/* Shown beside failed and empty scans too: blockers often explain thin findings. */}
      {profile && !scanning && <BrowserResearchCard browse={profile.browse} />}
    </div>
  );
}
