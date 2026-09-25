"use client";

import { Badge } from "@claritylabs-inc/ui/components/badge";
import { PillButton } from "@/components/ui/pill-button";
import {
  StatusTag,
  type StatusTagTone,
} from "@claritylabs-inc/ui/components/status-tag";
import type { Id } from "@/convex/_generated/dataModel";
import type { ThreadArtifactRef, ToolArtifactData } from "../types";
import { formatDisplayDate } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { asNumber, asRecord, asRecords, asString } from "./normalize";
import { ArtifactSidebar } from "./shell";

type VendorComplianceCheck = {
  requirementId?: string;
  title?: string;
  status?: string;
  requiredLimits?: Array<{ amount?: number; label?: string }>;
  notes?: string;
  matchedPolicy?: {
    carrier?: string;
    policyNumber?: string;
    insuredName?: string;
    expirationDate?: string;
    coverageName?: string;
    coverageLimit?: string;
    detectedLimitAmount?: number;
  };
};

type VendorComplianceRow = {
  vendorOrgId?: string;
  name?: string;
  status?: string;
  requirementCount?: number;
  policyCount?: number;
  checks?: VendorComplianceCheck[];
};

function normalizeVendorComplianceRows(data: unknown): VendorComplianceRow[] {
  return asRecords(data).map((row) => ({
    vendorOrgId: asString(row.vendorOrgId),
    name: asString(row.name) ?? "Vendor",
    status: asString(row.status),
    requirementCount: asNumber(row.requirementCount),
    policyCount: asNumber(row.policyCount),
    checks: asRecords(row.checks).map((check) => ({
      requirementId: asString(check.requirementId),
      title: asString(check.title) ?? "Requirement",
      status: asString(check.status),
      requiredLimits: Array.isArray(check.requiredLimits)
        ? (check.requiredLimits as VendorComplianceCheck["requiredLimits"])
        : undefined,
      notes: asString(check.notes),
      matchedPolicy: asRecord(check.matchedPolicy) as
        | VendorComplianceCheck["matchedPolicy"]
        | undefined,
    })),
  }));
}

function vendorStatusLabel(status?: string) {
  switch (status) {
    case "compliant":
      return "Compliant";
    case "waiting_on_policies":
      return "Waiting on policies";
    case "non_compliant":
      return "Non-compliant";
    default:
      return status?.replace(/_/g, " ") ?? "Vendor compliance";
  }
}

function vendorStatusTone(status?: string): StatusTagTone {
  if (status === "compliant") return "success";
  if (status === "non_compliant") return "danger";
  if (status === "waiting_on_policies") return "warning";
  return "neutral";
}

const CHECK_STATUS: Record<string, { label: string; tone: StatusTagTone }> = {
  met: { label: "Meets requirement", tone: "success" },
  expiring_soon: { label: "Expiring soon", tone: "warning" },
  expired: { label: "Expired", tone: "danger" },
  unverified: { label: "Unverified", tone: "warning" },
};

function checkStatusMeta(status?: string) {
  return (status && CHECK_STATUS[status]) || { label: "Not met", tone: "danger" as StatusTagTone };
}

/** "2/3 met · 1 open · 2 policies" for a vendor row. */
function vendorRowSummary(row: VendorComplianceRow) {
  const checks = row.checks ?? [];
  const openChecks = checks.filter((check) => check.status !== "met").length;
  const metChecks = checks.length - openChecks;
  const policyText = typeof row.policyCount === "number"
    ? row.policyCount === 0
      ? "no policies"
      : `${row.policyCount} polic${row.policyCount === 1 ? "y" : "ies"}`
    : null;
  return `${metChecks}/${row.requirementCount ?? checks.length} met${openChecks > 0 ? ` · ${openChecks} open` : ""}${policyText ? ` · ${policyText}` : ""}`;
}

function formatRequiredLimits(limits?: VendorComplianceCheck["requiredLimits"]) {
  if (!limits?.length) return undefined;
  return limits
    .map((limit) => limit.label ?? (typeof limit.amount === "number" ? formatLimitAmount(limit.amount) : undefined))
    .filter(Boolean)
    .join(" · ");
}

function formatLimitAmount(value?: number) {
  if (typeof value !== "number") return undefined;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function VendorComplianceChecklist({ rows }: { rows: VendorComplianceRow[] }) {
  return (
    <div className="space-y-3">
      {rows.map((row, rowIndex) => {
        const checks = row.checks ?? [];
        return (
          <section key={`${row.vendorOrgId ?? row.name ?? "vendor"}-${rowIndex}`} className="rounded-md border border-input bg-card">
            <div className="border-b border-border px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className={`min-w-0 truncate text-foreground ${typeStyle("heading.micro")}`}>
                      {row.name ?? "Vendor"}
                    </h3>
                    <StatusTag tone={vendorStatusTone(row.status)}>
                      {vendorStatusLabel(row.status)}
                    </StatusTag>
                  </div>
                  <p className={`mt-1 text-muted-foreground/45 ${typeStyle("caption.default")}`}>
                    {vendorRowSummary(row)}
                  </p>
                </div>
                {row.vendorOrgId ? (
                  <PillButton
                    href={`/connect/vendors/${row.vendorOrgId}/policies`}
                    variant="secondary"
                    size="compact"
                  >
                    View vendor
                  </PillButton>
                ) : null}
              </div>
            </div>
            {checks.length > 0 ? (
              <div className="divide-y divide-border">
                {checks.map((check, checkIndex) => {
                  const meta = checkStatusMeta(check.status);
                  const policy = check.matchedPolicy;
                  const detectedLimit = formatLimitAmount(policy?.detectedLimitAmount);
                  const requiredLimits = formatRequiredLimits(check.requiredLimits);
                  return (
                    <div key={`${check.requirementId ?? check.title ?? "check"}-${checkIndex}`} className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`min-w-0 flex-1 truncate text-foreground/85 ${typeStyle("caption.medium")}`}>
                          {check.title ?? "Requirement"}
                        </span>
                        <StatusTag tone={meta.tone}>
                          {meta.label}
                        </StatusTag>
                      </div>
                      <div className={`mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground/55 ${typeStyle("caption.default")}`}>
                        {requiredLimits ? <span>Required: {requiredLimits}</span> : null}
                        {policy?.coverageLimit ? <span>Coverage: {policy.coverageLimit}</span> : null}
                        {detectedLimit ? <span>Detected: {detectedLimit}</span> : null}
                        {policy?.expirationDate ? (
                          <span>
                            Expires: {formatDisplayDate(
                              policy.expirationDate,
                              policy.expirationDate,
                            )}
                          </span>
                        ) : null}
                        {policy?.insuredName ? <span>Insured: {policy.insuredName}</span> : null}
                      </div>
                      {policy?.carrier || policy?.policyNumber || policy?.coverageName ? (
                        <p className={`mt-1 truncate text-muted-foreground/40 ${typeStyle("caption.default")}`}>
                          {[policy.carrier, policy.policyNumber, policy.coverageName].filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                      {check.notes ? (
                        <p className={`mt-1 text-muted-foreground/65 ${typeStyle("caption.default")}`}>
                          {check.notes}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function VendorCountBadge({ count }: { count: number }) {
  return (
    <Badge variant="outline" className={`h-5 shrink-0 border-border-emphasized px-1.5 text-muted-foreground/55 ${typeStyle("label.tag")}`}>
      {count} vendor{count === 1 ? "" : "s"}
    </Badge>
  );
}

function VendorComplianceSummaryCard({
  artifact,
  onOpen,
  isOpen,
}: {
  artifact: ToolArtifactData;
  onOpen?: () => void;
  isOpen?: boolean;
}) {
  if (artifact.type !== "vendor_compliance") return null;
  const rows = normalizeVendorComplianceRows(artifact.data);
  if (rows.length === 0) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`mt-4 w-full max-w-3xl overflow-hidden rounded-md border bg-card text-left transition-colors ${
        isOpen ? "border-primary/35" : "border-input hover:border-border-hover"
      }`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
        <span className={`truncate text-foreground/85 ${typeStyle("body.medium")}`}>
          Vendor compliance checks
        </span>
        <VendorCountBadge count={rows.length} />
      </div>
      <div className="space-y-1.5 px-3 py-3">
        {rows.slice(0, 3).map((row, index) => (
          <div key={`${row.vendorOrgId ?? row.name ?? "vendor"}-${index}`} className={`flex items-center gap-2 ${typeStyle("caption.default")}`}>
            <span className={`min-w-0 flex-1 truncate text-foreground/75 ${typeStyle("body.medium")}`}>{row.name ?? "Vendor"}</span>
            <span className="shrink-0 text-muted-foreground/45">
              {vendorRowSummary(row)}
            </span>
          </div>
        ))}
        {rows.length > 3 ? (
          <p className={`text-muted-foreground/40 ${typeStyle("caption.default")}`}>
            +{rows.length - 3} more vendor{rows.length - 3 === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>
    </button>
  );
}

export function VendorComplianceSidebar({
  artifact,
  onClose,
}: {
  artifact: ToolArtifactData;
  onClose: () => void;
}) {
  const rows = normalizeVendorComplianceRows(artifact.data);
  return (
    <ArtifactSidebar
      title="Vendor compliance checks"
      status={<VendorCountBadge count={rows.length} />}
      closeLabel="Close vendor compliance checks"
      onClose={onClose}
    >
      <VendorComplianceChecklist rows={rows} />
    </ArtifactSidebar>
  );
}

export function VendorComplianceArtifacts({
  messageId,
  artifacts,
  openArtifact,
  onOpenArtifact,
}: {
  messageId: Id<"threadMessages">;
  artifacts?: ToolArtifactData[];
  openArtifact: ThreadArtifactRef | null;
  onOpenArtifact: (ref: ThreadArtifactRef) => void;
}) {
  const vendorArtifacts = artifacts?.filter((artifact) => artifact.type === "vendor_compliance") ?? [];
  if (vendorArtifacts.length === 0) return null;
  return (
    <div className="space-y-3">
      {vendorArtifacts.map((artifact, index) => (
        <VendorComplianceSummaryCard
          key={`vendor-compliance-${index}`}
          artifact={artifact}
          isOpen={
            openArtifact?.kind === "vendor_compliance" &&
            openArtifact.messageId === messageId &&
            openArtifact.index === index
          }
          onOpen={() =>
            onOpenArtifact({ kind: "vendor_compliance", messageId, index })
          }
        />
      ))}
    </div>
  );
}
