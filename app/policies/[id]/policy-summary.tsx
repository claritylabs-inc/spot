"use client";

import { lobLabel, toLobCodes } from "@/convex/lib/linesOfBusiness";
import dayjs from "dayjs";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { BrandIcon } from "@claritylabs-inc/ui/components/brand-icon";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import {
  OperationalLabelValueRow,
  OperationalPanel,
  OperationalPanelBody,
} from "@claritylabs-inc/ui/components/operational-panel";
import { Pencil } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import { normalizeExtractedDate } from "@/convex/lib/valueNormalization";
import {
  formatDisplayDate,
  formatDisplayPolicyPeriod,
} from "@/lib/date-format";
import { policyOverviewBranding } from "@/lib/policy-card-branding";
import {
  readCarrierIdentity,
  sameCarrierIdentityName,
  type CarrierIdentity,
} from "@/convex/lib/carrierIdentity";
import { policyProductName } from "@/convex/lib/policyProductIdentity";
import {
  EXTRACTION_FAILED_MESSAGE,
  extractingLabel,
  type ExtractionProgress,
} from "@/lib/extraction-state";
import { cn } from "@/lib/utils";
import { typeStyle } from "@/lib/typography";

const PolicyPdfThumbnail = dynamic(
  () =>
    import("./policy-pdf-thumbnail").then((module) => ({
      default: module.PolicyPdfThumbnail,
    })),
  {
    ssr: false,
    loading: () => (
      <Skeleton className="hidden aspect-8.5/11 w-40 shrink-0 bg-white sm:block" />
    ),
  },
);

function PolicyStatusTag({
  expirationDate,
  continuous,
}: {
  expirationDate?: string;
  continuous: boolean;
}) {
  if (continuous) {
    return <StatusTag tone="success">Active</StatusTag>;
  }
  const now = dayjs();
  const expiry = dayjs(
    expirationDate,
    ["MM/DD/YYYY", "YYYY-MM-DD", "M/D/YYYY"],
    true,
  );
  if (!expiry.isValid()) {
    return null;
  }

  const isExpired = expiry.isBefore(now, "day");
  const isExpiringSoon = !isExpired && expiry.diff(now, "day") <= 30;
  if (isExpired) {
    return <StatusTag tone="danger">Expired</StatusTag>;
  }
  if (isExpiringSoon) {
    return <StatusTag tone="warning">Expiring Soon</StatusTag>;
  }
  return <StatusTag tone="success">Active</StatusTag>;
}

function isPendingValue(value: unknown) {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "";
  return (
    normalized === "extracting" ||
    normalized === "extracting..." ||
    normalized === "unknown" ||
    normalized === "n/a" ||
    normalized === "none" ||
    normalized === "—" ||
    normalized === "-"
  );
}

function realText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && !isPendingValue(trimmed) ? trimmed : undefined;
}

function formatPolicyDate(value: string | undefined) {
  const text = realText(value);
  if (!text) return undefined;
  const normalized = normalizeExtractedDate(text);
  return normalized ? formatDisplayDate(normalized) : text;
}

function moneyAmount(value: string | undefined) {
  if (!value) return undefined;
  const amount = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(amount) ? amount : undefined;
}

function formattedMoney(amount: number) {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function isRealLineOfBusiness(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    normalized &&
    normalized !== "un" &&
    normalized !== "other" &&
    !isPendingValue(normalized)
  );
}

export interface PolicySummaryProps {
  carrier?: string;
  carrierDisplayName?: string;
  carrierIdentity?: CarrierIdentity | null;
  policyNumber?: string;
  productIdentity?: unknown;
  programName?: string;
  effectiveDate?: string;
  expirationDate?: string;
  policyTermType?: string;
  premium?: string;
  totalCost?: string;
  taxesAndFees?: Array<{ amount?: string; amountValue?: number }>;
  linesOfBusiness: string[];
  operationsDescription?: string;
  summary?: string;
  isRenewal?: boolean;
  pdfUrl?: string | null;
  /** Set while Spot is reading the policy; missing fields render as skeletons. */
  extracting?: { progress?: ExtractionProgress };
  failed?: boolean;
  onEdit?: () => void;
}

export function PolicySummary({
  carrier,
  carrierDisplayName,
  carrierIdentity: carrierIdentityValue,
  policyNumber,
  productIdentity,
  programName,
  effectiveDate,
  expirationDate,
  policyTermType,
  premium,
  totalCost,
  taxesAndFees,
  linesOfBusiness,
  operationsDescription,
  summary: _summary,
  isRenewal,
  pdfUrl,
  extracting,
  failed,
  onEdit,
}: PolicySummaryProps) {
  const realPolicyNumber = realText(policyNumber);
  const realProductName = realText(
    policyProductName({ productIdentity, programName }),
  );
  const carrierIdentity = readCarrierIdentity(carrierIdentityValue);
  const explicitCarrierDisplayName = realText(carrierDisplayName);
  const issuerName =
    explicitCarrierDisplayName ??
    realText(carrierIdentity?.displayName) ??
    realText(carrier) ??
    "Insurance carrier";
  const brandingMatchesIssuer =
    !explicitCarrierDisplayName ||
    [
      carrierIdentity?.displayName,
      carrierIdentity?.sourceName,
      carrierIdentity?.operatingName,
      ...(carrierIdentity?.legalEntities.map((entity) => entity.name) ?? []),
    ].some((name) => sameCarrierIdentityName(name, explicitCarrierDisplayName));
  const branding = brandingMatchesIssuer ? carrierIdentity?.branding : undefined;
  const realEffectiveDate = realText(effectiveDate);
  const realExpirationDate = realText(expirationDate);
  const continuous =
    realText(policyTermType)?.toLowerCase() === "continuous";
  const displayEffectiveDate = formatPolicyDate(realEffectiveDate);
  const displayExpirationDate = formatPolicyDate(realExpirationDate);
  const realPremium = realText(premium);
  const realTotalCost = realText(totalCost);
  const taxesAndFeesAmount = taxesAndFees?.reduce(
    (sum, row) =>
      sum +
      (typeof row.amountValue === "number"
        ? row.amountValue
        : (moneyAmount(row.amount) ?? 0)),
    0,
  );
  const realTaxesAndFees =
    taxesAndFeesAmount && taxesAndFeesAmount > 0
      ? formattedMoney(taxesAndFeesAmount)
      : undefined;
  const realOperationsDescription = realText(operationsDescription);
  const realLinesOfBusiness =
    toLobCodes(linesOfBusiness).filter(isRealLineOfBusiness);
  const periodValue =
    formatDisplayPolicyPeriod(
      displayEffectiveDate,
      displayExpirationDate,
      policyTermType,
    ) ||
    undefined;

  const hasExtractedDetails =
    !!realPolicyNumber ||
    !!realProductName ||
    realLinesOfBusiness.length > 0 ||
    !!periodValue ||
    !!realPremium ||
    !!realTaxesAndFees ||
    !!realTotalCost ||
    !!realOperationsDescription;
  const hasOverviewRows =
    !!extracting ||
    !!realPolicyNumber ||
    !!realProductName ||
    realLinesOfBusiness.length > 0 ||
    !!periodValue ||
    !!realPremium ||
    !!realTaxesAndFees ||
    !!realTotalCost;
  const { patternStyle, surfaceClassName, surfaceStyle } =
    policyOverviewBranding(issuerName, branding?.accentColor);
  const orPending = (value: ReactNode) =>
    value ??
    (extracting ? (
      <Skeleton className="ml-auto h-4 w-full max-w-40 bg-foreground/6" />
    ) : undefined);

  return (
    <OperationalPanel className="mb-6 @container">
      <div
        className={cn(
          "relative overflow-hidden border-b border-border px-5 py-4",
          surfaceClassName,
        )}
        style={surfaceStyle}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-70"
          style={patternStyle}
        />
        <div className="relative z-10 flex items-start gap-3">
          <BrandIcon
            src={branding?.iconUrl}
            name={issuerName}
            size="lg"
            className="size-9 rounded-md bg-background"
          />
          <div className="min-w-0 flex-1">
            <p className={`truncate text-current opacity-75 ${typeStyle("caption.medium")}`}>
              {issuerName}
            </p>
            <h2 className={`mt-0.5 text-current ${typeStyle("heading.micro")}`}>
              Policy overview
            </h2>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {isRenewal ? (
              <Badge
                variant="outline"
                className="border-current/20 bg-transparent text-current"
              >
                Renewal
              </Badge>
            ) : null}
            {extracting ? (
              <StatusTag tone="info">
                {extractingLabel(extracting.progress)}
              </StatusTag>
            ) : failed ? (
              <StatusTag tone="danger">Couldn&apos;t read</StatusTag>
            ) : (
              <PolicyStatusTag
                expirationDate={realExpirationDate}
                continuous={continuous}
              />
            )}
            {onEdit ? (
              <PillButton
                type="button"
                size="compact"
                variant="secondary"
                onClick={onEdit}
              >
                <Pencil className="size-3.5" />
                Edit
              </PillButton>
            ) : null}
          </div>
        </div>
      </div>

      {pdfUrl || hasOverviewRows || !hasExtractedDetails ? (
        <OperationalPanelBody className="flex flex-col p-0 @lg:flex-row @lg:items-start">
          {pdfUrl ? (
            <div className="shrink-0 p-5 pb-5 @lg:pb-5 @lg:pr-4 border-b @lg:border-r @lg:border-b-0 border-border">
              <div className="w-fit overflow-clip bg-background">
                <PolicyPdfThumbnail url={pdfUrl} />
              </div>
            </div>
          ) : null}

          <div className="min-w-0 flex-1">
            {!hasExtractedDetails && !extracting ? (
              <p
                className={`p-5 text-muted-foreground ${typeStyle("body.default")}`}
              >
                {failed
                  ? EXTRACTION_FAILED_MESSAGE
                  : "No policy details were extracted."}
              </p>
            ) : null}

            {hasOverviewRows ? (
              <dl>
                <OperationalLabelValueRow
                  label="Policy number"
                  value={orPending(realPolicyNumber)}
                  align="right"
                />
                <OperationalLabelValueRow
                  label="Product / plan"
                  value={orPending(realProductName)}
                  align="right"
                />
                <OperationalLabelValueRow
                  label="Product lines"
                  value={orPending(
                    realLinesOfBusiness.length > 0 ? (
                      <span className="flex flex-col items-start gap-0.5 sm:items-end">
                        {realLinesOfBusiness.slice(0, 4).map((line) => (
                          <span key={line}>{lobLabel(line)}</span>
                        ))}
                        {realLinesOfBusiness.length > 4 ? (
                          <span className="text-muted-foreground">
                            +{realLinesOfBusiness.length - 4} more
                          </span>
                        ) : null}
                      </span>
                    ) : undefined,
                  )}
                  align="right"
                />
                <OperationalLabelValueRow
                  label="Policy period"
                  value={orPending(periodValue)}
                  align="right"
                />
                <OperationalLabelValueRow
                  label="Premium"
                  value={orPending(realPremium)}
                  align="right"
                />
                <OperationalLabelValueRow
                  label="Taxes & fees"
                  value={orPending(realTaxesAndFees)}
                  align="right"
                />
                <OperationalLabelValueRow
                  label="Total payable"
                  value={orPending(realTotalCost)}
                  align="right"
                />
              </dl>
            ) : null}
          </div>
        </OperationalPanelBody>
      ) : null}
      {realOperationsDescription ? (
        <dl className="border-t border-border">
          <OperationalLabelValueRow
            label="Description of operations"
            value={realOperationsDescription}
            layout="stacked"
          />
        </dl>
      ) : null}
    </OperationalPanel>
  );
}
