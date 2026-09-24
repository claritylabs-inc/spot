"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import { BrandIcon } from "@/components/ui/brand-icon";
import {
  type CarrierIdentity,
} from "@/convex/lib/carrierIdentity";
import { lobLabel, policyLobCodes } from "@/convex/lib/linesOfBusiness";
import { resolvePolicyCarrierDisplay } from "@/convex/lib/policyPartyContext";
import { policyProductName } from "@/convex/lib/policyProductIdentity";
import { normalizeExtractedDate } from "@/convex/lib/valueNormalization";
import {
  formatDisplayDate,
  formatDisplayPolicyPeriod,
} from "@/lib/date-format";
import { policyCardBranding } from "@/lib/policy-card-branding";
import { cn } from "@/lib/utils";
import { typeStyle } from "@/lib/typography";

type UploadedBySide =
  | "broker"
  | "client"
  | "operator"
  | "email_scan"
  | "agent_email"
  | undefined;

interface PolicyListItemProps {
  carrier: string;
  carrierIdentity?: CarrierIdentity | null;
  policyDetailOverrides?: unknown;
  generalAgent?: string;
  policyNumber: string;
  productIdentity?: unknown;
  programName?: string;
  linesOfBusiness?: readonly string[];
  effectiveDate?: string;
  expirationDate?: string;
  policyTermType?: string;
  pipelineStatus?: string;
  extractionDataStage?: string;
  uploadedBySide?: UploadedBySide;
  href?: string;
  onClick?: () => void;
  trailingAction?: ReactNode;
}

function ProvenanceBadge({ side }: { side: UploadedBySide }) {
  if (side === "broker") {
    return (
      <Badge
        variant="outline"
        className="border-current/20 bg-transparent text-current"
      >
        Broker provided
      </Badge>
    );
  }
  if (side === "email_scan") {
    return (
      <Badge
        variant="outline"
        className="border-current/20 bg-transparent text-current"
      >
        Email scan
      </Badge>
    );
  }
  if (side === "operator") {
    return (
      <Badge
        variant="outline"
        className="border-current/20 bg-transparent text-current"
      >
        Operator provided
      </Badge>
    );
  }
  return null;
}

function cleanField(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || /^extracting/i.test(trimmed)) return undefined;
  return trimmed;
}

function formatPolicyDate(value: string | undefined): string | undefined {
  const cleaned = cleanField(value);
  if (!cleaned) return undefined;
  const normalized = normalizeExtractedDate(cleaned);
  return normalized ? formatDisplayDate(normalized) : cleaned;
}

export function PolicyListItem({
  carrier,
  carrierIdentity: carrierIdentityValue,
  policyDetailOverrides,
  generalAgent,
  policyNumber,
  productIdentity,
  programName,
  linesOfBusiness,
  effectiveDate,
  expirationDate,
  policyTermType,
  pipelineStatus,
  extractionDataStage,
  uploadedBySide,
  href,
  onClick,
  trailingAction,
}: PolicyListItemProps) {
  const isProvisional =
    extractionDataStage === "preview" && pipelineStatus !== "complete";
  const isPlaceholderProcessing =
    extractionDataStage === "placeholder" &&
    (!pipelineStatus ||
      pipelineStatus === "idle" ||
      pipelineStatus === "running");
  const isProcessing =
    !isProvisional &&
    (isPlaceholderProcessing ||
      pipelineStatus === "running" ||
      !pipelineStatus);
  const generalAgentClean = cleanField(generalAgent);
  const policyNumberClean = cleanField(policyNumber);
  const productNameClean = cleanField(
    policyProductName({ productIdentity, programName }),
  );
  const effectiveClean = formatPolicyDate(effectiveDate);
  const expirationClean = formatPolicyDate(expirationDate);
  const carrierDisplay = resolvePolicyCarrierDisplay({
    carrier,
    carrierIdentity: carrierIdentityValue,
    policyDetailOverrides,
  });
  const carrierIdentity = carrierDisplay.carrierIdentity;
  const carrierClean = cleanField(
    carrierDisplay.carrierDisplayName ?? carrier,
  );
  const branding = carrierIdentity?.branding;
  const productLines = policyLobCodes({ linesOfBusiness })
    .filter((code) => code !== "UN")
    .map(lobLabel);
  const visibleProductLines = productLines.slice(0, 3);
  const hiddenProductLineCount = Math.max(
    0,
    productLines.length - visibleProductLines.length,
  );
  const issuerName =
    carrierClean ??
    cleanField(carrierIdentity?.displayName) ??
    generalAgentClean ??
    "Insurance carrier";
  const coveragePeriod =
    formatDisplayPolicyPeriod(
      effectiveClean,
      expirationClean,
      policyTermType,
    ) ||
    (isProcessing || isProvisional ? "Pending extraction" : "Not listed");
  const fallbackTitle =
    productNameClean ??
    (isProcessing || isProvisional ? "Pending classification" : "Not classified");
  const { patternStyle, surfaceClassName, surfaceStyle } = policyCardBranding(
    issuerName,
    branding?.accentColor,
  );
  const isInteractive = Boolean(href || onClick);
  const cardClassName = cn(
    "group relative flex min-h-44 min-w-0 flex-col overflow-hidden rounded-xl border border-current/6 text-left",
    surfaceClassName,
    isInteractive && [
      "cursor-pointer before:pointer-events-none before:absolute before:inset-0 before:z-0 before:rounded-[inherit] before:bg-transparent before:content-[''] before:transition-colors before:duration-100",
      "[@media(hover:hover)_and_(pointer:fine)]:hover:before:bg-current/[0.03]",
      "active:before:bg-current/[0.05]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-current/20 focus-visible:before:bg-current/[0.03]",
      "focus-within:ring-2 focus-within:ring-inset focus-within:ring-current/10",
    ],
  );

  const content = (
    <div className="relative z-10 flex h-full min-h-44 flex-col overflow-hidden p-4">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70"
        style={patternStyle}
      />
      <div className="relative z-10 flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <BrandIcon
            src={branding?.iconUrl}
            name={issuerName}
            size="lg"
            className="size-8 rounded-md bg-background"
          />
          <div className="min-w-0">
            <p className={`truncate text-current opacity-85 ${typeStyle("caption.medium")}`}>
              {issuerName}
            </p>
            {generalAgentClean && generalAgentClean !== issuerName ? (
              <p className={`truncate text-current opacity-55 ${typeStyle("label.tag")}`}>
                via {generalAgentClean}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {isProcessing ? (
            <StatusTag tone="info">
              Extracting
            </StatusTag>
          ) : null}
          {isProvisional ? (
            <StatusTag tone="info">
              Enriching
            </StatusTag>
          ) : null}
          <ProvenanceBadge side={uploadedBySide} />
        </div>
      </div>

      <div className="relative z-10 mt-5 mb-3 min-h-12">
        <dt className={`text-current opacity-55 mb-1 ${typeStyle("label.tag")}`}>
          Product lines
        </dt>
        {visibleProductLines.length > 0 ? (
          <ul
            className="space-y-0.5"
            aria-label="Policy lines of business"
          >
            {visibleProductLines.map((productLine, index) => (
              <li
                key={`${productLine}-${index}`}
                className={`truncate text-current ${typeStyle("body.medium")}`}
              >
                {productLine}
              </li>
            ))}
          </ul>
        ) : (
          <p className={`truncate text-current ${typeStyle("body.medium")}`}>
            {fallbackTitle}
          </p>
        )}
        {hiddenProductLineCount > 0 ? (
          <p className={`mt-1 text-current opacity-55 ${typeStyle("label.tag")}`}>
            +{hiddenProductLineCount} more{" "}
            {hiddenProductLineCount === 1 ? "coverage" : "coverages"}
          </p>
        ) : null}
        {productNameClean && productNameClean !== visibleProductLines[0] ? (
          <p className={`mt-1 truncate text-current opacity-65 ${typeStyle("label.tag")}`}>
            {productNameClean}
          </p>
        ) : null}
      </div>

      <dl className="relative z-10 mt-auto grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)] gap-4 border-t border-current/15 pt-3">
        <div className="min-w-0">
          <dt className={`text-current opacity-55 ${typeStyle("label.tag")}`}>
            Policy number
          </dt>
          <dd className={`mt-1 truncate text-current opacity-85 ${typeStyle("caption.default")}`}>
            {policyNumberClean ?? (isProcessing ? "Pending" : "Not listed")}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className={`text-current opacity-55 ${typeStyle("label.tag")}`}>
            Coverage period
          </dt>
          <dd className={`mt-1 truncate text-current opacity-85 ${typeStyle("caption.default")}`}>
            {coveragePeriod}
          </dd>
        </div>
      </dl>
    </div>
  );

  if (href && trailingAction) {
    return (
      <div className={cardClassName} style={surfaceStyle}>
        <Link href={href} prefetch className="min-h-0 flex-1">
          {content}
        </Link>
        <div className="relative z-10 flex justify-end px-4 pb-4">
          {trailingAction}
        </div>
      </div>
    );
  }
  if (href) {
    return (
      <Link href={href} prefetch className={cardClassName} style={surfaceStyle}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        className={cardClassName}
        style={surfaceStyle}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }
  return (
    <div className={cardClassName} style={surfaceStyle}>
      {content}
    </div>
  );
}
