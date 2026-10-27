"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Loader2, RefreshCw } from "lucide-react";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { PillButton } from "@/components/ui/pill-button";
import { Input } from "@claritylabs-inc/ui/components/input";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  InlineFieldCard,
  InlineFieldRow,
  InlineFieldsContext,
} from "@/components/ui/inline-fields";
import { RemoveButton } from "@/components/ui/remove-button";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { CountriesInput } from "@/components/insurance-intake/countries-input";
import type { IntakeDetails, IntakeTechStack } from "@/lib/insurance-intake-details";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";
import { formatDisplayDateTime } from "@/lib/date-format";
import { regionCountry } from "@/convex/lib/websiteTech";

type Profile = NonNullable<
  NonNullable<FunctionReturnType<typeof api.websiteTech.getForOperator>>["profile"]
>;
type Topic = Profile["inferences"][number]["topic"];

// Logo sources for common vendors; other names fall back to initials, or their own domain when typed as one.
const VENDOR_DOMAINS: Record<string, string> = {
  stripe: "stripe.com",
  paypal: "paypal.com",
  braintree: "braintreepayments.com",
  adyen: "adyen.com",
  square: "squareup.com",
  paddle: "paddle.com",
  chargebee: "chargebee.com",
  recurly: "recurly.com",
  "lemon squeezy": "lemonsqueezy.com",
  "authorize.net": "authorize.net",
  "checkout.com": "checkout.com",
  shopify: "shopify.com",
  "shopify payments": "shopify.com",
  clover: "clover.com",
  toast: "toasttab.com",
  vercel: "vercel.com",
  netlify: "netlify.com",
  cloudflare: "cloudflare.com",
  aws: "aws.amazon.com",
  "amazon web services": "aws.amazon.com",
  "google cloud": "cloud.google.com",
  gcp: "cloud.google.com",
  "microsoft azure": "azure.microsoft.com",
  azure: "azure.microsoft.com",
  heroku: "heroku.com",
  "fly.io": "fly.io",
  render: "render.com",
  railway: "railway.com",
  "github pages": "github.com",
  "wp engine": "wpengine.com",
  kinsta: "kinsta.com",
  digitalocean: "digitalocean.com",
  firebase: "firebase.google.com",
  supabase: "supabase.com",
};

function VendorIcon({ name }: { name: string }) {
  const key = name.trim().toLowerCase();
  const website = VENDOR_DOMAINS[key] ?? (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(key) ? key : undefined);
  return <OrgBrandIcon name={name} website={website} size="xs" className="size-4!" />;
}

const EMPTY_TECH_STACK: IntakeTechStack = {
  paymentProcessors: [],
  hostingProviders: [],
  dataCountries: [],
};

/**
 * Jev's reconciliation keeps only candidates the evidence supports, strongest first. Without
 * a reconciliation (older scan or a failed Jev stage) every finding is kept.
 */
function reconcile(profile: Profile, topic: Topic, names: string[]) {
  const unique = [...new Map(names.map((name) => [name.toLowerCase(), name])).values()];
  const ranked = profile.inferences
    .filter((item) => item.topic === topic)
    .map((item) => item.answer.toLowerCase());
  if (!ranked.length) return unique;
  return unique
    .filter((name) => ranked.includes(name.toLowerCase()))
    .sort((left, right) => ranked.indexOf(left.toLowerCase()) - ranked.indexOf(right.toLowerCase()));
}

/** The scan's answer for each saved field. */
function scanFindings(profile: Profile): IntakeTechStack {
  const disclosed = (category: Topic) =>
    profile.disclosures.filter((item) => item.category === category).map((item) => item.name);
  const detected = (categories: string[]) =>
    profile.signals
      .filter((signal) => categories.includes(signal.category))
      .map((signal) => signal.name);
  // Raw provider regions (e.g. "iad1") are not countries, so only mapped ones fill the field.
  const located = profile.signals.flatMap((signal) => {
    const country = regionCountry(signal.region);
    return country ? [country] : [];
  });
  return {
    paymentProcessors: reconcile(profile, "payment_processor", [
      ...disclosed("payment_processor"),
      ...detected(["payments"]),
    ]),
    hostingProviders: reconcile(profile, "hosting_provider", [
      ...disclosed("hosting_provider"),
      ...detected(["hosting", "cloud"]),
    ]),
    dataCountries: reconcile(profile, "data_region", [...disclosed("data_region"), ...located]),
  };
}

/** Adds scan findings that are not saved yet; saved values are never changed or removed. */
function withScanFindings(saved: IntakeTechStack, found: IntakeTechStack): IntakeTechStack {
  const add = (values: string[], extra: string[]) => [
    ...values,
    ...extra.filter((name) => !values.some((value) => value.trim().toLowerCase() === name.toLowerCase())),
  ];
  return {
    paymentProcessors: add(saved.paymentProcessors, found.paymentProcessors),
    hostingProviders: add(saved.hostingProviders, found.hostingProviders),
    dataCountries: add(saved.dataCountries, found.dataCountries),
  };
}

function SavedList({ values, logos = true }: { values: string[]; logos?: boolean }) {
  return values.length ? (
    <ul data-inline-multiline className="space-y-1 py-2 pl-3">
      {values.map((value, index) => (
        <li key={index} className="flex items-center gap-2">
          {logos && <VendorIcon name={value} />}
          {value}
        </li>
      ))}
    </ul>
  ) : (
    <span className="block py-2 pl-3 text-muted-foreground">Not provided</span>
  );
}

/** One input per vendor so each value stays a separate entry. */
function VendorList({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const value = draft.trim();
    if (value && !values.some((item) => item.trim().toLowerCase() === value.toLowerCase()))
      onChange([...values, value]);
    setDraft("");
  };
  return (
    <div data-inline-multiline className="py-1">
      {values.map((value, index) => (
        <div key={index} className="flex items-center gap-1">
          <VendorIcon name={value} />
          <Input
            aria-label={`${label} ${index + 1}`}
            value={value}
            onChange={(event) =>
              onChange(values.map((item, i) => (i === index ? event.target.value : item)))
            }
            onBlur={() => {
              if (!value.trim()) onChange(values.filter((_, i) => i !== index));
            }}
          />
          <RemoveButton
            label={`Remove ${value || label}`}
            onClick={() => onChange(values.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <Input
        aria-label={`Add ${label.toLowerCase()}`}
        placeholder={values.length ? "Add another" : "Not provided"}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit();
        }}
        className="ml-5 w-[calc(100%-3.5rem)]"
      />
    </div>
  );
}

export type WebsiteTechScan = ReturnType<typeof useWebsiteTechScan>;

/** Query and rescan control; Rescan renders with the scan status in the Tech stack panel. */
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

type TechStackDetails = Pick<IntakeDetails, "techStack" | "techStackScanFilledAt">;

/** Operator-owned tech stack answers; each finished website scan adds what it found once. */
export function WebsiteTechSection({
  scan,
  details,
  onChange,
  readOnly,
}: {
  scan: WebsiteTechScan;
  details: TechStackDetails;
  onChange: (patch: TechStackDetails) => void;
  readOnly: boolean;
}) {
  const { result, error, scanning } = scan;
  const profile = result?.profile;
  const value = details.techStack ?? EMPTY_TECH_STACK;
  const completedAt = scanning ? undefined : profile?.completedAt;
  const unfilled = !!completedAt && completedAt > (details.techStackScanFilledAt ?? 0);
  useEffect(() => {
    if (readOnly || !profile || !completedAt || !unfilled) return;
    onChange({
      techStack: withScanFindings(value, scanFindings(profile)),
      techStackScanFilledAt: completedAt,
    });
  }, [readOnly, profile, completedAt, unfilled, value, onChange]);
  if (result === undefined) return <Loader2 className="size-5 animate-spin" />;
  const set = (key: keyof IntakeTechStack, next: string[]) =>
    onChange({ techStack: { ...value, [key]: next } });
  const failed = profile?.status === "failed" && !profile.signals.length;
  const scanNote = !result?.website
    ? "Add a website in Account to autofill these from a public scan."
    : scanning
      ? `Scanning ${profile?.domain}. Findings are added here when it finishes.`
      : !profile
        ? `Rescan to autofill these from ${result.website}.`
        : failed
          ? `Could not scan ${profile.domain}.`
          : `Autofilled from a public scan of ${profile.domain}${
              completedAt ? ` on ${formatDisplayDateTime(completedAt)}` : ""
            }. Rescanning only adds new findings.`;
  return (
    <div className="space-y-3">
      {!readOnly && scan.canRescan ? (
        <ListToolbar followKey="profile:tech-stack:actions" actions={
          <PillButton
            variant="secondary"
            size="compact"
            className="shrink-0"
            disabled={scanning}
            onClick={scan.rescan}
          >
            {scanning ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Rescan
          </PillButton>
        } />
      ) : null}
      {error && <p className={`text-destructive ${typeStyle("body.default")}`}>{error}</p>}
      <InlineFieldsContext.Provider value={true}>
        <InlineFieldCard>
          <InlineFieldRow label="Payment processors">
            {readOnly ? (
              <SavedList values={value.paymentProcessors} />
            ) : (
              <VendorList
                label="Payment processor"
                values={value.paymentProcessors}
                onChange={(next) => set("paymentProcessors", next)}
              />
            )}
          </InlineFieldRow>
          <InlineFieldRow label="Hosting providers">
            {readOnly ? (
              <SavedList values={value.hostingProviders} />
            ) : (
              <VendorList
                label="Hosting provider"
                values={value.hostingProviders}
                onChange={(next) => set("hostingProviders", next)}
              />
            )}
          </InlineFieldRow>
          <InlineFieldRow label="Customer data countries">
            {readOnly ? (
              <SavedList values={value.dataCountries} logos={false} />
            ) : (
              <div data-inline-multiline>
                <CountriesInput
                  label="Customer data countries"
                  value={value.dataCountries.join("; ")}
                  onChange={(next) =>
                    set(
                      "dataCountries",
                      next
                        .split(";")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </div>
            )}
          </InlineFieldRow>
        </InlineFieldCard>
      </InlineFieldsContext.Provider>
      <p className={`flex items-center gap-2 text-muted-foreground ${typeStyle("caption.default")}`}>
        {scanning && <Loader2 className="size-3.5 animate-spin" />}
        {scanNote}
      </p>
    </div>
  );
}
