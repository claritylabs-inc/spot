"use client";

import { lobLabel, toLobCodes } from "@/convex/lib/linesOfBusiness";
import dayjs from "dayjs";
import dynamic from "next/dynamic";
import { BrandIcon } from "@/components/ui/brand-icon";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  OperationalLabelValueRow,
  OperationalPanel,
  OperationalPanelBody,
} from "@/components/ui/operational-panel";
import { Loader2, Pencil } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { StatusTag } from "@/components/ui/status-tag";
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

function ExtractionPendingDetails() {
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/45" />
        <span className={`text-muted-foreground ${typeStyle("body.medium")}`}>
          Extracting policy details
        </span>
      </div>
      <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
        {["Policy number", "Lines of business", "Policy period", "Premium"].map(
          (label, index) => (
            <div
              key={label}
              className={index === 0 ? "sm:col-span-2" : undefined}
            >
              <p className={`mb-1.5 text-muted-foreground/55 ${typeStyle("caption.default")}`}>
                {label}
              </p>
              <Skeleton className="h-4 w-full max-w-56 bg-foreground/6" />
            </div>
          ),
        )}
      </div>
    </div>
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
  isExtracting: boolean;
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
  isExtracting,
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
    !!realPolicyNumber ||
    !!realProductName ||
    realLinesOfBusiness.length > 0 ||
    !!periodValue ||
    !!realPremium ||
    !!realTaxesAndFees ||
    !!realTotalCost;
  const { patternStyle, surfaceClassName, surfaceStyle } =
    policyOverviewBranding(issuerName, branding?.accentColor);

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
            <PolicyStatusTag
              expirationDate={realExpirationDate}
              continuous={continuous}
            />
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
            {!hasExtractedDetails ? (
              <div className="p-5">
                {isExtracting ? (
                  <ExtractionPendingDetails />
                ) : (
                  <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
                    No policy details were extracted.
                  </p>
                )}
              </div>
            ) : null}

            {hasOverviewRows ? (
              <dl>
                <OperationalLabelValueRow
                  label="Policy number"
                  value={realPolicyNumber}
                  align="right"
                />
                <OperationalLabelValueRow
                  label="Product / plan"
                  value={realProductName}
                  align="right"
                />
                {realLinesOfBusiness.length > 0 ? (
                  <OperationalLabelValueRow
                    label="Product lines"
                    value={
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
                    }
                    align="right"
                  />
                ) : null}
                <OperationalLabelValueRow
                  label="Policy period"
                  value={periodValue}
                  align="right"
                />
                <OperationalLabelValueRow
                  label="Premium"
                  value={realPremium}
                  align="right"
                />
                <OperationalLabelValueRow
                  label="Taxes & fees"
                  value={realTaxesAndFees}
                  align="right"
                />
                <OperationalLabelValueRow
                  label="Total payable"
                  value={realTotalCost}
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
