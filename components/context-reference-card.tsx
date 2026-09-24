"use client";

import { Id } from "@/convex/_generated/dataModel";
import { FileText } from "lucide-react";
import { BrandIcon } from "@claritylabs-inc/ui/components/brand-icon";
import {
  ActionSurface,
  ActionSurfaceButton,
} from "@/components/ui/action-surface";
import { useEntityPreview } from "@/hooks/use-entity-preview";
import { lobLabel, policyLobCodes } from "@/convex/lib/linesOfBusiness";
import {
  resolvePolicyCarrierDisplay,
  resolvePolicyPartyContext,
} from "@/convex/lib/policyPartyContext";
import { useCachedPolicySummary } from "@/lib/sync/spot-cached-queries";
import { policyCardBranding } from "@/lib/policy-card-branding";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

const policyReferenceInteractionClass =
  "before:pointer-events-none before:absolute before:inset-0 before:z-0 before:rounded-[inherit] before:bg-transparent before:content-[''] before:transition-colors before:duration-100 [@media(hover:hover)_and_(pointer:fine)]:hover:before:bg-current/[0.03] active:before:bg-current/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-current/20 focus-visible:before:bg-current/[0.03]";

function policyCarrierIdentity(policy: {
  carrier?: string;
  security?: string;
  carrierIdentity?: unknown;
  policyDetailOverrides?: unknown;
}) {
  const { carrierDisplayName, carrierIdentity } =
    resolvePolicyCarrierDisplay(policy);
  const branding = carrierIdentity?.branding;
  const issuerName =
    resolvePolicyPartyContext(policy).primaryDisplayName ??
    carrierDisplayName ??
    "Insurance carrier";
  return {
    issuerName,
    branding,
    ...policyCardBranding(issuerName, branding?.accentColor),
  };
}

function extractIdAndType(
  href: string,
): { id: string; type: "policy"; page?: number } | null {
  const policyMatch = href.match(/^\/policies\/([a-z0-9]+)/);
  if (!policyMatch || /^\d+$/.test(policyMatch[1])) return null;

  const page = href.match(/[?&]page=(\d+)/);
  return {
    id: policyMatch[1],
    type: "policy",
    page: page ? parseInt(page[1]) : undefined,
  };
}

export function PolicyReferenceCard({
  id,
  page,
  citedSections,
  citedCoverageNames,
  citedSourceSpanIds,
}: {
  id: string;
  page?: number;
  citedSections?: string[];
  citedCoverageNames?: string[];
  citedSourceSpanIds?: string[];
}) {
  const policy = useCachedPolicySummary(id as Id<"policies">);
  const { openPreview } = useEntityPreview();

  if (!policy) {
    return (
      <ActionSurface className={`inline-flex max-w-[18rem] items-center gap-1.5 rounded-md px-2 py-1.5 ${typeStyle("control.buttonCompact")}`}>
        <FileText className="h-3 w-3 text-muted-foreground/40" />
        <span className="text-muted-foreground/50">Policy</span>
      </ActionSurface>
    );
  }

  const {
    branding,
    issuerName,
    patternStyle,
    surfaceClassName,
    surfaceStyle,
  } =
    policyCarrierIdentity(policy);
  const policyNum = policy.policyNumber;
  const linesOfBusiness = policyLobCodes(policy);
  const primaryLine = linesOfBusiness[0] && linesOfBusiness[0] !== "UN"
    ? lobLabel(linesOfBusiness[0])
    : null;

  const summaryParts = [issuerName, policyNum].filter(Boolean).join(" ");
  const summary = primaryLine
    ? `${summaryParts} — ${primaryLine}`
    : summaryParts;
  return (
    <ActionSurfaceButton
      type="button"
      onClick={() =>
        openPreview({
          type: "policy",
          id,
          page,
          citedSections,
          citedCoverageNames,
          citedSourceSpanIds,
        })
      }
      className={cn(
        "relative inline-flex max-w-[18rem] items-center gap-1.5 overflow-hidden rounded-md border-current/6 px-2 py-1.5 text-current hover:bg-background",
        policyReferenceInteractionClass,
        surfaceClassName,
      )}
      style={surfaceStyle}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-60"
        style={patternStyle}
      />
      <BrandIcon
        src={branding?.iconUrl}
        name={issuerName}
        size="sm"
        className="relative z-10 size-5 rounded bg-background"
      />
      <div className="relative z-10 min-w-0 flex-1">
        <p className={`mb-0.5 text-current opacity-55 ${typeStyle("caption.medium")}`}>
          Policy
        </p>
        <p className={`truncate text-current opacity-90 ${typeStyle("caption.default")}`}>
          {summary}
        </p>
      </div>
    </ActionSurfaceButton>
  );
}

export function PolicyCitation({
  id,
  page,
  citedSections,
  citedCoverageNames,
  citedSourceSpanIds,
}: {
  id: string;
  page?: number;
  citedSections?: string[];
  citedCoverageNames?: string[];
  citedSourceSpanIds?: string[];
}) {
  const policy = useCachedPolicySummary(id as Id<"policies">);
  const { openPreview } = useEntityPreview();

  const brand = policy ? policyCarrierIdentity(policy) : null;
  const label = policy
    ? [
        brand?.issuerName ?? "Policy",
        policy.policyNumber,
      ]
        .filter(Boolean)
        .join(" ")
    : "Policy";

  return (
    <button
      type="button"
      onClick={() =>
        openPreview({
          type: "policy",
          id,
          page,
          citedSections,
          citedCoverageNames,
          citedSourceSpanIds,
        })
      }
      className={cn(
        `relative mx-0.5 inline-flex h-5 max-w-40 -translate-y-px items-center gap-1 overflow-hidden rounded-full border border-current/6 px-1.5 align-middle text-current no-underline ${typeStyle("label.tag")}`,
        policyReferenceInteractionClass,
        brand?.surfaceClassName,
      )}
      style={brand?.surfaceStyle}
      title={label}
    >
      {brand ? (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-50"
            style={brand.patternStyle}
          />
          <BrandIcon
            src={brand.branding?.iconUrl}
            name={brand.issuerName}
            size="xs"
            className="relative z-10 size-3 rounded-sm bg-background"
          />
        </>
      ) : (
        <FileText className="h-2.5 w-2.5 shrink-0" />
      )}
      <span className="relative z-10 truncate">{label}</span>
    </button>
  );
}

export function PolicySourcePill({
  id,
  page,
  citedSections,
  citedCoverageNames,
  citedSourceSpanIds,
}: {
  id: string;
  page?: number;
  citedSections?: string[];
  citedCoverageNames?: string[];
  citedSourceSpanIds?: string[];
}) {
  const policy = useCachedPolicySummary(id as Id<"policies">);
  const { openPreview } = useEntityPreview();

  const brand = policy ? policyCarrierIdentity(policy) : null;
  const label = policy
    ? [
        brand?.issuerName ?? "Policy",
        policy.policyNumber,
      ]
        .filter(Boolean)
        .join(" ")
    : "Policy";

  return (
    <button
      type="button"
      onClick={() =>
        openPreview({
          type: "policy",
          id,
          page,
          citedSections,
          citedCoverageNames,
          citedSourceSpanIds,
        })
      }
      className={cn(
        `relative inline-flex h-6 max-w-48 items-center justify-center gap-1.5 overflow-hidden rounded-full border border-current/6 px-2 text-current ${typeStyle("label.tag")}`,
        policyReferenceInteractionClass,
        brand?.surfaceClassName,
      )}
      style={brand?.surfaceStyle}
      title={label}
    >
      {brand ? (
        <BrandIcon
          src={brand.branding?.iconUrl}
          name={brand.issuerName}
          size="xs"
          className="relative z-10 size-3 rounded-sm bg-background"
        />
      ) : null}
      <span className="relative z-10 truncate">{label}</span>
    </button>
  );
}

/** Renders a rich reference card — opens entity preview sidebar on click */
export function ContextReferenceCard({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const match = extractIdAndType(href);

  if (!match) {
    return (
      <a
        href={href}
        className="text-primary-light underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  }

  return <PolicyCitation id={match.id} page={match.page} />;
}
