"use client";

import type { FormEvent, ReactNode, Ref } from "react";
import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import dayjs from "dayjs";
import { Meter } from "@base-ui/react/meter";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clock,
  FileUp,
  Plus,
  BadgeCheck,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { PolicyCitation } from "@/components/context-reference-card";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { ActionSurface } from "@/components/ui/action-surface";
import { Badge } from "@/components/ui/badge";
import {
  StatusTag,
  type StatusTagTone,
} from "@/components/ui/status-tag";
import { FileDropZone } from "@/components/ui/file-drop";
import { FormSection } from "@/components/ui/form-section";
import { Input } from "@/components/ui/input";
import {
  OperationalPanel,
  OperationalSkeletonList,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  isFeatureEnabled,
  type FeatureFlagMap,
} from "@/convex/lib/featureFlags";
import {
  REQUIREMENT_LIMIT_KINDS,
  REQUIREMENT_LIMIT_KIND_LABELS,
  REQUIREMENT_PROVISION_LABELS,
  REQUIREMENT_SOURCE_TYPE_LABELS,
  type RequirementLimitKind,
  type RequirementProvision,
  type RequirementSourceType,
} from "@/convex/lib/complianceTypes";
import { lobLabel } from "@/convex/lib/linesOfBusiness";
import { useActiveOrgContext } from "@/lib/hooks/use-active-org-context";
import { useCachedConnectedVendors } from "@/lib/sync/spot-cached-queries";
import { useCachedQuery, useUpdateCachedQuery } from "@/lib/sync/use-cached-query";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { AddressAutofillInput } from "@/components/ui/address-autofill-input";
import { PhoneInput } from "@/components/ui/phone-input";
import { CertificateGeneratePanel } from "@/components/certificates/certificate-generate-panel";
import { usePdf } from "@/components/pdf-context";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { formatDisplayDate } from "@/lib/date-format";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";

type RequirementScope = "vendors" | "own_org";
type ComplianceStatus = "met" | "not_met" | "expiring_soon" | "expired" | "unverified";
type SourceFilter = "all" | "internal" | `source:${string}`;
type LineFilter = "all" | `line:${string}`;
type LimitFilter = "all" | "deductible" | "forms" | "provisions" | `limit:${string}`;
type StatusFilter = "all" | ComplianceStatus | "defined";
type ComplianceView = "overview" | "requirements" | "sources" | "certificates";
type RequirementKind = "coverage" | "insurer" | "condition";
type RequirementSourceDocumentType = Exclude<RequirementSourceType, "manual" | "bulk_import">;

export type ComplianceWorkspaceOrgContext = {
  orgId: Id<"organizations">;
  orgType: "client" | "broker";
  role: "admin" | "member" | undefined;
  featureFlags?: FeatureFlagMap;
  isReadOnlyImpersonation: boolean;
};

export type ComplianceWorkspaceShellArgs = {
  actions: ReactNode;
  rightPanel: ReactNode;
  toolbar: ReactNode;
  children: ReactNode;
};

export type ComplianceCertificatesTabArgs = {
  onActions: (actions: ReactNode) => void;
  onRightPanel: (panel: ReactNode) => void;
};

export type CompliancePageProps = {
  orgContext?: ComplianceWorkspaceOrgContext;
  renderShell?: (args: ComplianceWorkspaceShellArgs) => ReactNode;
  renderCertificatesTab?: (args: ComplianceCertificatesTabArgs) => ReactNode;
};

type ComplianceSurface = "customer" | "operator";

type ComplianceApi = {
  compliance: {
    listRequirements: FunctionReference<"query">;
    listRequirementSources: FunctionReference<"query">;
    upsertRequirement: FunctionReference<"mutation">;
    archiveRequirement: FunctionReference<"mutation">;
    updateRequirementSource: FunctionReference<"mutation">;
    archiveRequirementSources: FunctionReference<"mutation">;
    generateRequirementImportUploadUrl: FunctionReference<"mutation">;
  };
  actions: {
    complianceRequirements: {
      importRequirements: FunctionReference<"action">;
    };
    complianceReview: {
      recheckOwnRequirement: FunctionReference<"action">;
    };
  };
  connectedOrgs: {
    listClients: FunctionReference<"query">;
  };
};

const complianceApi = api as unknown as ComplianceApi;

const COMMON_LOBS = ["CGL", "AUTOB", "WORK", "UMBRC", "EXLIA", "EO", "PROP", "BOP", "CRIM", "EPLI", "CYBER"] as const;

const LIMIT_KIND_OPTIONS: RequirementLimitKind[] = [...REQUIREMENT_LIMIT_KINDS];

const REQUIREMENT_SOURCE_DOCUMENT_TYPES: RequirementSourceDocumentType[] = [
  "lease_agreement",
  "client_contract",
  "vendor_requirements",
  "other",
];

const INTERNAL_REQUIREMENT_SOURCE = "internal" as const;

const PROVISION_OPTIONS: RequirementProvision[] = [
  "additional_insured",
  "waiver_of_subrogation",
  "primary_non_contributory",
];

type Requirement = {
  _id: Id<"insuranceRequirements">;
  orgId: Id<"organizations">;
  kind?: RequirementKind;
  scope: RequirementScope;
  title: string;
  requirementText: string;
  lineOfBusiness?: string;
  limits?: Array<{ kind: string; amount: number; label?: string }>;
  maxDeductible?: { amount: number; label?: string };
  coverageForm?: "occurrence" | "claims_made";
  provisions?: string[];
  requiredForms?: string[];
  sourceDocumentId?: Id<"requirementSourceDocuments">;
  sourceType?: RequirementSourceType;
  sourceDocumentName?: string;
  sourceExcerpt?: string;
  sourcePageStart?: number;
  sourcePageEnd?: number;
  updatedAt: number;
  complianceCheck?: {
    status: ComplianceStatus;
    reasons?: string[];
    matchedPolicyIds?: Id<"policies">[];
    matchedSummary?: string;
    expiresAt?: string;
    daysUntilExpiration?: number;
    notes?: string;
    checkedAt?: number;
    checkedBy?: "system" | "user" | "agent";
    matchedPolicy?: {
      _id?: Id<"policies">;
      carrier?: string;
      policyNumber?: string;
      insuredName?: string;
      expirationDate?: string;
      coverageName?: string;
      coverageLimit?: string;
      detectedLimitAmount?: number;
    };
  };
  canArchive?: boolean;
  clientRequirementSource?: {
    clientOrg: {
      _id: Id<"organizations">;
      name: string;
      website?: string;
    } | null;
  };
};

type RequirementSource = {
  _id: Id<"requirementSourceDocuments">;
  orgId: Id<"organizations">;
  fileName?: string;
  contentType?: string;
  sourceType: RequirementSourceDocumentType;
  title: string;
  dealName?: string;
  dealType?: string;
  internalNotes?: string;
  certificateHolderId?: Id<"certificateHolders">;
  holder?: {
    displayName: string;
    contactName?: string;
    email?: string;
    phone?: string;
    address?: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      country?: string;
      formatted?: string;
    };
  } | null;
  sourceTextExcerpt?: string;
  parserBackend?: "liteparse" | "pdfjs" | "mammoth" | "plain_text";
  status: "idle" | "running" | "paused" | "complete" | "error";
  pipelineError?: string;
  requirementCount: number;
  createdAt: number;
  updatedAt: number;
};

type SourceCertificate = {
  _id: Id<"certificateVersions">;
  status: string;
  fileName?: string;
  versionNumber: number;
  createdAt: number;
  url?: string | null;
  policy?: {
    carrier?: string;
    policyNumber?: string;
  } | null;
};

type ConnectedOrgRow = {
  status: "pending" | "active" | "expired" | "revoked";
};

function formatMoney(value: number | undefined) {
  if (value === undefined) return undefined;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMoneyCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function parseMoneyInput(value: string) {
  const normalized = value.replace(/[$,\s]/g, "");
  const multiplier = /m$/i.test(normalized) ? 1_000_000 : /k$/i.test(normalized) ? 1_000 : 1;
  const amount = Number(normalized.replace(/[mk]$/i, "")) * multiplier;
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

function limitKindLabel(kind: string) {
  return (
    REQUIREMENT_LIMIT_KIND_LABELS[kind as keyof typeof REQUIREMENT_LIMIT_KIND_LABELS] ?? kind
  );
}

function asRequirementLimitKind(kind: string): RequirementLimitKind {
  return (REQUIREMENT_LIMIT_KINDS as readonly string[]).includes(kind)
    ? (kind as RequirementLimitKind)
    : "other";
}

function provisionLabel(provision: string) {
  return (
    REQUIREMENT_PROVISION_LABELS[provision as keyof typeof REQUIREMENT_PROVISION_LABELS] ??
    provision
  );
}

function sourceType(requirement: Requirement): RequirementSourceType {
  return requirement.sourceType ?? "manual";
}

function requirementSourceFilter(requirement: Requirement): SourceFilter {
  if (requirement.sourceDocumentId) {
    return `source:${requirement.sourceDocumentId}`;
  }
  return requirement.clientRequirementSource
    ? `source:client:${requirement.clientRequirementSource.clientOrg?._id ?? "unknown"}`
    : INTERNAL_REQUIREMENT_SOURCE;
}

function sourceLabel(value: SourceFilter, requirements: Requirement[]) {
  if (value === "all") return "All sources";
  if (value === INTERNAL_REQUIREMENT_SOURCE) return "Internal requirements";
  const matchingRequirement = requirements.find(
    (requirement) => requirementSourceFilter(requirement) === value,
  );
  return (
    matchingRequirement?.sourceDocumentName ??
    matchingRequirement?.clientRequirementSource?.clientOrg?.name ??
    "Requirement source"
  );
}

function lineFilterValue(lineOfBusiness: string | undefined): LineFilter {
  return `line:${lineOfBusiness ?? "UN"}`;
}

function lineFilterLabel(value: LineFilter) {
  return value === "all" ? "All lines" : lobLabel(value.slice("line:".length));
}

function lineDisplayLabel(lineOfBusiness: string | undefined) {
  return lineOfBusiness ? lobLabel(lineOfBusiness) : lobLabel("UN");
}

function limitFilterValue(kind: string): LimitFilter {
  return `limit:${kind}`;
}

function requirementLimitFilters(requirement: Requirement): LimitFilter[] {
  const filters = (requirement.limits ?? []).map((limit) => limitFilterValue(limit.kind));
  if (requirement.maxDeductible) filters.push("deductible");
  if ((requirement.requiredForms ?? []).length > 0) filters.push("forms");
  if ((requirement.provisions ?? []).length > 0) filters.push("provisions");
  return Array.from(new Set(filters));
}

function limitFilterLabel(value: LimitFilter) {
  if (value === "all") return "All limit types";
  if (value === "deductible") return "Deductible";
  if (value === "forms") return "Required forms";
  if (value === "provisions") return "Provisions";
  return limitKindLabel(value.slice("limit:".length));
}

function statusFilterValue(requirement: Requirement): StatusFilter {
  return requirement.complianceCheck?.status ?? "defined";
}

function statusFilterLabel(value: StatusFilter) {
  return value === "all" ? "All statuses" : statusMeta(value === "defined" ? undefined : value).label;
}

function pageLabel(requirement: Requirement) {
  if (!requirement.sourcePageStart) return undefined;
  if (requirement.sourcePageEnd && requirement.sourcePageEnd !== requirement.sourcePageStart) {
    return `pp. ${requirement.sourcePageStart}-${requirement.sourcePageEnd}`;
  }
  return `p. ${requirement.sourcePageStart}`;
}

function requirementSourceLine(requirement: Requirement) {
  return [requirementSourcePrimary(requirement), requirementSourceSecondary(requirement)]
    .filter(Boolean)
    .join(" · ");
}

function requirementSourcePrimary(requirement: Requirement) {
  if (!requirement.sourceDocumentId && !requirement.clientRequirementSource) {
    return "Internal requirement";
  }
  return (
    requirement.sourceDocumentName ??
    requirement.clientRequirementSource?.clientOrg?.name ??
    REQUIREMENT_SOURCE_TYPE_LABELS[sourceType(requirement)]
  );
}

function requirementSourceSecondary(requirement: Requirement) {
  if (!requirement.sourceDocumentId && !requirement.clientRequirementSource) {
    return "";
  }
  return [
    requirement.sourceDocumentName ? REQUIREMENT_SOURCE_TYPE_LABELS[sourceType(requirement)] : undefined,
    requirement.clientRequirementSource?.clientOrg
      ? `Required by ${requirement.clientRequirementSource.clientOrg.name}`
      : undefined,
    pageLabel(requirement),
  ]
    .filter(Boolean)
    .join(" · ");
}

function requirementTableSourceSecondary(requirement: Requirement) {
  return [
    requirement.sourceDocumentName && requirement.clientRequirementSource?.clientOrg
      ? `Required by ${requirement.clientRequirementSource.clientOrg.name}`
      : undefined,
    pageLabel(requirement),
  ]
    .filter(Boolean)
    .join(" · ");
}

function statusMeta(status?: ComplianceStatus) {
  switch (status) {
    case "met":
      return {
        label: "Met",
        tone: "success" as StatusTagTone,
        icon: CheckCircle2,
      };
    case "expiring_soon":
      return {
        label: "Expiring",
        tone: "warning" as StatusTagTone,
        icon: Clock,
      };
    case "unverified":
      return {
        label: "Unverified",
        tone: "warning" as StatusTagTone,
        icon: AlertCircle,
      };
    case "expired":
    case "not_met":
      return {
        label: status === "expired" ? "Expired" : "Not met",
        tone: "danger" as StatusTagTone,
        icon: AlertCircle,
      };
    default:
      return {
        label: "Defined",
        tone: "neutral" as StatusTagTone,
        icon: ShieldCheck,
      };
  }
}

function ComplianceStatusTag({ status }: { status?: ComplianceStatus }) {
  const meta = statusMeta(status);
  const Icon = meta.icon;
  return (
    <StatusTag tone={meta.tone}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </StatusTag>
  );
}

function needsAttention(status?: ComplianceStatus) {
  return status === "not_met" || status === "expired";
}

function matchedPolicyIdsForRequirement(requirement: Requirement) {
  return Array.from(
    new Set(
      [
        ...(requirement.complianceCheck?.matchedPolicyIds ?? []),
        requirement.complianceCheck?.matchedPolicy?._id,
      ].filter((id): id is Id<"policies"> => Boolean(id)),
    ),
  );
}

function PolicyTagList({
  policyIds,
  emptyLabel,
}: {
  policyIds: Id<"policies">[];
  emptyLabel?: string;
}) {
  if (policyIds.length === 0) {
    return emptyLabel ? <span className="text-muted-foreground">{emptyLabel}</span> : null;
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {policyIds.slice(0, 3).map((policyId) => (
        <PolicyCitation key={policyId} id={policyId} />
      ))}
      {policyIds.length > 3 ? (
        <Badge variant="outline" className={`h-5 rounded-full px-1.5 text-muted-foreground ${typeStyle("label.tag")}`}>
          +{policyIds.length - 3}
        </Badge>
      ) : null}
    </div>
  );
}

function EmptyState() {
  return (
    <OperationalPanel as="div" className="p-5">
      <p className={`text-foreground ${typeStyle("body.medium")}`}>No coverage requirements yet</p>
      <p className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}>
        Add coverage rules manually or extract them from a lease, client contract, or vendor
        requirement packet.
      </p>
    </OperationalPanel>
  );
}

function ComplianceMeter({ met, total }: { met: number; total: number }) {
  return (
    <Meter.Root
      value={met}
      min={0}
      max={Math.max(total, 1)}
      aria-label={`${met} of ${total} met`}
      getAriaValueText={() => `${met} of ${total} met`}
    >
      <Meter.Track className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <Meter.Indicator className="h-full rounded-full bg-emerald-500" />
      </Meter.Track>
    </Meter.Root>
  );
}

function OverviewTab({
  requirements,
  onOpenRequirements,
}: {
  requirements: Requirement[];
  onOpenRequirements: (lineOfBusiness: string) => void;
}) {
  const checked = requirements.filter((requirement) => requirement.complianceCheck);
  const lobGroups = new Map<string, Requirement[]>();
  for (const requirement of checked) {
    const key = requirement.lineOfBusiness ?? "UN";
    lobGroups.set(key, [...(lobGroups.get(key) ?? []), requirement]);
  }
  const sortedGroups = Array.from(lobGroups.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  if (checked.length === 0) return <EmptyState />;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        {sortedGroups.map(([lob, rows]) => {
          const groupMet = rows.filter(
            (requirement) => requirement.complianceCheck?.status === "met",
          ).length;
          const groupAttention = rows.filter(
            (requirement) => needsAttention(requirement.complianceCheck?.status),
          ).length;
          const groupExpiring = rows.filter(
            (requirement) => requirement.complianceCheck?.status === "expiring_soon",
          ).length;
          return (
            <ActionSurface
              key={lob}
              role="button"
              tabIndex={0}
              onClick={() => onOpenRequirements(lob)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenRequirements(lob);
                }
              }}
              className="cursor-pointer px-4 py-3"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <p className={`min-w-0 truncate text-foreground ${typeStyle("body.medium")}`}>
                  {lineDisplayLabel(lob)}
                </p>
                {groupAttention > 0 ? (
                  <StatusTag tone="danger" className="shrink-0">
                    {groupAttention} needs attention
                  </StatusTag>
                ) : groupExpiring > 0 ? (
                  <StatusTag tone="warning" className="shrink-0">
                    {groupExpiring} expiring
                  </StatusTag>
                ) : (
                  <StatusTag tone="success" className="shrink-0">
                    Met
                  </StatusTag>
                )}
              </div>
              <p className={`mt-2 text-muted-foreground ${typeStyle("caption.default")}`}>
                {groupMet} of {rows.length} requirements met
              </p>
              <div className="mt-3">
                <ComplianceMeter met={groupMet} total={rows.length} />
              </div>
              <div className={`mt-1.5 flex items-center justify-between text-muted-foreground ${typeStyle("caption.default")}`}>
                <span>{groupMet} met</span>
                <span>{rows.length} total</span>
              </div>
            </ActionSurface>
          );
        })}
      </div>
    </div>
  );
}

function RequirementsTable({
  requirements,
  onSelect,
}: {
  requirements: Requirement[];
  onSelect: (requirementId: Id<"insuranceRequirements">) => void;
}) {
  const sorted = [...requirements].sort((a, b) => {
    const lobCompare = (a.lineOfBusiness ?? "ZZ").localeCompare(b.lineOfBusiness ?? "ZZ");
    return lobCompare !== 0 ? lobCompare : a.title.localeCompare(b.title);
  });
  return (
    <OperationalPanel as="div">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Line</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Limit</TableHead>
            <TableHead>Limit type</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((requirement) => {
            const limits = requirement.limits ?? [];
            const sourceSecondary = requirementTableSourceSecondary(requirement);
            return (
              <TableRow
                key={requirement._id}
                className="cursor-pointer"
                onClick={() => onSelect(requirement._id)}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(requirement._id);
                  }
                }}
              >
                <TableCell className={`text-foreground ${typeStyle("body.medium")}`}>
                  {lineDisplayLabel(requirement.lineOfBusiness)}
                </TableCell>
                <TableCell>
                  <p className="text-foreground">{requirementSourcePrimary(requirement)}</p>
                  {sourceSecondary ? (
                    <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>{sourceSecondary}</p>
                  ) : null}
                </TableCell>
                <TableCell className={`text-foreground ${typeStyle("data.numeric")}`}>
                  {limits.length > 0
                    ? limits.map((limit, index) => (
                        <p key={index} className={`${typeStyle("body.default")}`}>{formatMoneyCompact(limit.amount)}</p>
                      ))
                    : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {limits.length > 0
                    ? limits.map((limit, index) => (
                        <p key={index} className={`${typeStyle("body.default")}`}>{limitKindLabel(limit.kind)}</p>
                      ))
                    : (requirement.provisions ?? []).length > 0
                      ? "Provisions"
                      : "—"}
                </TableCell>
                <TableCell>
                  {requirement.complianceCheck ? (
                    <ComplianceStatusTag status={requirement.complianceCheck.status} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </OperationalPanel>
  );
}

function RequirementsFilterSelect({
  label,
  value,
  valueLabel,
  onValueChange,
  children,
}: {
  label: string;
  value: string;
  valueLabel: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
      {label}
      <Select value={value} onValueChange={(next) => next && onValueChange(next)}>
        <SelectTrigger className="w-full">
          <SelectValue>{valueLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </label>
  );
}

function DrawerDetail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={`grid grid-cols-[10rem_1fr] gap-3 ${typeStyle("body.default")}`}>
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0 break-words text-foreground">{value}</div>
    </div>
  );
}

function normalizeCheckNote(value: string | undefined) {
  return value?.replace(/\s+/g, " ").trim().toLowerCase();
}

function latestCheckNote(check: Requirement["complianceCheck"]) {
  const note = check?.notes?.trim();
  const policy = check?.matchedPolicy;
  if (!note) return undefined;
  if (policy) {
    const matchedSummary = `Matched ${policy.carrier ?? "policy"} ${policy.policyNumber ?? ""}`;
    if (normalizeCheckNote(note) === normalizeCheckNote(matchedSummary)) return undefined;
  }
  return note;
}

function RequirementDrawer({
  requirement,
  checking,
  canManage,
  writeRestriction,
  onDeepCheck,
  onGenerate,
  onSave,
  onArchive,
  onClose,
}: {
  requirement: Requirement;
  checking: boolean;
  canManage: boolean;
  writeRestriction: string | null;
  onDeepCheck: (requirement: Requirement) => void;
  onGenerate: (requirement: Requirement) => void;
  onSave: (requirement: Requirement, values: RequirementEditValues) => Promise<void>;
  onArchive: (requirementId: Id<"insuranceRequirements">) => void;
  onClose: () => void;
}) {
  const [confirmArchive, setConfirmArchive] = useState(false);
  const editRef = useRef<{ save: () => Promise<boolean> }>(null);
  const check = requirement.complianceCheck;
  const policy = check?.matchedPolicy;
  const policyIds = matchedPolicyIdsForRequirement(requirement);
  const checkNote = latestCheckNote(check);
  const deepCheckAvailableForRequirement =
    requirement.canArchive !== false &&
    requirement.scope === "own_org" &&
    check &&
    check.status !== "met";
  const canDeepCheck = canManage && deepCheckAvailableForRequirement;
  const detectedLimit = policy?.coverageLimit ?? formatMoney(policy?.detectedLimitAmount);
  return (
    <SettingsDrawer
      open
      onOpenChange={async (open) => {
        if (!open && (!editRef.current || await editRef.current.save())) onClose();
      }}
      title={requirement.title}
      actions={check ? <ComplianceStatusTag status={check.status} /> : undefined}
      footer={
        <>
          {canManage && requirement.canArchive !== false ? (
            confirmArchive ? (
              <>
                <PillButton
                  type="button"
                  variant="secondary"
                  onClick={() => setConfirmArchive(false)}
                >
                  Keep requirement
                </PillButton>
                <PillButton
                  type="button"
                  variant="destructive"
                  onClick={() => onArchive(requirement._id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Confirm archive
                </PillButton>
              </>
            ) : (
              <PillButton
                type="button"
                variant="destructive"
                onClick={() => setConfirmArchive(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Archive
              </PillButton>
            )
          ) : null}
          {canDeepCheck ? (
            <PillButton type="button" disabled={checking} onClick={() => onDeepCheck(requirement)}>
              {checking
                ? "Checking…"
                : check?.checkedBy === "agent"
                  ? "Run deeper check again"
                  : "Run deeper check"}
            </PillButton>
          ) : deepCheckAvailableForRequirement && writeRestriction ? (
            <p className={`max-w-72 text-right text-muted-foreground ${typeStyle("caption.default")}`}>
              {writeRestriction}
            </p>
          ) : null}
          {canManage && requirement.sourceDocumentId ? (
            <PillButton type="button" onClick={() => onGenerate(requirement)}>
              <BadgeCheck className="h-3.5 w-3.5" />
              Generate certificate
            </PillButton>
          ) : null}
        </>
      }
    >
      <div className="space-y-5">
        {confirmArchive ? (
          <OperationalPanel as="div" className="border-destructive/20 bg-destructive/5 p-4">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
              <div>
                <p className={`text-foreground ${typeStyle("body.medium")}`}>
                  Archive this requirement?
                </p>
                <p className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}>
                  It will disappear from active compliance and certificate planning.
                </p>
              </div>
            </div>
          </OperationalPanel>
        ) : null}
        {canManage && requirement.canArchive !== false ? (
          <RequirementEditForm
            key={requirement._id}
            ref={editRef}
            requirement={requirement}
            onSave={(values) => onSave(requirement, values)}
          />
        ) : (
          <>
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>{requirement.requirementText}</p>
            <section className="space-y-2 border-t border-border pt-5">
              {requirement.lineOfBusiness ? (
                <DrawerDetail label="Line" value={lineDisplayLabel(requirement.lineOfBusiness)} />
              ) : null}
              {(requirement.limits ?? []).map((limit, index) => (
                <DrawerDetail
                  key={index}
                  label={limitKindLabel(limit.kind)}
                  value={formatMoney(limit.amount) ?? String(limit.amount)}
                />
              ))}
              {requirement.maxDeductible ? (
                <DrawerDetail
                  label="Max deductible"
                  value={formatMoney(requirement.maxDeductible.amount) ?? ""}
                />
              ) : null}
              {requirement.coverageForm ? (
                <DrawerDetail
                  label="Coverage form"
                  value={requirement.coverageForm === "claims_made" ? "Claims-made" : "Occurrence"}
                />
              ) : null}
              {(requirement.provisions ?? []).length > 0 ? (
                <DrawerDetail
                  label="Provisions"
                  value={(requirement.provisions ?? []).map(provisionLabel).join(", ")}
                />
              ) : null}
              {(requirement.requiredForms ?? []).length > 0 ? (
                <DrawerDetail label="Required forms" value={(requirement.requiredForms ?? []).join(", ")} />
              ) : null}
              <DrawerDetail label="Source" value={requirementSourceLine(requirement)} />
            </section>
          </>
        )}
        {check ? (
          <section className="space-y-2 border-t border-border pt-5">
            <p className={`text-muted-foreground/60 ${typeStyle("body.medium")}`}>
              Latest check
            </p>
            {policy || policyIds.length > 0 ? (
              <>
                {policyIds.length > 0 ? (
                  <DrawerDetail label="Matched policy" value={<PolicyTagList policyIds={policyIds} />} />
                ) : policy ? (
                  <DrawerDetail
                    label="Matched policy"
                    value={[policy.carrier, policy.policyNumber].filter(Boolean).join(" · ")}
                  />
                ) : null}
                {policy?.coverageName ? (
                  <DrawerDetail label="Coverage" value={policy.coverageName} />
                ) : null}
                {detectedLimit ? (
                  <DrawerDetail label="Current limit" value={detectedLimit} />
                ) : null}
                {policy?.expirationDate ? (
                  <DrawerDetail
                    label="Expires"
                    value={formatDisplayDate(
                      policy.expirationDate,
                      policy.expirationDate,
                    )}
                  />
                ) : null}
              </>
            ) : (
              <p className={`text-muted-foreground ${typeStyle("body.default")}`}>No current policy match.</p>
            )}
            {checkNote ? (
              <p className={`text-muted-foreground ${typeStyle("body.default")}`}>{checkNote}</p>
            ) : null}
          </section>
        ) : null}
      </div>
    </SettingsDrawer>
  );
}

function RequirementsLoadingSkeleton() {
  return <OperationalSkeletonList rows={4} />;
}

type RequirementLimitEdit = {
  kind: RequirementLimitKind;
  amount: number;
  label?: string;
};

type RequirementEditValues = {
  title: string;
  lineOfBusiness: string;
  limits?: RequirementLimitEdit[];
  provisions?: RequirementProvision[];
  requirementText: string;
};

type SourceUpdatePatch = {
  title?: string;
  sourceType?: RequirementSourceDocumentType;
  dealName?: string;
  dealType?: string;
  internalNotes?: string;
  holder?: {
    displayName: string;
    contactName?: string;
    email?: string;
    phone?: string;
    address?: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      country?: string;
      formatted?: string;
    };
  };
};

type LimitDraft = {
  id: string;
  kind: RequirementLimitKind;
  amount: string;
};

function limitDraftsForRequirement(requirement: Requirement): LimitDraft[] {
  return (requirement.limits ?? []).map((limit, index) => ({
    id: `${requirement._id}:${index}`,
    kind: asRequirementLimitKind(limit.kind),
    amount: String(limit.amount),
  }));
}

function provisionsForRequirement(requirement: Requirement): RequirementProvision[] {
  return (requirement.provisions ?? []).filter((provision): provision is RequirementProvision =>
    (PROVISION_OPTIONS as readonly string[]).includes(provision),
  );
}

type RequirementEditDrafts = {
  title: string;
  lineOfBusiness: string;
  limitDrafts: LimitDraft[];
  provisions: RequirementProvision[];
  requirementText: string;
};

function requirementEditValuesFromDrafts(
  drafts: RequirementEditDrafts,
): RequirementEditValues | "invalid_amount" {
  const limits: RequirementLimitEdit[] = [];
  for (const draft of drafts.limitDrafts) {
    if (!draft.amount.trim()) continue;
    const amount = parseMoneyInput(draft.amount);
    if (amount === undefined) return "invalid_amount";
    limits.push({ kind: draft.kind, amount, label: draft.amount.trim() });
  }
  return {
    title: drafts.title.trim(),
    lineOfBusiness: drafts.lineOfBusiness,
    limits: limits.length > 0 ? limits : undefined,
    provisions: drafts.provisions.length > 0 ? drafts.provisions : undefined,
    requirementText: drafts.requirementText.trim(),
  };
}

export function RequirementEditForm({
  ref,
  requirement,
  onSave,
  onArchive,
}: {
  requirement: Requirement;
  onSave: (values: RequirementEditValues) => Promise<void>;
  onArchive?: () => void;
  ref?: Ref<{ save: () => Promise<boolean> }>;
}) {
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [title, setTitle] = useState(requirement.title);
  const [lineOfBusiness, setLineOfBusiness] = useState(requirement.lineOfBusiness ?? "CGL");
  const [limitDrafts, setLimitDrafts] = useState<LimitDraft[]>(() =>
    limitDraftsForRequirement(requirement),
  );
  const [provisions, setProvisions] = useState<RequirementProvision[]>(() =>
    provisionsForRequirement(requirement),
  );
  const [requirementText, setRequirementText] = useState(requirement.requirementText);
  const [textFieldFocused, setTextFieldFocused] = useState(false);
  const editValues = requirementEditValuesFromDrafts({
    title,
    lineOfBusiness,
    limitDrafts,
    provisions,
    requirementText,
  });
  const validEditValues = editValues === "invalid_amount" ? null : editValues;
  const editValueKey = JSON.stringify({
    title,
    lineOfBusiness,
    limitDrafts,
    provisions,
    requirementText,
  });
  const autoSave = useLocalFirstAutoSave({
    mutationName: `compliance.updateRequirement.${requirement._id}`,
    args: validEditValues ?? {
      title: "",
      lineOfBusiness,
      requirementText: "",
    },
    valueKey: editValueKey,
    resetKey: requirement._id,
    canSave:
      !!validEditValues?.title &&
      !!validEditValues.requirementText,
    autoSave: !textFieldFocused,
    delayMs: 0,
    flush: onSave,
    errorMessage: "The requirement could not be saved.",
  });

  useImperativeHandle(ref, () => ({ save: autoSave.saveNow }), [autoSave.saveNow]);

  return (
    <div className="space-y-3">
      <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
        Title
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onFocus={() => setTextFieldFocused(true)}
          onBlur={() => {
            setTextFieldFocused(false);
            void autoSave.saveNow();
          }}
          required
        />
        {!title.trim() ? <span className="text-destructive">Title is required.</span> : null}
      </label>
      <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
        Line
        <Select
          value={lineOfBusiness}
          onValueChange={(value) => {
            if (!value || value === lineOfBusiness) return;
            setLineOfBusiness(value);
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue>{lobLabel(lineOfBusiness)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {COMMON_LOBS.map((code) => (
              <SelectItem key={code} value={code}>{lobLabel(code)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <FormSection
        title="Limits"
        action={
          <PillButton
            type="button"
            size="compact"
            variant="secondary"
            onClick={() =>
              setLimitDrafts((current) => [
                ...current,
                {
                  id: `limit:${dayjs().valueOf()}:${current.length}`,
                  kind: "per_occurrence",
                  amount: "",
                },
              ])
            }
          >
            Add limit
          </PillButton>
        }
      >
        {editValues === "invalid_amount" ? (
          <p className={`text-destructive ${typeStyle("caption.default")}`}>Enter a valid limit amount.</p>
        ) : null}
        {limitDrafts.length === 0 ? (
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            No explicit limits. Add one or rely on provisions.
          </p>
        ) : (
          <div className="space-y-2">
            {limitDrafts.map((draft) => (
              <div
                key={draft.id}
                className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-center gap-2"
              >
                <Select
                  value={draft.kind}
                  onValueChange={(value) => {
                    if (!value || value === draft.kind) return;
                    const next = limitDrafts.map((item) =>
                      item.id === draft.id
                        ? { ...item, kind: value as RequirementLimitKind }
                        : item,
                    );
                    setLimitDrafts(next);
                  }}
                >
                  <SelectTrigger
                    className="w-full min-w-0"
                    aria-label="Limit type"
                  >
                    <SelectValue>{REQUIREMENT_LIMIT_KIND_LABELS[draft.kind]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {LIMIT_KIND_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {REQUIREMENT_LIMIT_KIND_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={draft.amount}
                  onChange={(event) =>
                    setLimitDrafts((current) =>
                      current.map((item) =>
                        item.id === draft.id
                          ? { ...item, amount: event.target.value }
                          : item,
                      ),
                    )
                  }
                  onFocus={() => setTextFieldFocused(true)}
                  onBlur={() => {
                    setTextFieldFocused(false);
                    void autoSave.saveNow();
                  }}
                  placeholder="$1,000,000"
                  aria-label="Limit amount"
                />
                <PillButton
                  type="button"
                  variant="icon"
                  onClick={() => {
                    const next = limitDrafts.filter((item) => item.id !== draft.id);
                    setLimitDrafts(next);
                  }}
                  aria-label="Remove limit"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </PillButton>
              </div>
            ))}
          </div>
        )}
      </FormSection>
      <div className="flex flex-wrap gap-2">
        {PROVISION_OPTIONS.map((option) => (
          <PillButton
            key={option}
            type="button"
            size="compact"
            variant={provisions.includes(option) ? "primary" : "secondary"}
            onClick={() => {
              const next = provisions.includes(option)
                ? provisions.filter((item) => item !== option)
                : [...provisions, option];
              setProvisions(next);
            }}
          >
            {REQUIREMENT_PROVISION_LABELS[option]}
          </PillButton>
        ))}
      </div>
      <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
        Requirement
        <Textarea
          className="min-h-28 resize-y"
          rows={5}
          value={requirementText}
          onChange={(event) => setRequirementText(event.target.value)}
          onFocus={() => setTextFieldFocused(true)}
          onBlur={() => {
            setTextFieldFocused(false);
            void autoSave.saveNow();
          }}
          required
        />
        {!requirementText.trim() ? (
          <span className="text-destructive">Requirement text is required.</span>
        ) : null}
      </label>
      <AutoSaveStatus status={autoSave.status} />
      {onArchive ? (
        <div className="flex items-center justify-end gap-3">
          {confirmArchive ? (
            <>
              <span className={`mr-auto text-muted-foreground ${typeStyle("caption.default")}`}>
                Remove this requirement from active compliance?
              </span>
              <PillButton
                type="button"
                size="compact"
                variant="secondary"
                onClick={() => setConfirmArchive(false)}
              >
                Keep
              </PillButton>
              <PillButton
                type="button"
                size="compact"
                variant="destructive"
                onClick={onArchive}
              >
                Confirm archive
              </PillButton>
            </>
          ) : (
            <PillButton
              type="button"
              size="compact"
              variant="destructive"
              onClick={() => setConfirmArchive(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Archive requirement
            </PillButton>
          )}
        </div>
      ) : null}
    </div>
  );
}

function requirementDrawerSummary(requirement: Requirement) {
  const limits = requirement.limits ?? [];
  const limitSummary =
    limits.length > 0
      ? limits
          .map((limit) => `${limitKindLabel(limit.kind)} ${formatMoneyCompact(limit.amount)}`)
          .join(", ")
      : (requirement.provisions ?? []).length > 0
        ? (requirement.provisions ?? []).map(provisionLabel).join(", ")
        : "No limit";
  return [lineDisplayLabel(requirement.lineOfBusiness), limitSummary].join(" · ");
}

function SourceDrawer({
  source,
  requirements,
  certificates,
  archiving,
  canManage,
  writeRestriction,
  onUpdateSource,
  onSaveRequirement,
  onArchiveRequirement,
  onArchiveSource,
  onGenerate,
  onViewCertificate,
  onClose,
}: {
  source: RequirementSource;
  requirements: Requirement[] | undefined;
  certificates: SourceCertificate[] | undefined;
  archiving: boolean;
  canManage: boolean;
  writeRestriction: string | null;
  onUpdateSource: (source: RequirementSource, patch: SourceUpdatePatch) => Promise<void>;
  onSaveRequirement: (
    requirement: Requirement,
    values: RequirementEditValues,
  ) => Promise<void>;
  onArchiveRequirement: (requirementId: Id<"insuranceRequirements">) => Promise<void>;
  onArchiveSource: (sourceId: Id<"requirementSourceDocuments">) => Promise<boolean>;
  onGenerate: (source: RequirementSource) => void;
  onViewCertificate: (url: string) => void;
  onClose: () => void;
}) {
  const [titleDraft, setTitleDraft] = useState(source.title);
  const [sourceTypeDraft, setSourceTypeDraft] = useState<RequirementSourceDocumentType>(
    source.sourceType,
  );
  const [titleFocused, setTitleFocused] = useState(false);
  const [holderName, setHolderName] = useState(source.holder?.displayName ?? "");
  const [holderContactName, setHolderContactName] = useState(source.holder?.contactName ?? "");
  const [holderEmail, setHolderEmail] = useState(source.holder?.email ?? "");
  const [holderPhone, setHolderPhone] = useState(source.holder?.phone ?? "");
  const [addressLine1, setAddressLine1] = useState(source.holder?.address?.line1 ?? "");
  const [addressLine2, setAddressLine2] = useState(source.holder?.address?.line2 ?? "");
  const [city, setCity] = useState(source.holder?.address?.city ?? "");
  const [state, setState] = useState(source.holder?.address?.state ?? "");
  const [postalCode, setPostalCode] = useState(source.holder?.address?.postalCode ?? "");
  const [country, setCountry] = useState(source.holder?.address?.country ?? "");
  const [dealName, setDealName] = useState(source.dealName ?? "");
  const [dealType, setDealType] = useState(source.dealType ?? "");
  const [internalNotes, setInternalNotes] = useState(source.internalNotes ?? "");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [expandedRequirementId, setExpandedRequirementId] =
    useState<Id<"insuranceRequirements"> | null>(null);

  const sourceAutoSave = useLocalFirstAutoSave({
    mutationName: `compliance.updateRequirementSource.${source._id}`,
    args: {
      title: titleDraft.trim(),
      sourceType: sourceTypeDraft,
    },
    resetKey: source._id,
    enabled: canManage,
    canSave: !!titleDraft.trim(),
    autoSave: !titleFocused,
    delayMs: 0,
    flush: (args) => onUpdateSource(source, args),
    errorMessage: "The requirement source could not be saved.",
  });

  const hasHolderDetails = !!source.holder || [
    holderName, holderContactName, holderEmail, holderPhone,
    addressLine1, addressLine2, city, state, postalCode, country,
  ].some((value) => value.trim());
  const contextAutoSave = useLocalFirstAutoSave({
    mutationName: `compliance.updateRequirementSource.context.${source._id}`,
    args: {
      holder: holderName.trim() ? {
        displayName: holderName.trim(),
        contactName: holderContactName.trim() || undefined,
        email: holderEmail.trim() || undefined,
        phone: holderPhone.trim() || undefined,
        address: {
          line1: addressLine1.trim() || undefined,
          line2: addressLine2.trim() || undefined,
          city: city.trim() || undefined,
          state: state.trim() || undefined,
          postalCode: postalCode.trim() || undefined,
          country: country.trim() || undefined,
        },
      } : undefined,
      dealName,
      dealType,
      internalNotes,
    },
    resetKey: source._id,
    enabled: canManage,
    canSave: !hasHolderDetails || !!holderName.trim(),
    flush: (args) => onUpdateSource(source, args),
    errorMessage: "The requirement source details could not be saved.",
  });

  async function archiveSource() {
    const archived = await onArchiveSource(source._id);
    if (archived) onClose();
  }

  return (
    <SettingsDrawer
      open
      onOpenChange={async (open) => {
        if (!open && await sourceAutoSave.saveNow() && await contextAutoSave.saveNow()) onClose();
      }}
      title="Requirement source"
      footer={
        canManage ? (
          <>
            {confirmArchive ? (
              <>
                <PillButton
                  type="button"
                  variant="secondary"
                  disabled={archiving}
                  onClick={() => setConfirmArchive(false)}
                >
                  Keep source
                </PillButton>
                <PillButton
                  type="button"
                  variant="destructive"
                  disabled={archiving}
                  onClick={() => void archiveSource()}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {archiving ? "Archiving..." : "Confirm archive"}
                </PillButton>
              </>
            ) : (
              <PillButton
                type="button"
                variant="destructive"
                disabled={archiving || contextAutoSave.status === "saving"}
                onClick={() => setConfirmArchive(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Archive source
              </PillButton>
            )}
            <PillButton
              type="button"
              disabled={!source.holder || source.requirementCount === 0}
              onClick={() => onGenerate(source)}
            >
              <BadgeCheck className="h-3.5 w-3.5" />
              Generate certificates
            </PillButton>
          </>
        ) : writeRestriction ? (
          <p className={`max-w-72 text-right text-muted-foreground ${typeStyle("caption.default")}`}>
            {writeRestriction}
          </p>
        ) : null
      }
    >
      {canManage ? (
        <AutoSaveStatus status={sourceAutoSave.status} />
      ) : null}
      <div className="space-y-5">
        {confirmArchive ? (
          <OperationalPanel as="div" className="border-destructive/20 bg-destructive/5 p-4">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
              <div>
                <p className={`text-foreground ${typeStyle("body.medium")}`}>
                  Archive this source and its requirements?
                </p>
                <p className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}>
                  {source.requirementCount === 0
                    ? "The source will disappear from active compliance."
                    : `${source.requirementCount} active requirement${source.requirementCount === 1 ? "" : "s"} will also be archived.`}
                </p>
              </div>
            </div>
          </OperationalPanel>
        ) : null}
        <section className="space-y-3">
          <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
            Name
            <Input
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onFocus={() => setTitleFocused(true)}
              onBlur={() => {
                setTitleFocused(false);
                void sourceAutoSave.saveNow();
              }}
              disabled={!canManage}
            />
            {!titleDraft.trim() ? (
              <span className="text-destructive">Source name is required.</span>
            ) : null}
          </label>
          <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
            Source type
            <Select
              value={sourceTypeDraft}
              disabled={!canManage}
              onValueChange={(value) => {
                if (value) setSourceTypeDraft(value as RequirementSourceDocumentType);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{REQUIREMENT_SOURCE_TYPE_LABELS[sourceTypeDraft]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {REQUIREMENT_SOURCE_DOCUMENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {REQUIREMENT_SOURCE_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </section>
        <FormSection
          title="Certificate holder"
          description="The holder requesting proof and the source requirements stay together."
        >
          <div className="space-y-3">
            <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
              Holder name
              <Input value={holderName} onChange={(event) => setHolderName(event.target.value)} disabled={!canManage} placeholder="Landlord, lender, investor, or client" />
            </label>
            <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
              Contact
              <Input value={holderContactName} onChange={(event) => setHolderContactName(event.target.value)} disabled={!canManage} />
            </label>
            <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
              Email
              <Input type="email" value={holderEmail} onChange={(event) => setHolderEmail(event.target.value)} disabled={!canManage} />
            </label>
            <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
              Phone
              <PhoneInput value={holderPhone || undefined} onChange={(value) => setHolderPhone(value ?? "")} defaultCountry="US" disabled={!canManage} />
            </label>
            <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
              Address
              <AddressAutofillInput
                id={`requirement-source-holder-address-${source._id}`}
                value={{ street1: addressLine1, street2: addressLine2, city, state, zip: postalCode, country }}
                onChange={(address) => {
                  setAddressLine1(address.street1 ?? "");
                  setAddressLine2(address.street2 ?? "");
                  setCity(address.city ?? "");
                  setState(address.state ?? "");
                  setPostalCode(address.zip ?? "");
                  setCountry(address.country ?? "");
                }}
                display="street1"
                disabled={!canManage}
              />
            </label>
            <div className="grid grid-cols-[minmax(0,1fr)_72px_96px] gap-2">
              <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>City<Input value={city} onChange={(event) => setCity(event.target.value)} disabled={!canManage} /></label>
              <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>State<Input value={state} onChange={(event) => setState(event.target.value)} disabled={!canManage} /></label>
              <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>ZIP<Input value={postalCode} onChange={(event) => setPostalCode(event.target.value)} disabled={!canManage} /></label>
            </div>
          </div>
        </FormSection>
        <FormSection title="Deal context" description="Keep the request, relationship, and internal context in one place.">
          <div className="space-y-3">
            <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>Deal name<Input value={dealName} onChange={(event) => setDealName(event.target.value)} disabled={!canManage} placeholder="Office lease, Series B financing, client engagement" /></label>
            <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>Deal type<Input value={dealType} onChange={(event) => setDealType(event.target.value)} disabled={!canManage} placeholder="Lease, investment, contract" /></label>
            <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>Internal notes<Textarea value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} disabled={!canManage} rows={4} /></label>
            {hasHolderDetails && !holderName.trim() ? (
              <p className={`text-destructive ${typeStyle("caption.default")}`}>
                Certificate holder name is required.
              </p>
            ) : null}
            <AutoSaveStatus status={contextAutoSave.status} />
          </div>
        </FormSection>
        <section className="space-y-2 border-t border-border pt-5">
          {source.fileName ? <DrawerDetail label="File" value={source.fileName} /> : null}
          <DrawerDetail
            label="Added"
            value={formatDisplayDate(source.createdAt)}
          />
          <DrawerDetail label="Requirements" value={source.requirementCount} />
        </section>
        <FormSection
          title="Certificates"
          description="Certificates generated to fulfill this requirement source."
        >
          {certificates === undefined ? (
            <OperationalSkeletonList rows={2} />
          ) : certificates.length === 0 ? (
            <OperationalPanel as="div" className="p-4">
              <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
                No certificates have been generated for this source yet.
              </p>
            </OperationalPanel>
          ) : (
            <div className="space-y-2">
              {certificates.map((certificate) => (
                <OperationalPanel
                  key={certificate._id}
                  as="div"
                  className="flex items-center gap-3 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-foreground ${typeStyle("label.field")}`}>
                      {certificate.fileName ?? `Certificate v${certificate.versionNumber}`}
                    </p>
                    <p className={`truncate text-muted-foreground ${typeStyle("caption.default")}`}>
                      {[certificate.policy?.carrier, certificate.policy?.policyNumber, formatDisplayDate(certificate.createdAt)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {certificate.url ? (
                    <PillButton
                      type="button"
                      size="compact"
                      variant="secondary"
                      onClick={() => onViewCertificate(certificate.url!)}
                    >
                      View
                    </PillButton>
                  ) : null}
                </OperationalPanel>
              ))}
            </div>
          )}
        </FormSection>
        <FormSection
          title="Requirements"
          description={
            canManage
              ? "Edit the coverage requirements extracted from this source."
              : "Review the coverage requirements extracted from this source."
          }
        >
          {requirements === undefined ? (
            <OperationalSkeletonList rows={3} />
          ) : requirements.length === 0 ? (
            <OperationalPanel as="div" className="p-4">
              <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
                No active requirements are attached to this source.
              </p>
            </OperationalPanel>
          ) : (
            <div className="space-y-2">
              {requirements.map((requirement) => {
                const expanded = expandedRequirementId === requirement._id;
                return (
                  <div
                    key={requirement._id}
                    className="rounded-md border border-input bg-background"
                  >
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 px-3 py-3 text-left"
                      aria-expanded={expanded}
                      onClick={() =>
                        setExpandedRequirementId(expanded ? null : requirement._id)
                      }
                    >
                      {expanded ? (
                        <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-foreground ${typeStyle("body.medium")}`}>
                          {requirement.title}
                        </span>
                        <span className={`block truncate text-muted-foreground ${typeStyle("caption.default")}`}>
                          {requirementDrawerSummary(requirement)}
                        </span>
                      </span>
                    </button>
                    {expanded && canManage ? (
                      <div className="border-t border-border px-3 pb-3 pt-3">
                        <RequirementEditForm
                          requirement={requirement}
                          onSave={(values) => onSaveRequirement(requirement, values)}
                          onArchive={() => void onArchiveRequirement(requirement._id)}
                        />
                      </div>
                    ) : expanded ? (
                      <div className="space-y-2 border-t border-border px-3 pb-3 pt-3">
                        <DrawerDetail
                          label="Line"
                          value={lineDisplayLabel(requirement.lineOfBusiness)}
                        />
                        <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
                          {requirement.requirementText}
                        </p>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </FormSection>
      </div>
    </SettingsDrawer>
  );
}

function RequirementSourcesTable({
  sources,
  onSelect,
}: {
  sources: RequirementSource[];
  onSelect: (sourceId: Id<"requirementSourceDocuments">) => void;
}) {
  if (sources.length === 0) {
    return (
      <OperationalPanel as="div" className="p-5">
        <p className={`text-foreground ${typeStyle("body.medium")}`}>No requirement sources yet</p>
        <p className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}>
          Imported leases, client contracts, and vendor requirement packets will appear here.
        </p>
      </OperationalPanel>
    );
  }

  return (
    <OperationalPanel as="div">
      <Table className="min-w-[840px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[44%] px-4">Name</TableHead>
            <TableHead className="w-[22%]">Source type</TableHead>
            <TableHead className="w-[14%]">Requirements</TableHead>
            <TableHead className="w-[20%] px-4">Added</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sources.map((source) => (
            <TableRow
              key={source._id}
              className="cursor-pointer"
              onClick={() => onSelect(source._id)}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(source._id);
                }
              }}
            >
              <TableCell className="max-w-72 px-4">
                <p className={`truncate text-foreground ${typeStyle("body.medium")}`}>{source.title}</p>
                {source.fileName ? (
                  <p className={`mt-1 truncate text-muted-foreground ${typeStyle("caption.default")}`}>
                    {source.fileName}
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {REQUIREMENT_SOURCE_TYPE_LABELS[source.sourceType]}
              </TableCell>
              <TableCell className={`text-foreground ${typeStyle("data.numeric")}`}>
                {source.requirementCount}
              </TableCell>
              <TableCell className="px-4 text-muted-foreground">
                {formatDisplayDate(source.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </OperationalPanel>
  );
}

function ComplianceWorkspace({
  orgContext,
  renderShell,
  renderCertificatesTab,
  surface,
}: CompliancePageProps & { surface: ComplianceSurface }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { openWithUrl } = usePdf();
  const routeOrg = useActiveOrgContext();
  const currentOrg = orgContext ?? routeOrg;
  useEffect(() => {
    if (!orgContext && currentOrg?.orgType === "broker") {
      router.replace("/broker");
    }
  }, [currentOrg?.orgType, orgContext, router]);

  const isBroker = currentOrg?.orgType === "broker";
  const orgId = !isBroker
    ? (currentOrg?.orgId as Id<"organizations"> | undefined)
    : undefined;
  const showConnectFeatures = isFeatureEnabled(currentOrg, "connect_features");

  const requirements = useCachedQuery(
    "compliance.listRequirements",
    complianceApi.compliance.listRequirements,
    orgId ? { orgId } : "skip",
  ) as Requirement[] | undefined;
  const requirementSources = useCachedQuery(
    "compliance.listRequirementSources",
    complianceApi.compliance.listRequirementSources,
    orgId ? { orgId } : "skip",
  ) as RequirementSource[] | undefined;
  const vendorRowsResult = useCachedConnectedVendors(
    orgId && showConnectFeatures ? orgId : undefined,
  ) as ConnectedOrgRow[] | undefined;
  const clientRowsResult = useCachedQuery(
    "connectedOrgs.listClients",
    complianceApi.connectedOrgs.listClients,
    orgId && showConnectFeatures ? { orgId } : "skip",
  ) as ConnectedOrgRow[] | undefined;

  const vendorRows = showConnectFeatures ? vendorRowsResult : [];
  const clientRows = showConnectFeatures ? clientRowsResult : [];
  const updateRequirements = useUpdateCachedQuery<Requirement[], { orgId: Id<"organizations"> }>("compliance.listRequirements");
  const updateRequirementSources = useUpdateCachedQuery<RequirementSource[], { orgId: Id<"organizations"> }>("compliance.listRequirementSources");
  const upsertRequirement = useMutation(complianceApi.compliance.upsertRequirement);
  const archiveRequirement = useMutation(complianceApi.compliance.archiveRequirement);
  const updateRequirementSource = useMutation(complianceApi.compliance.updateRequirementSource);
  const archiveRequirementSources = useMutation(complianceApi.compliance.archiveRequirementSources);
  const generateRequirementImportUploadUrl = useMutation(complianceApi.compliance.generateRequirementImportUploadUrl);
  const importRequirements = useAction(complianceApi.actions.complianceRequirements.importRequirements);
  const recheckOwnRequirement = useAction(complianceApi.actions.complianceReview.recheckOwnRequirement);

  const requestedTab = searchParams.get("tab");
  const hasCertificatesTab = Boolean(renderCertificatesTab);
  const view: ComplianceView =
    requestedTab === "certificates" && hasCertificatesTab
      ? "certificates"
      : requestedTab === "sources"
        ? "sources"
        : requestedTab === "overview" && surface !== "operator"
          ? "overview"
          : requestedTab === "requirements" ||
              requestedTab === "own_org" ||
              requestedTab === "vendors"
            ? "requirements"
            : surface === "operator"
              ? "requirements"
              : "overview";
  const [creationDrawer, setCreationDrawer] = useState<"import" | "manual" | null>(null);
  const [requirementScope, setRequirementScope] = useState<RequirementScope>("own_org");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [lineFilter, setLineFilter] = useState<LineFilter>("all");
  const [limitFilter, setLimitFilter] = useState<LimitFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedRequirementId, setSelectedRequirementId] = useState<Id<"insuranceRequirements"> | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<Id<"requirementSourceDocuments"> | null>(null);
  const [sourceText, setSourceText] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [sourceTypeValue, setSourceTypeValue] = useState<RequirementSourceDocumentType>("vendor_requirements");
  const [sourceHolderName, setSourceHolderName] = useState("");
  const [sourceHolderContactName, setSourceHolderContactName] = useState("");
  const [sourceHolderEmail, setSourceHolderEmail] = useState("");
  const [sourceHolderPhone, setSourceHolderPhone] = useState("");
  const [sourceAddressLine1, setSourceAddressLine1] = useState("");
  const [sourceAddressLine2, setSourceAddressLine2] = useState("");
  const [sourceCity, setSourceCity] = useState("");
  const [sourceState, setSourceState] = useState("");
  const [sourcePostalCode, setSourcePostalCode] = useState("");
  const [sourceCountry, setSourceCountry] = useState("");
  const [sourceDealName, setSourceDealName] = useState("");
  const [sourceDealType, setSourceDealType] = useState("");
  const [sourceInternalNotes, setSourceInternalNotes] = useState("");
  const [title, setTitle] = useState("");
  const [manualRequirementSourceId, setManualRequirementSourceId] = useState<
    Id<"requirementSourceDocuments"> | typeof INTERNAL_REQUIREMENT_SOURCE
  >(INTERNAL_REQUIREMENT_SOURCE);
  const [lineOfBusiness, setLineOfBusiness] = useState("CGL");
  const [limitKind, setLimitKind] = useState<RequirementLimitKind>("per_occurrence");
  const [limitAmount, setLimitAmount] = useState("");
  const [requirementText, setRequirementText] = useState("");
  const [provisions, setProvisions] = useState<RequirementProvision[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [archivingSources, setArchivingSources] = useState(false);
  const [checkingRequirementId, setCheckingRequirementId] = useState<Id<"insuranceRequirements"> | null>(null);
  const [certificateSourceId, setCertificateSourceId] = useState<Id<"requirementSourceDocuments"> | null>(null);
  const [certificateRequirementId, setCertificateRequirementId] = useState<Id<"insuranceRequirements"> | null>(null);
  const [certificateTabActions, setCertificateTabActions] = useState<ReactNode>(null);
  const [certificateTabRightPanel, setCertificateTabRightPanel] = useState<ReactNode>(null);
  const canManageCompliance =
    currentOrg?.role === "admin" &&
    !currentOrg.isReadOnlyImpersonation;
  const complianceWriteRestriction = !currentOrg
    ? null
    : currentOrg.isReadOnlyImpersonation
      ? "Live-organization operator mode is read-only. Exit operator mode to make changes."
      : currentOrg.role !== "admin"
        ? "Only an organization admin can make compliance changes."
        : null;

  const hasActiveClients = (clientRows ?? []).some((row) => row.status === "active");
  const hasActiveVendors = (vendorRows ?? []).some((row) => row.status === "active");
  const isPureVendorAccount =
    showConnectFeatures &&
    clientRows !== undefined &&
    vendorRows !== undefined &&
    hasActiveClients &&
    !hasActiveVendors;
  const activeRequirementScope: RequirementScope =
    !showConnectFeatures || isPureVendorAccount
      ? "own_org"
      : requestedTab === "own_org" || requestedTab === "vendors"
        ? requestedTab
        : requirementScope;
  const navigationValue =
    view === "requirements" && showConnectFeatures ? activeRequirementScope : view;
  const requirementNavigationOptions = showConnectFeatures
    ? [
        { value: "own_org", label: "My requirements" },
        ...(!isPureVendorAccount
          ? [{ value: "vendors", label: "Vendor requirements" }]
          : []),
      ]
    : [{ value: "requirements", label: "Requirements" }];
  const navigationOptions: Array<{ value: string; label: string }> =
    surface === "operator"
      ? [
          ...requirementNavigationOptions,
          { value: "sources", label: "Sources" },
          ...(hasCertificatesTab
            ? [{ value: "certificates", label: "Certificates" }]
            : []),
        ]
      : [
          { value: "overview", label: "Overview" },
          ...requirementNavigationOptions,
          { value: "sources", label: "Sources" },
          ...(hasCertificatesTab
            ? [{ value: "certificates", label: "Certificates" }]
            : []),
        ];

  function changeNavigation(value: string | null) {
    if (!value) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.push(`${pathname}?${params.toString()}`);
    if (value === "own_org" || value === "vendors") {
      setRequirementScope(value);
    }
  }

  const scopedRequirements = useMemo(
    () =>
      (requirements ?? []).filter((requirement) => requirement.scope === activeRequirementScope),
    [activeRequirementScope, requirements],
  );
  const sourceFilters = useMemo(() => {
    const present = Array.from(new Set(scopedRequirements.map(requirementSourceFilter)));
    return ["all", ...present] as SourceFilter[];
  }, [scopedRequirements]);
  const lineFilters = useMemo(() => {
    const present = Array.from(
      new Set(scopedRequirements.map((requirement) => lineFilterValue(requirement.lineOfBusiness))),
    ).sort((a, b) => lineFilterLabel(a).localeCompare(lineFilterLabel(b)));
    return ["all", ...present] as LineFilter[];
  }, [scopedRequirements]);
  const limitFilters = useMemo(() => {
    const present = Array.from(
      new Set(scopedRequirements.flatMap(requirementLimitFilters)),
    ).sort((a, b) => limitFilterLabel(a).localeCompare(limitFilterLabel(b)));
    return ["all", ...present] as LimitFilter[];
  }, [scopedRequirements]);
  const statusFilters = useMemo(() => {
    const order: StatusFilter[] = ["met", "not_met", "expired", "expiring_soon", "unverified", "defined"];
    const present = new Set(scopedRequirements.map(statusFilterValue));
    return ["all", ...order.filter((status) => present.has(status))] as StatusFilter[];
  }, [scopedRequirements]);
  const effectiveSourceFilter = sourceFilters.includes(sourceFilter) ? sourceFilter : "all";
  const effectiveLineFilter = lineFilters.includes(lineFilter) ? lineFilter : "all";
  const effectiveLimitFilter = limitFilters.includes(limitFilter) ? limitFilter : "all";
  const effectiveStatusFilter = statusFilters.includes(statusFilter) ? statusFilter : "all";
  const visibleRequirements =
    surface === "operator"
      ? scopedRequirements
      : scopedRequirements.filter(
          (requirement) =>
            (effectiveSourceFilter === "all" ||
              requirementSourceFilter(requirement) === effectiveSourceFilter) &&
            (effectiveLineFilter === "all" ||
              lineFilterValue(requirement.lineOfBusiness) ===
                effectiveLineFilter) &&
            (effectiveLimitFilter === "all" ||
              requirementLimitFilters(requirement).includes(
                effectiveLimitFilter,
              )) &&
            (effectiveStatusFilter === "all" ||
              statusFilterValue(requirement) === effectiveStatusFilter),
        );
  const selectedRequirement =
    (requirements ?? []).find((requirement) => requirement._id === selectedRequirementId) ?? null;
  const selectedSource =
    (requirementSources ?? []).find((source) => source._id === selectedSourceId) ?? null;
  const selectedSourceRequirements = selectedSource
    ? requirements?.filter((requirement) => requirement.sourceDocumentId === selectedSource._id)
    : undefined;
  const selectedSourceCertificates = useCachedQuery(
    "certificates.listByRequirementSource",
    api.certificates.listByRequirementSource,
    orgId && selectedSource
      ? {
          orgId,
          requirementSourceDocumentId: selectedSource._id,
        }
      : "skip",
  ) as SourceCertificate[] | undefined;

  if (isBroker) return null;

  async function submitRequirement(event: FormEvent) {
    event.preventDefault();
    if (!orgId) return;
    const amount = parseMoneyInput(limitAmount);
    if (amount === undefined && provisions.length === 0) {
      toast.error("Add a limit amount or at least one provision");
      return;
    }
    setSubmitting(true);
    try {
      const selectedManualSource =
        manualRequirementSourceId === INTERNAL_REQUIREMENT_SOURCE
          ? undefined
          : requirementSources?.find(
              (source) => source._id === manualRequirementSourceId,
            );
      if (
        manualRequirementSourceId !== INTERNAL_REQUIREMENT_SOURCE &&
        !selectedManualSource
      ) {
        toast.error("The selected requirement source is no longer available");
        return;
      }
      await upsertRequirement({
        orgId,
        kind: "coverage",
        scope: activeRequirementScope,
        title,
        requirementText,
        lineOfBusiness,
        limits:
          amount !== undefined
            ? [{ kind: limitKind, amount, label: limitAmount.trim() }]
            : undefined,
        provisions,
        sourceDocumentId: selectedManualSource?._id,
        sourceDocumentName: selectedManualSource?.title,
        sourceType: selectedManualSource?.sourceType ?? "manual",
      });
      toast.success("Requirement saved");
      setTitle("");
      setRequirementText("");
      setLimitAmount("");
      setProvisions([]);
      setManualRequirementSourceId(INTERNAL_REQUIREMENT_SOURCE);
      setCreationDrawer(null);
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Unable to save requirement"));
    } finally {
      setSubmitting(false);
    }
  }

  async function removeRequirement(requirementId: Id<"insuranceRequirements">) {
    if (!orgId) return;
    const archivedRequirement =
      (requirements ?? []).find((requirement) => requirement._id === requirementId) ?? null;
    try {
      await archiveRequirement({ orgId, requirementId });
      await updateRequirements({ orgId }, (current) =>
        current.filter((requirement) => requirement._id !== requirementId),
      );
      if (archivedRequirement?.sourceDocumentId) {
        await updateRequirementSources({ orgId }, (current) =>
          current.map((source) =>
            source._id === archivedRequirement.sourceDocumentId
              ? {
                  ...source,
                  requirementCount: Math.max(0, source.requirementCount - 1),
                }
              : source,
          ),
        );
      }
      setSelectedRequirementId(null);
      toast.success("Requirement archived");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Unable to archive requirement"));
    }
  }

  async function runDeeperCheck(requirement: Requirement) {
    if (!orgId) return;
    setCheckingRequirementId(requirement._id);
    try {
      const result = (await recheckOwnRequirement({
        orgId,
        requirementId: requirement._id,
      })) as Requirement["complianceCheck"];
      await updateRequirements({ orgId }, (current) =>
        current.map((item) =>
          item._id === requirement._id
            ? {
                ...item,
                complianceCheck: {
                  ...item.complianceCheck,
                  ...result,
                  status: result?.status ?? item.complianceCheck?.status ?? "unverified",
                  notes: result?.notes ? `Deep check: ${result.notes}` : result?.matchedSummary,
                  checkedBy: "agent",
                },
              }
            : item,
        ),
      );
      toast.success("Compliance checked");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Unable to check compliance"));
    } finally {
      setCheckingRequirementId(null);
    }
  }

  async function generateRequirements() {
    if (!orgId) return;
    if (!sourceText.trim() && !sourceFile) {
      toast.error("Paste text or upload a document first");
      return;
    }
    if (activeRequirementScope === "own_org" && !sourceHolderName.trim()) {
      toast.error("Add the certificate holder requesting these requirements");
      return;
    }
    setImporting(true);
    const importToast = toast.loading("Importing requirements…");
    try {
      let fileId: Id<"_storage"> | undefined;
      if (sourceFile) {
        const uploadUrl = await generateRequirementImportUploadUrl({ orgId });
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": sourceFile.type || "application/octet-stream" },
          body: sourceFile,
        });
        if (!response.ok) throw new Error("Document upload failed");
        const payload = (await response.json()) as { storageId: string };
        fileId = payload.storageId as Id<"_storage">;
      }
      const result = (await importRequirements({
        orgId,
        pastedText: sourceText.trim() || undefined,
        fileId,
        fileName: sourceFile?.name,
        contentType: sourceFile?.type,
        sourceType: sourceTypeValue,
        sourceName: sourceName.trim() || undefined,
        scope: activeRequirementScope,
        holder: sourceHolderName.trim() ? {
          displayName: sourceHolderName.trim(),
          contactName: sourceHolderContactName.trim() || undefined,
          email: sourceHolderEmail.trim() || undefined,
          phone: sourceHolderPhone.trim() || undefined,
          address: {
            line1: sourceAddressLine1.trim() || undefined,
            line2: sourceAddressLine2.trim() || undefined,
            city: sourceCity.trim() || undefined,
            state: sourceState.trim() || undefined,
            postalCode: sourcePostalCode.trim() || undefined,
            country: sourceCountry.trim() || undefined,
          },
        } : undefined,
        dealName: sourceDealName.trim() || undefined,
        dealType: sourceDealType.trim() || undefined,
        internalNotes: sourceInternalNotes.trim() || undefined,
      })) as { createdCount: number };
      toast[result.createdCount === 0 ? "info" : "success"](
        result.createdCount === 0
          ? "No new coverage requirements found"
          : `Created ${result.createdCount} requirement${result.createdCount === 1 ? "" : "s"}`,
        { id: importToast },
      );
      setSourceText("");
      setSourceFile(null);
      setSourceName("");
      setSourceHolderName("");
      setSourceHolderContactName("");
      setSourceHolderEmail("");
      setSourceHolderPhone("");
      setSourceAddressLine1("");
      setSourceAddressLine2("");
      setSourceCity("");
      setSourceState("");
      setSourcePostalCode("");
      setSourceCountry("");
      setSourceDealName("");
      setSourceDealType("");
      setSourceInternalNotes("");
      setCreationDrawer(null);
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Unable to generate requirements"), { id: importToast });
    } finally {
      setImporting(false);
    }
  }

  function openImportRequirements() {
    setSelectedRequirementId(null);
    setSelectedSourceId(null);
    setCreationDrawer("import");
  }

  function openAddRequirement() {
    setSelectedRequirementId(null);
    setSelectedSourceId(null);
    setCreationDrawer("manual");
  }

  async function updateSource(source: RequirementSource, patch: SourceUpdatePatch) {
    if (!orgId) throw new Error("Organization required");
    const now = dayjs().valueOf();
    await updateRequirementSources({ orgId }, (current) =>
      current.map((item) =>
        item._id === source._id
          ? {
              ...item,
              ...patch,
              updatedAt: now,
            }
          : item,
      ),
    );
    await updateRequirements({ orgId }, (current) =>
      current.map((requirement) =>
        requirement.sourceDocumentId === source._id
          ? {
              ...requirement,
              sourceDocumentName: patch.title ?? requirement.sourceDocumentName,
              sourceType: patch.sourceType ?? requirement.sourceType,
              updatedAt: now,
            }
          : requirement,
      ),
    );
    try {
      await updateRequirementSource({
        orgId,
        sourceDocumentId: source._id,
        ...patch,
      });
    } catch (error) {
      await updateRequirementSources({ orgId }, (current) =>
        current.map((item) => (item._id === source._id ? source : item)),
      );
      await updateRequirements({ orgId }, (current) =>
        current.map((requirement) =>
          requirement.sourceDocumentId === source._id
            ? {
                ...requirement,
                sourceDocumentName: source.title,
                sourceType: source.sourceType,
              }
            : requirement,
        ),
      );
      throw error;
    }
  }

  async function saveRequirementEdits(
    requirement: Requirement,
    values: RequirementEditValues,
  ) {
    if (!orgId) throw new Error("Organization required");
    const now = dayjs().valueOf();
    const nextRequirement: Requirement = {
      ...requirement,
      ...values,
      updatedAt: now,
    };
    await updateRequirements({ orgId }, (current) =>
      current.map((item) => (item._id === requirement._id ? nextRequirement : item)),
    );
    try {
      await upsertRequirement({
        orgId,
        requirementId: requirement._id,
        kind: requirement.kind ?? "coverage",
        scope: requirement.scope,
        title: values.title,
        requirementText: values.requirementText,
        lineOfBusiness: values.lineOfBusiness,
        limits: values.limits,
        maxDeductible: requirement.maxDeductible,
        coverageForm: requirement.coverageForm,
        provisions: values.provisions,
        requiredForms: requirement.requiredForms,
        sourceDocumentId: requirement.sourceDocumentId,
        sourceDocumentName: requirement.sourceDocumentName,
        sourceType: requirement.sourceType,
        sourceExcerpt: requirement.sourceExcerpt,
        sourcePageStart: requirement.sourcePageStart,
        sourcePageEnd: requirement.sourcePageEnd,
      });
    } catch (error) {
      await updateRequirements({ orgId }, (current) =>
        current.map((item) => (item._id === requirement._id ? requirement : item)),
      );
      throw error;
    }
  }

  async function archiveSources(sourceIds: Id<"requirementSourceDocuments">[]) {
    if (!orgId || sourceIds.length === 0) return false;
    setArchivingSources(true);
    try {
      const result = (await archiveRequirementSources({
        orgId,
        sourceDocumentIds: sourceIds,
      })) as { archivedSourceCount: number; archivedRequirementCount: number };
      const archivedIds = new Set(sourceIds);
      await updateRequirementSources({ orgId }, (current) =>
        current.filter((source) => !archivedIds.has(source._id)),
      );
      await updateRequirements({ orgId }, (current) =>
        current.filter((requirement) => !requirement.sourceDocumentId || !archivedIds.has(requirement.sourceDocumentId)),
      );
      setSelectedSourceId((current) => (current && archivedIds.has(current) ? null : current));
      toast.success(
        result.archivedRequirementCount > 0
          ? `Archived ${result.archivedRequirementCount} requirement${result.archivedRequirementCount === 1 ? "" : "s"}`
          : "Requirement source archived",
      );
      return true;
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Unable to archive sources"));
      return false;
    } finally {
      setArchivingSources(false);
    }
  }

  const importRequirementsPanel = (
    <SettingsDrawer
      open={creationDrawer === "import"}
      onOpenChange={(open) => setCreationDrawer(open ? "import" : null)}
      title="Import requirements"
      footer={
        <>
          <PillButton type="button" disabled={importing || (!sourceText.trim() && !sourceFile)} onClick={() => void generateRequirements()}>
            {importing ? "Importing..." : "Import requirements"}
          </PillButton>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
          Source name
          <Input
            value={sourceName}
            onChange={(event) => setSourceName(event.target.value)}
            placeholder={sourceFile?.name ?? "Client vendor requirements"}
            disabled={importing}
          />
        </label>
        <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
          Source type
          <Select value={sourceTypeValue} onValueChange={(value) => setSourceTypeValue(value as RequirementSourceDocumentType)}>
            <SelectTrigger className="w-full">
              <SelectValue>{REQUIREMENT_SOURCE_TYPE_LABELS[sourceTypeValue]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {REQUIREMENT_SOURCE_DOCUMENT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {REQUIREMENT_SOURCE_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        {activeRequirementScope === "own_org" ? (
          <FormSection
            title="Certificate holder"
            description="The person or organization requesting this proof of insurance."
          >
            <div className="space-y-3">
              <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>Holder name<Input value={sourceHolderName} onChange={(event) => setSourceHolderName(event.target.value)} placeholder="Landlord, lender, investor, or client" required /></label>
              <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>Contact<Input value={sourceHolderContactName} onChange={(event) => setSourceHolderContactName(event.target.value)} /></label>
              <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>Email<Input type="email" value={sourceHolderEmail} onChange={(event) => setSourceHolderEmail(event.target.value)} /></label>
              <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>Phone<PhoneInput value={sourceHolderPhone || undefined} onChange={(value) => setSourceHolderPhone(value ?? "")} defaultCountry="US" /></label>
              <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
                Address
                <AddressAutofillInput
                  id="new-requirement-source-holder-address"
                  value={{ street1: sourceAddressLine1, street2: sourceAddressLine2, city: sourceCity, state: sourceState, zip: sourcePostalCode, country: sourceCountry }}
                  onChange={(address) => {
                    setSourceAddressLine1(address.street1 ?? "");
                    setSourceAddressLine2(address.street2 ?? "");
                    setSourceCity(address.city ?? "");
                    setSourceState(address.state ?? "");
                    setSourcePostalCode(address.zip ?? "");
                    setSourceCountry(address.country ?? "");
                  }}
                  display="street1"
                />
              </label>
              <div className="grid grid-cols-[minmax(0,1fr)_72px_96px] gap-2">
                <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>City<Input value={sourceCity} onChange={(event) => setSourceCity(event.target.value)} /></label>
                <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>State<Input value={sourceState} onChange={(event) => setSourceState(event.target.value)} /></label>
                <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>ZIP<Input value={sourcePostalCode} onChange={(event) => setSourcePostalCode(event.target.value)} /></label>
              </div>
              <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>Deal name<Input value={sourceDealName} onChange={(event) => setSourceDealName(event.target.value)} placeholder="Office lease, financing, or client engagement" /></label>
              <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>Deal type<Input value={sourceDealType} onChange={(event) => setSourceDealType(event.target.value)} placeholder="Lease, investment, contract" /></label>
              <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>Internal notes<Textarea value={sourceInternalNotes} onChange={(event) => setSourceInternalNotes(event.target.value)} rows={3} /></label>
            </div>
          </FormSection>
        ) : null}
        <label className={`flex min-h-0 flex-1 flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
          Requirement text
          <Textarea className="min-h-0 flex-1 resize-none field-sizing-fixed" rows={12} value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="Paste insurance requirements or contract language." disabled={importing} />
        </label>
        <FileDropZone
          accept=".txt,.md,.markdown,.pdf,.docx,.csv,.json,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/csv,application/json"
          disabled={importing}
          idleLabel="Upload requirement document"
          busyLabel="Upload requirement document"
          hint="TXT, Markdown, PDF, DOCX, CSV, or JSON"
          onFile={(file) => {
            setSourceFile(file);
            setSourceName((current) => current.trim() || file.name);
          }}
        />
        {sourceFile ? (
          <OperationalPanel as="div" className="flex items-center justify-between gap-3 px-3 py-2">
            <p className={`min-w-0 truncate text-foreground ${typeStyle("body.medium")}`}>{sourceFile.name}</p>
            <PillButton type="button" size="compact" variant="secondary" disabled={importing} onClick={() => setSourceFile(null)}>
              Remove
            </PillButton>
          </OperationalPanel>
        ) : null}
      </div>
    </SettingsDrawer>
  );

  const addRequirementPanel = (
    <SettingsDrawer
      open={creationDrawer === "manual"}
      onOpenChange={(open) => setCreationDrawer(open ? "manual" : null)}
      title="Add requirement"
      footer={
        <>
          <PillButton type="submit" form="manual-compliance-requirement" disabled={submitting}>
            {submitting ? "Saving..." : "Save requirement"}
          </PillButton>
        </>
      }
    >
      <form id="manual-compliance-requirement" onSubmit={submitRequirement} className="flex min-h-0 flex-1 flex-col gap-4">
        <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
          Source (optional)
          <Select
            value={String(manualRequirementSourceId)}
            onValueChange={(value) => {
              if (value) {
                setManualRequirementSourceId(
                  value as Id<"requirementSourceDocuments"> | typeof INTERNAL_REQUIREMENT_SOURCE,
                );
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {manualRequirementSourceId === INTERNAL_REQUIREMENT_SOURCE
                  ? "No source — internal requirement"
                  : requirementSources?.find(
                      (source) => source._id === manualRequirementSourceId,
                    )?.title ?? "Select a source"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={INTERNAL_REQUIREMENT_SOURCE}>
                No source — internal requirement
              </SelectItem>
              {(requirementSources ?? []).map((source) => (
                <SelectItem key={source._id} value={source._id}>
                  {source.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
          Title
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="General liability minimum" required />
        </label>
        <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
          Line
          <Select value={lineOfBusiness} onValueChange={(value) => value && setLineOfBusiness(value)}>
            <SelectTrigger className="w-full">
              <SelectValue>{lobLabel(lineOfBusiness)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COMMON_LOBS.map((code) => (
                <SelectItem key={code} value={code}>{lobLabel(code)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
          <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
            Limit
            <Select value={limitKind} onValueChange={(value) => setLimitKind(value as RequirementLimitKind)}>
              <SelectTrigger className="w-full">
                <SelectValue>{REQUIREMENT_LIMIT_KIND_LABELS[limitKind]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {LIMIT_KIND_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>{REQUIREMENT_LIMIT_KIND_LABELS[option]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
            Amount
            <Input value={limitAmount} onChange={(event) => setLimitAmount(event.target.value)} placeholder="$1,000,000" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {PROVISION_OPTIONS.map((option) => (
            <PillButton key={option} type="button" size="compact" variant={provisions.includes(option) ? "primary" : "secondary"} onClick={() => setProvisions((current) => current.includes(option) ? current.filter((item) => item !== option) : [...current, option])}>
              {REQUIREMENT_PROVISION_LABELS[option]}
            </PillButton>
          ))}
        </div>
        <label className={`flex min-h-0 flex-1 flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
          Requirement
          <Textarea className="min-h-0 flex-1 resize-none field-sizing-fixed" rows={8} value={requirementText} onChange={(event) => setRequirementText(event.target.value)} placeholder="Describe the coverage requirement in plain language." required />
        </label>
      </form>
    </SettingsDrawer>
  );

  const detailPanel = selectedRequirement ? (
    <RequirementDrawer
      requirement={selectedRequirement}
      checking={checkingRequirementId === selectedRequirement._id}
      canManage={canManageCompliance}
      writeRestriction={complianceWriteRestriction}
      onSave={saveRequirementEdits}
      onDeepCheck={(row) => void runDeeperCheck(row)}
      onGenerate={(requirement) => {
        if (!requirement.sourceDocumentId) {
          toast.error("Connect this requirement to a source before generating certificates");
          return;
        }
        setCertificateRequirementId(requirement._id);
        setCertificateSourceId(requirement.sourceDocumentId);
      }}
      onArchive={(id) => void removeRequirement(id)}
      onClose={() => setSelectedRequirementId(null)}
    />
  ) : null;
  const sourcePanel = selectedSource ? (
    <SourceDrawer
      key={selectedSource._id}
      source={selectedSource}
      requirements={selectedSourceRequirements}
      certificates={selectedSourceCertificates}
      archiving={archivingSources}
      canManage={canManageCompliance}
      writeRestriction={complianceWriteRestriction}
      onUpdateSource={updateSource}
      onSaveRequirement={saveRequirementEdits}
      onArchiveRequirement={removeRequirement}
      onArchiveSource={(sourceId) => archiveSources([sourceId])}
      onGenerate={(source) => {
        setCertificateRequirementId(null);
        setCertificateSourceId(source._id);
      }}
      onViewCertificate={openWithUrl}
      onClose={() => setSelectedSourceId(null)}
    />
  ) : null;

  const complianceActions = canManageCompliance ? (
    <>
      <PillButton size="compact" variant="secondary" onClick={openAddRequirement}>
        <Plus className="h-3.5 w-3.5" />
        Add requirement
      </PillButton>
      <PillButton size="compact" variant="primary" onClick={openImportRequirements}>
        <FileUp className="h-3.5 w-3.5" />
        Import requirements
      </PillButton>
    </>
  ) : null;
  const certificatePanel = orgId && certificateSourceId ? (
    <CertificateGeneratePanel
      open
      onOpenChange={(value) => {
        if (!value) {
          setCertificateSourceId(null);
          setCertificateRequirementId(null);
        }
      }}
      orgId={orgId}
      initialRequirementSourceId={certificateSourceId}
      initialRequirementId={certificateRequirementId ?? undefined}
    />
  ) : null;
  const requirementCreationPanel = creationDrawer === "manual"
    ? addRequirementPanel
    : importRequirementsPanel;
  const complianceRightPanel =
    certificatePanel ?? detailPanel ?? sourcePanel ?? requirementCreationPanel;
  const actions = view === "certificates" ? certificateTabActions : complianceActions;
  const rightPanel =
    view === "certificates" ? certificateTabRightPanel : complianceRightPanel;
  const toolbar = (
    <Tabs value={navigationValue} onValueChange={changeNavigation}>
      <TabsList
        variant="pill"
        aria-label="Compliance view"
        className="min-w-max"
      >
        {navigationOptions.map((option) => (
          <TabsTrigger key={option.value} value={option.value}>
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
  const content = (
    <div className="flex w-full flex-col gap-4">
        {complianceWriteRestriction ? (
          <OperationalPanel as="div" className="flex items-start gap-3 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className={`text-foreground ${typeStyle("body.medium")}`}>
                {view === "certificates"
                  ? "Certificate management is read-only"
                  : "Compliance is read-only"}
              </p>
              <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
                {complianceWriteRestriction}
              </p>
            </div>
          </OperationalPanel>
        ) : null}
        {!renderShell ? (
          <Tabs value={navigationValue} onValueChange={changeNavigation}>
            <TabsList variant="pill">
              {navigationOptions.map((option) => (
                <TabsTrigger key={option.value} value={option.value}>
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : null}
        {view === "certificates" && renderCertificatesTab ? (
          renderCertificatesTab({
            onActions: setCertificateTabActions,
            onRightPanel: setCertificateTabRightPanel,
          })
        ) : view === "sources" ? (
          requirementSources === undefined ? (
            <RequirementsLoadingSkeleton />
          ) : (
            <RequirementSourcesTable
              sources={requirementSources}
              onSelect={(sourceId) => {
                setSelectedSourceId(sourceId);
                setSelectedRequirementId(null);
                setCreationDrawer(null);
              }}
            />
          )
        ) : requirements === undefined ||
        (showConnectFeatures && (clientRows === undefined || vendorRows === undefined)) ? (
          <RequirementsLoadingSkeleton />
        ) : view === "overview" ? (
          <OverviewTab
            requirements={requirements}
            onOpenRequirements={(line) => {
              setSourceFilter("all");
              setLineFilter(lineFilterValue(line));
              setLimitFilter("all");
              setStatusFilter("all");
              changeNavigation(
                showConnectFeatures ? activeRequirementScope : "requirements",
              );
            }}
          />
        ) : (
          <>
            {surface !== "operator" ? (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <RequirementsFilterSelect
                  label="Source"
                  value={effectiveSourceFilter}
                  valueLabel={sourceLabel(effectiveSourceFilter, scopedRequirements)}
                  onValueChange={(value) => setSourceFilter(value as SourceFilter)}
                >
                  {sourceFilters.map((filter) => (
                    <SelectItem key={filter} value={filter}>
                      {sourceLabel(filter, scopedRequirements)}
                    </SelectItem>
                  ))}
                </RequirementsFilterSelect>
                <RequirementsFilterSelect
                  label="Line"
                  value={effectiveLineFilter}
                  valueLabel={lineFilterLabel(effectiveLineFilter)}
                  onValueChange={(value) => setLineFilter(value as LineFilter)}
                >
                  {lineFilters.map((filter) => (
                    <SelectItem key={filter} value={filter}>{lineFilterLabel(filter)}</SelectItem>
                  ))}
                </RequirementsFilterSelect>
                <RequirementsFilterSelect
                  label="Limit type"
                  value={effectiveLimitFilter}
                  valueLabel={limitFilterLabel(effectiveLimitFilter)}
                  onValueChange={(value) => setLimitFilter(value as LimitFilter)}
                >
                  {limitFilters.map((filter) => (
                    <SelectItem key={filter} value={filter}>{limitFilterLabel(filter)}</SelectItem>
                  ))}
                </RequirementsFilterSelect>
                <RequirementsFilterSelect
                  label="Status"
                  value={effectiveStatusFilter}
                  valueLabel={statusFilterLabel(effectiveStatusFilter)}
                  onValueChange={(value) => setStatusFilter(value as StatusFilter)}
                >
                  {statusFilters.map((filter) => (
                    <SelectItem key={filter} value={filter}>{statusFilterLabel(filter)}</SelectItem>
                  ))}
                </RequirementsFilterSelect>
              </div>
            ) : null}
            {visibleRequirements.length === 0 ? (
              <EmptyState />
            ) : (
              <RequirementsTable
                requirements={visibleRequirements}
                onSelect={(requirementId) => {
                  setSelectedRequirementId(requirementId);
                  setSelectedSourceId(null);
                  setCreationDrawer(null);
                }}
              />
            )}
          </>
        )}
    </div>
  );

  if (renderShell) {
    return renderShell({ actions, rightPanel, toolbar, children: content });
  }

  return (
    <AppShell actions={actions} rightPanel={rightPanel}>
      {content}
    </AppShell>
  );
}

export function CompliancePage(props: CompliancePageProps = {}) {
  return <ComplianceWorkspace {...props} surface="customer" />;
}

export function OperatorComplianceWorkspace(
  props: CompliancePageProps = {},
) {
  return <ComplianceWorkspace {...props} surface="operator" />;
}
