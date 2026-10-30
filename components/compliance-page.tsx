"use client";
import { RemoveButton } from "@/components/ui/remove-button";

import type { FormEvent, KeyboardEvent, ReactNode, Ref } from "react";
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import dayjs from "dayjs";
import { Meter } from "@base-ui/react/meter";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FileSearch,
  FileText,
  FileUp,
  Plus,
  Scale,
  BadgeCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { PolicyCitation } from "@/components/context-reference-card";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { ActionSurface } from "@/components/ui/action-surface";
import {
  ListToolbar,
  type FilterDefinition,
} from "@/components/ui/list-toolbar";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import {
  StatusTag,
  type StatusTagTone,
} from "@claritylabs-inc/ui/components/status-tag";
import { FileDropZone } from "@claritylabs-inc/ui/components/file-drop";
import { FormSection } from "@claritylabs-inc/ui/components/form-section";
import { Input } from "@claritylabs-inc/ui/components/input";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import {
  OperationalPanel,
  OperationalSkeletonList,
} from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
  SortableTableHead,
} from "@/components/ui/table";
import { TabsContent, TabsTrigger } from "@claritylabs-inc/ui/components/tabs";
import { PageTabs, PageTabsList } from "@/components/ui/folder-tabs";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
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
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { AddressAutofillInput } from "@/components/ui/address-autofill-input";
import { PhoneInput } from "@claritylabs-inc/ui/components/marketing/phone-input";
import { CertificateGeneratePanel } from "@/components/certificates/certificate-generate-panel";
import { usePdf } from "@/components/pdf-context";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { formatDisplayDate } from "@/lib/date-format";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";
import { useSavedFollowedState } from "@/hooks/use-saved-followed-state";
import { useFollowedState } from "@/hooks/use-followed-state";
import {
  usePageContext,
  usePageContextLayer,
  type PageContext,
} from "@/hooks/use-page-context";
import { contextIds, contextSummary } from "@/lib/policy-page-context";
import { useTableSort } from "@/hooks/use-table-sort";

type RequirementScope = "vendors" | "own_org";
type ComplianceStatus =
  | "met"
  | "not_met"
  | "expiring_soon"
  | "expired"
  | "unverified";
type SourceFilter = "all" | "internal" | `source:${string}`;
type LineFilter = "all" | `line:${string}`;
type LimitFilter =
  | "all"
  | "deductible"
  | "forms"
  | "provisions"
  | `limit:${string}`;
type StatusFilter = "all" | ComplianceStatus | "defined";
type ComplianceView = "overview" | "requirements" | "sources" | "certificates";
type RequirementKind = "coverage" | "insurer" | "condition";
type RequirementSourceDocumentType = Exclude<
  RequirementSourceType,
  "manual" | "bulk_import"
>;

const emptySourceDetails = {
  holderName: "",
  holderContactName: "",
  holderEmail: "",
  holderPhone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
  dealName: "",
  dealType: "",
  internalNotes: "",
};

function openOnKeyboard(event: KeyboardEvent<HTMLElement>, open: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    open();
  }
}

type ComplianceWorkspaceOrgContext = {
  orgId: Id<"organizations">;
  /** Names the client in the operator agent's page context. */
  name?: string;
  orgType: "client" | "broker";
  role: "admin" | "member" | undefined;
  featureFlags?: FeatureFlagMap;
};

export type ComplianceWorkspaceShellArgs = {
  actions: ReactNode;
  rightPanel: ReactNode;
  children: ReactNode;
};

export type ComplianceCertificatesTabArgs = {
  onActions: (actions: ReactNode) => void;
  onRightPanel: (panel: ReactNode) => void;
};

/** What the compliance workspace shows, for an agent page context. */
export type ComplianceContextState = {
  view: Exclude<ComplianceView, "certificates">;
  scope: RequirementScope;
  requirementCount?: number;
  sourceCount?: number;
  selectedRequirement: {
    id: Id<"insuranceRequirements">;
    title: string;
    lineOfBusiness?: string;
    status: string;
    sourceId?: Id<"requirementSourceDocuments">;
  } | null;
  selectedSource: {
    id: Id<"requirementSourceDocuments">;
    title: string;
    holderName?: string;
    requirementCount?: number;
  } | null;
  creationDrawer: "import" | "manual" | null;
  certificateSourceId: Id<"requirementSourceDocuments"> | null;
};

export type CompliancePageProps = {
  orgContext?: ComplianceWorkspaceOrgContext;
  renderShell?: (args: ComplianceWorkspaceShellArgs) => ReactNode;
  renderCertificatesTab?: (args: ComplianceCertificatesTabArgs) => ReactNode;
  /**
   * Builds the agent page context layered over the page's. The certificates
   * tab sets its own.
   */
  pageContext?: (state: ComplianceContextState) => PageContext | null;
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

const COMMON_LOBS = [
  "CGL",
  "AUTOB",
  "WORK",
  "UMBRC",
  "EXLIA",
  "EO",
  "PROP",
  "BOP",
  "CRIM",
  "EPLI",
  "CYBER",
] as const;

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
  kind: RequirementKind;
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
  sourceVerification?: "unverified";
  classificationReview?: true;
  sourceBbox?: {
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    pageWidth: number;
    pageHeight: number;
  };
  requirementSource?: { fileUrl?: string };
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
  const multiplier = /m$/i.test(normalized)
    ? 1_000_000
    : /k$/i.test(normalized)
      ? 1_000
      : 1;
  const amount = Number(normalized.replace(/[mk]$/i, "")) * multiplier;
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

function limitKindLabel(kind: string) {
  return (
    REQUIREMENT_LIMIT_KIND_LABELS[
      kind as keyof typeof REQUIREMENT_LIMIT_KIND_LABELS
    ] ?? kind
  );
}

function asRequirementLimitKind(kind: string): RequirementLimitKind {
  return (REQUIREMENT_LIMIT_KINDS as readonly string[]).includes(kind)
    ? (kind as RequirementLimitKind)
    : "other";
}

function provisionLabel(provision: string) {
  return (
    REQUIREMENT_PROVISION_LABELS[
      provision as keyof typeof REQUIREMENT_PROVISION_LABELS
    ] ?? provision
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
  const filters = (requirement.limits ?? []).map((limit) =>
    limitFilterValue(limit.kind),
  );
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
  if (value === "all") return "All statuses";
  return statusMeta(value === "defined" ? undefined : value).label;
}

function pageLabel(requirement: Requirement) {
  if (!requirement.sourcePageStart) return undefined;
  if (
    requirement.sourcePageEnd &&
    requirement.sourcePageEnd !== requirement.sourcePageStart
  ) {
    return `pp. ${requirement.sourcePageStart}-${requirement.sourcePageEnd}`;
  }
  return `p. ${requirement.sourcePageStart}`;
}

/** Opens the source PDF at the clause's page, boxing the clause when located. */
function SourcePageLink({ requirement }: { requirement: Requirement }) {
  const { openWithUrl } = usePdf();
  const label = pageLabel(requirement);
  const fileUrl = requirement.requirementSource?.fileUrl;
  const page = requirement.sourcePageStart;
  if (!label) return null;
  if (!fileUrl || !page) return <>{label}</>;
  const bbox = requirement.sourceBbox;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-2"
      aria-label={`Open source on page ${page}`}
      onClick={(event) => {
        event.stopPropagation();
        openWithUrl(
          fileUrl,
          page,
          bbox && bbox.page === page
            ? [
                {
                  page: bbox.page,
                  x: bbox.x,
                  y: bbox.y,
                  width: bbox.width,
                  height: bbox.height,
                  coordinateWidth: bbox.pageWidth,
                  coordinateHeight: bbox.pageHeight,
                },
              ]
            : [],
        );
      }}
    >
      <FileSearch className="size-3" />
      {label}
    </button>
  );
}

function requirementSourceLine(requirement: Requirement) {
  return [
    requirementSourcePrimary(requirement),
    requirementSourceSecondary(requirement),
  ]
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
    requirement.sourceDocumentName
      ? REQUIREMENT_SOURCE_TYPE_LABELS[sourceType(requirement)]
      : undefined,
    requirement.clientRequirementSource?.clientOrg
      ? `Required by ${requirement.clientRequirementSource.clientOrg.name}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

function requirementTableSourceSecondary(requirement: Requirement) {
  return [
    requirement.sourceDocumentName &&
    requirement.clientRequirementSource?.clientOrg
      ? `Required by ${requirement.clientRequirementSource.clientOrg.name}`
      : undefined,
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
      };
    case "expiring_soon":
      return {
        label: "Expiring",
        tone: "warning" as StatusTagTone,
      };
    case "unverified":
      return {
        label: "Unverified",
        tone: "warning" as StatusTagTone,
      };
    case "expired":
    case "not_met":
      return {
        label: status === "expired" ? "Expired" : "Not met",
        tone: "danger" as StatusTagTone,
      };
    default:
      return {
        label: "Defined",
        tone: "neutral" as StatusTagTone,
      };
  }
}

function ComplianceStatusTag({ status }: { status?: ComplianceStatus }) {
  const meta = statusMeta(status);
  return <StatusTag tone={meta.tone}>{meta.label}</StatusTag>;
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

const CONTEXT_STATUS_ORDER: StatusFilter[] = [
  "not_met",
  "expired",
  "expiring_soon",
  "unverified",
  "met",
  "defined",
];

/** Counts by status, e.g. `12 requirements: 3 not met, 9 met`. */
function requirementCountsContext(requirements: Requirement[]) {
  const counts = new Map<StatusFilter, number>();
  for (const requirement of requirements) {
    const status = statusFilterValue(requirement);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const parts = CONTEXT_STATUS_ORDER.filter((status) => counts.has(status)).map(
    (status) =>
      `${counts.get(status)} ${status === "defined" ? "unchecked" : statusFilterLabel(status).toLowerCase()}`,
  );
  return `${requirements.length} requirement${requirements.length === 1 ? "" : "s"}${parts.length ? `: ${parts.join(", ")}` : ""}`;
}

function requirementContextSummary(
  requirement: Requirement,
  generating: boolean,
) {
  const check = requirement.complianceCheck;
  const matchedPolicyIds = matchedPolicyIdsForRequirement(requirement);
  return contextSummary([
    `Requirement: ${requirement.title}`,
    requirement.scope === "vendors" ? "vendor requirement" : undefined,
    lineDisplayLabel(requirement.lineOfBusiness),
    (requirement.limits ?? [])
      .slice(0, 3)
      .map((limit) => limit.label || `${limitKindLabel(limit.kind)} ${limit.amount}`)
      .join(", "),
    [
      statusMeta(check?.status).label,
      check?.matchedPolicy?.policyNumber
        ? `by policy ${check.matchedPolicy.policyNumber}`
        : undefined,
    ]
      .filter(Boolean)
      .join(" "),
    requirement.sourceDocumentName
      ? `from ${requirement.sourceDocumentName}`
      : undefined,
    generating ? "generating a certificate" : undefined,
    contextIds({
      orgId: requirement.orgId,
      requirementSourceDocumentId: requirement.sourceDocumentId,
      matchedPolicyIds: matchedPolicyIds.slice(0, 3).join(","),
    }),
  ]);
}

function requirementSourceContextSummary(
  source: RequirementSource,
  generating: boolean,
) {
  return contextSummary([
    `Requirement source: ${source.title}`,
    source.sourceType.replaceAll("_", " "),
    source.holder?.displayName
      ? `holder ${source.holder.displayName}`
      : undefined,
    `${source.requirementCount} requirement${source.requirementCount === 1 ? "" : "s"}`,
    source.status === "running"
      ? "extracting requirements"
      : source.status === "error"
        ? "requirement extraction failed"
        : undefined,
    generating ? "generating a certificate" : undefined,
    contextIds({ orgId: source.orgId }),
  ]);
}

function PolicyTagList({
  policyIds,
  emptyLabel,
}: {
  policyIds: Id<"policies">[];
  emptyLabel?: string;
}) {
  if (policyIds.length === 0) {
    return emptyLabel ? (
      <span className="text-muted-foreground">{emptyLabel}</span>
    ) : null;
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {policyIds.slice(0, 3).map((policyId) => (
        <PolicyCitation key={policyId} id={policyId} />
      ))}
      {policyIds.length > 3 ? (
        <Badge
          variant="outline"
          className={`h-5 rounded-full px-1.5 text-muted-foreground ${typeStyle("label.tag")}`}
        >
          +{policyIds.length - 3}
        </Badge>
      ) : null}
    </div>
  );
}

function EmptyState() {
  return (
    <OperationalPanel as="div" className="p-5">
      <p className={`text-foreground ${typeStyle("body.medium")}`}>
        No coverage requirements yet
      </p>
      <p className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}>
        Add coverage rules manually or extract them from a lease, client
        contract, or vendor requirement packet.
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
  const checked = requirements.filter(
    (requirement) => requirement.complianceCheck,
  );
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
          const groupAttention = rows.filter((requirement) =>
            needsAttention(requirement.complianceCheck?.status),
          ).length;
          const groupExpiring = rows.filter(
            (requirement) =>
              requirement.complianceCheck?.status === "expiring_soon",
          ).length;
          return (
            <ActionSurface
              key={lob}
              role="button"
              tabIndex={0}
              onClick={() => onOpenRequirements(lob)}
              onKeyDown={(event) =>
                openOnKeyboard(event, () => onOpenRequirements(lob))
              }
              className="cursor-pointer px-4 py-3"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <p
                  className={`min-w-0 truncate text-foreground ${typeStyle("body.medium")}`}
                >
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
              <p
                className={`mt-2 text-muted-foreground ${typeStyle("caption.default")}`}
              >
                {groupMet} of {rows.length} requirements met
              </p>
              <div className="mt-3">
                <ComplianceMeter met={groupMet} total={rows.length} />
              </div>
              <div
                className={`mt-1.5 flex items-center justify-between text-muted-foreground ${typeStyle("caption.default")}`}
              >
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

const COMPLIANCE_STATUS_ORDER: Record<ComplianceStatus, number> = {
  met: 0,
  expiring_soon: 1,
  unverified: 2,
  not_met: 3,
  expired: 4,
};

const REQUIREMENT_SORT_COLUMNS = {
  line: (requirement: Requirement) =>
    lineDisplayLabel(requirement.lineOfBusiness),
  source: (requirement: Requirement) => requirementSourcePrimary(requirement),
  limit: (requirement: Requirement) => requirement.limits?.[0]?.amount,
  limitType: (requirement: Requirement) =>
    requirement.limits?.[0]
      ? limitKindLabel(requirement.limits[0].kind)
      : (requirement.provisions ?? []).length > 0
        ? "Provisions"
        : undefined,
  status: (requirement: Requirement) =>
    requirement.complianceCheck
      ? COMPLIANCE_STATUS_ORDER[requirement.complianceCheck.status]
      : undefined,
};

function RequirementsTable({
  followKey,
  requirements,
  onSelect,
}: {
  followKey: string;
  requirements: Requirement[];
  onSelect: (requirementId: Id<"insuranceRequirements">) => void;
}) {
  const sorted = useMemo(
    () =>
      [...requirements].sort((a, b) => {
        const lobCompare = (a.lineOfBusiness ?? "ZZ").localeCompare(
          b.lineOfBusiness ?? "ZZ",
        );
        return lobCompare !== 0 ? lobCompare : a.title.localeCompare(b.title);
      }),
    [requirements],
  );
  const tableSort = useTableSort(followKey, sorted, REQUIREMENT_SORT_COLUMNS);
  return (
    <OperationalPanel as="div">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortableTableHead {...tableSort.head("line")}>
              Line
            </SortableTableHead>
            <SortableTableHead {...tableSort.head("source")}>
              Source
            </SortableTableHead>
            <SortableTableHead {...tableSort.head("limit")}>
              Limit
            </SortableTableHead>
            <SortableTableHead {...tableSort.head("limitType")}>
              Limit type
            </SortableTableHead>
            <SortableTableHead {...tableSort.head("status")}>
              Status
            </SortableTableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tableSort.rows.map((requirement) => {
            const limits = requirement.limits ?? [];
            const sourceSecondary =
              requirementTableSourceSecondary(requirement);
            return (
              <TableRow
                key={requirement._id}
                className="cursor-pointer"
                onClick={() => onSelect(requirement._id)}
                tabIndex={0}
                onKeyDown={(event) =>
                  openOnKeyboard(event, () => onSelect(requirement._id))
                }
              >
                <TableCell
                  className={`text-foreground ${typeStyle("body.medium")}`}
                >
                  {lineDisplayLabel(requirement.lineOfBusiness)}
                </TableCell>
                <TableCell>
                  <p className="text-foreground">
                    {requirementSourcePrimary(requirement)}
                  </p>
                  {sourceSecondary || requirement.sourcePageStart ? (
                    <p
                      className={`text-muted-foreground ${typeStyle("caption.default")}`}
                    >
                      {sourceSecondary}
                      {sourceSecondary && requirement.sourcePageStart
                        ? " · "
                        : null}
                      <SourcePageLink requirement={requirement} />
                    </p>
                  ) : null}
                </TableCell>
                <TableCell
                  className={`text-foreground ${typeStyle("data.numeric")}`}
                >
                  {limits.length > 0
                    ? limits.map((limit, index) => (
                        <p
                          key={index}
                          className={`${typeStyle("body.default")}`}
                        >
                          {formatMoneyCompact(limit.amount)}
                        </p>
                      ))
                    : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {limits.length > 0
                    ? limits.map((limit, index) => (
                        <p
                          key={index}
                          className={`${typeStyle("body.default")}`}
                        >
                          {limitKindLabel(limit.kind)}
                        </p>
                      ))
                    : (requirement.provisions ?? []).length > 0
                      ? "Provisions"
                      : "—"}
                </TableCell>
                <TableCell>
                  {requirement.complianceCheck ? (
                    <ComplianceStatusTag
                      status={requirement.complianceCheck.status}
                    />
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

function DrawerDetail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      className={`grid grid-cols-[10rem_1fr] gap-3 ${typeStyle("body.default")}`}
    >
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
    if (normalizeCheckNote(note) === normalizeCheckNote(matchedSummary))
      return undefined;
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
  onSave: (
    requirement: Requirement,
    values: RequirementEditValues,
  ) => Promise<void>;
  onArchive: (requirementId: Id<"insuranceRequirements">) => void;
  onClose: () => void;
}) {
  const [confirmArchive, setConfirmArchive] = useFollowedState(
    `compliance:requirement:${requirement._id}:confirm-archive`,
    false,
  );
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
  const detectedLimit =
    policy?.coverageLimit ?? formatMoney(policy?.detectedLimitAmount);
  return (
    <SettingsDrawer
      open
      onOpenChange={async (open) => {
        if (!open && (!editRef.current || (await editRef.current.save())))
          onClose();
      }}
      title={requirement.title}
      actions={
        check ? <ComplianceStatusTag status={check.status} /> : undefined
      }
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
            <PillButton
              type="button"
              disabled={checking}
              onClick={() => onDeepCheck(requirement)}
            >
              {checking
                ? "Checking…"
                : check?.checkedBy === "agent"
                  ? "Run deeper check again"
                  : "Run deeper check"}
            </PillButton>
          ) : deepCheckAvailableForRequirement && writeRestriction ? (
            <p
              className={`max-w-72 text-right text-muted-foreground ${typeStyle("caption.default")}`}
            >
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
          <OperationalPanel
            as="div"
            className="border-destructive/20 bg-destructive/5 p-4"
          >
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
              <div>
                <p className={`text-foreground ${typeStyle("body.medium")}`}>
                  Archive this requirement?
                </p>
                <p
                  className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
                >
                  It will disappear from active compliance and certificate
                  planning.
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
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              {requirement.requirementText}
            </p>
            <section className="space-y-2 border-t border-border pt-5">
              {requirement.lineOfBusiness ? (
                <DrawerDetail
                  label="Line"
                  value={lineDisplayLabel(requirement.lineOfBusiness)}
                />
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
                  value={
                    requirement.coverageForm === "claims_made"
                      ? "Claims-made"
                      : "Occurrence"
                  }
                />
              ) : null}
              {(requirement.provisions ?? []).length > 0 ? (
                <DrawerDetail
                  label="Provisions"
                  value={(requirement.provisions ?? [])
                    .map(provisionLabel)
                    .join(", ")}
                />
              ) : null}
              {(requirement.requiredForms ?? []).length > 0 ? (
                <DrawerDetail
                  label="Required forms"
                  value={(requirement.requiredForms ?? []).join(", ")}
                />
              ) : null}
              <DrawerDetail
                label="Source"
                value={
                  <>
                    {requirementSourceLine(requirement)}
                    {requirementSourceLine(requirement) &&
                    requirement.sourcePageStart
                      ? " · "
                      : null}
                    <SourcePageLink requirement={requirement} />
                  </>
                }
              />
              {requirement.classificationReview ? (
                <DrawerDetail
                  label="Classification"
                  value="Needs review: type/scope uncertain"
                />
              ) : null}
              {requirement.sourceVerification === "unverified" ? (
                <DrawerDetail
                  label="Source check"
                  value="This clause was read from a scan and could not be matched to the page. Review it against the source before relying on it."
                />
              ) : null}
            </section>
          </>
        )}
        {check ? (
          <section className="space-y-2 border-t border-border pt-5">
            <p
              className={`text-muted-foreground/60 ${typeStyle("body.medium")}`}
            >
              Latest check
            </p>
            {policy || policyIds.length > 0 ? (
              <>
                {policyIds.length > 0 ? (
                  <DrawerDetail
                    label="Matched policy"
                    value={<PolicyTagList policyIds={policyIds} />}
                  />
                ) : policy ? (
                  <DrawerDetail
                    label="Matched policy"
                    value={[policy.carrier, policy.policyNumber]
                      .filter(Boolean)
                      .join(" · ")}
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
              <p
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
                No current policy match.
              </p>
            )}
            {checkNote ? (
              <p
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
                {checkNote}
              </p>
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

function provisionsForRequirement(
  requirement: Requirement,
): RequirementProvision[] {
  return (requirement.provisions ?? []).filter(
    (provision): provision is RequirementProvision =>
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

function RequirementEditForm({
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
  const [confirmArchive, setConfirmArchive] = useFollowedState(
    `compliance:requirement-form:${requirement._id}:confirm-archive`,
    false,
  );
  const [title, setTitle] = useState(requirement.title);
  const [lineOfBusiness, setLineOfBusiness] = useState(
    requirement.lineOfBusiness ?? "CGL",
  );
  const [limitDrafts, setLimitDrafts] = useState<LimitDraft[]>(() =>
    limitDraftsForRequirement(requirement),
  );
  const [provisions, setProvisions] = useState<RequirementProvision[]>(() =>
    provisionsForRequirement(requirement),
  );
  const [requirementText, setRequirementText] = useState(
    requirement.requirementText,
  );
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
    canSave: !!validEditValues?.title && !!validEditValues.requirementText,
    autoSave: !textFieldFocused,
    delayMs: 0,
    flush: onSave,
    errorMessage: "The requirement could not be saved.",
  });

  useImperativeHandle(ref, () => ({ save: autoSave.saveNow }), [
    autoSave.saveNow,
  ]);

  return (
    <div className="space-y-3">
      <label
        className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
      >
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
        {!title.trim() ? (
          <span className="text-destructive">Title is required.</span>
        ) : null}
      </label>
      <label
        className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
      >
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
              <SelectItem key={code} value={code}>
                {lobLabel(code)}
              </SelectItem>
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
          <p className={`text-destructive ${typeStyle("caption.default")}`}>
            Enter a valid limit amount.
          </p>
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
                    <SelectValue>
                      {REQUIREMENT_LIMIT_KIND_LABELS[draft.kind]}
                    </SelectValue>
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
                <RemoveButton
                  type="button"
                  onClick={() => {
                    const next = limitDrafts.filter(
                      (item) => item.id !== draft.id,
                    );
                    setLimitDrafts(next);
                  }}
                  label="Remove limit"
                />
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
      <label
        className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
      >
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
          <span className="text-destructive">
            Requirement text is required.
          </span>
        ) : null}
      </label>
      <AutoSaveStatus status={autoSave.status} />
      {onArchive ? (
        <div className="flex items-center justify-end gap-3">
          {confirmArchive ? (
            <>
              <span
                className={`mr-auto text-muted-foreground ${typeStyle("caption.default")}`}
              >
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
          .map(
            (limit) =>
              `${limitKindLabel(limit.kind)} ${formatMoneyCompact(limit.amount)}`,
          )
          .join(", ")
      : (requirement.provisions ?? []).length > 0
        ? (requirement.provisions ?? []).map(provisionLabel).join(", ")
        : "No limit";
  return [lineDisplayLabel(requirement.lineOfBusiness), limitSummary].join(
    " · ",
  );
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
  onUpdateSource: (
    source: RequirementSource,
    patch: SourceUpdatePatch,
  ) => Promise<void>;
  onSaveRequirement: (
    requirement: Requirement,
    values: RequirementEditValues,
  ) => Promise<void>;
  onArchiveRequirement: (
    requirementId: Id<"insuranceRequirements">,
  ) => Promise<void>;
  onArchiveSource: (
    sourceId: Id<"requirementSourceDocuments">,
  ) => Promise<boolean>;
  onGenerate: (source: RequirementSource) => void;
  onViewCertificate: (url: string) => void;
  onClose: () => void;
}) {
  const [titleDraft, setTitleDraft] = useState(source.title);
  const [sourceTypeDraft, setSourceTypeDraft] =
    useState<RequirementSourceDocumentType>(source.sourceType);
  const [titleFocused, setTitleFocused] = useState(false);
  const [holderName, setHolderName] = useState(
    source.holder?.displayName ?? "",
  );
  const [holderContactName, setHolderContactName] = useState(
    source.holder?.contactName ?? "",
  );
  const [holderEmail, setHolderEmail] = useState(source.holder?.email ?? "");
  const [holderPhone, setHolderPhone] = useState(source.holder?.phone ?? "");
  const [addressLine1, setAddressLine1] = useState(
    source.holder?.address?.line1 ?? "",
  );
  const [addressLine2, setAddressLine2] = useState(
    source.holder?.address?.line2 ?? "",
  );
  const [city, setCity] = useState(source.holder?.address?.city ?? "");
  const [state, setState] = useState(source.holder?.address?.state ?? "");
  const [postalCode, setPostalCode] = useState(
    source.holder?.address?.postalCode ?? "",
  );
  const [country, setCountry] = useState(source.holder?.address?.country ?? "");
  const [dealName, setDealName] = useState(source.dealName ?? "");
  const [dealType, setDealType] = useState(source.dealType ?? "");
  const [internalNotes, setInternalNotes] = useState(
    source.internalNotes ?? "",
  );
  const [confirmArchive, setConfirmArchive] = useFollowedState(
    `compliance:source:${source._id}:confirm-archive`,
    false,
  );
  const [expandedRequirementId, setExpandedRequirementId] =
    useFollowedState<Id<"insuranceRequirements"> | null>(
      `compliance:source:${source._id}:expanded-requirement`,
      null,
    );

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

  const hasHolderDetails =
    !!source.holder ||
    [
      holderName,
      holderContactName,
      holderEmail,
      holderPhone,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      country,
    ].some((value) => value.trim());
  const contextAutoSave = useLocalFirstAutoSave({
    mutationName: `compliance.updateRequirementSource.context.${source._id}`,
    args: {
      holder: holderName.trim()
        ? {
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
          }
        : undefined,
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
        if (
          !open &&
          (!canManage ||
            ((await sourceAutoSave.saveNow()) &&
              (await contextAutoSave.saveNow())))
        )
          onClose();
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
          <p
            className={`max-w-72 text-right text-muted-foreground ${typeStyle("caption.default")}`}
          >
            {writeRestriction}
          </p>
        ) : null
      }
    >
      {canManage ? <AutoSaveStatus status={sourceAutoSave.status} /> : null}
      <div className="space-y-5">
        {confirmArchive ? (
          <OperationalPanel
            as="div"
            className="border-destructive/20 bg-destructive/5 p-4"
          >
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
              <div>
                <p className={`text-foreground ${typeStyle("body.medium")}`}>
                  Archive this source and its requirements?
                </p>
                <p
                  className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
                >
                  {source.requirementCount === 0
                    ? "The source will disappear from active compliance."
                    : `${source.requirementCount} active requirement${source.requirementCount === 1 ? "" : "s"} will also be archived.`}
                </p>
              </div>
            </div>
          </OperationalPanel>
        ) : null}
        <section className="space-y-3">
          <label
            className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
          >
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
          <label
            className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
          >
            Source type
            <Select
              value={sourceTypeDraft}
              disabled={!canManage}
              onValueChange={(value) => {
                if (value)
                  setSourceTypeDraft(value as RequirementSourceDocumentType);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {REQUIREMENT_SOURCE_TYPE_LABELS[sourceTypeDraft]}
                </SelectValue>
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
            <label
              className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
            >
              Holder name
              <Input
                value={holderName}
                onChange={(event) => setHolderName(event.target.value)}
                disabled={!canManage}
                placeholder="Landlord, lender, investor, or client"
              />
            </label>
            <label
              className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
            >
              Contact
              <Input
                value={holderContactName}
                onChange={(event) => setHolderContactName(event.target.value)}
                disabled={!canManage}
              />
            </label>
            <label
              className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
            >
              Email
              <Input
                type="email"
                value={holderEmail}
                onChange={(event) => setHolderEmail(event.target.value)}
                disabled={!canManage}
              />
            </label>
            <label
              className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
            >
              Phone
              <PhoneInput
                value={holderPhone || undefined}
                onChange={(value) => setHolderPhone(value ?? "")}
                defaultCountry="US"
                disabled={!canManage}
              />
            </label>
            <label
              className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
            >
              Address
              <AddressAutofillInput
                id={`requirement-source-holder-address-${source._id}`}
                value={{
                  street1: addressLine1,
                  street2: addressLine2,
                  city,
                  state,
                  zip: postalCode,
                  country,
                }}
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
              <label
                className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
              >
                City
                <Input
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  disabled={!canManage}
                />
              </label>
              <label
                className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
              >
                State
                <Input
                  value={state}
                  onChange={(event) => setState(event.target.value)}
                  disabled={!canManage}
                />
              </label>
              <label
                className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
              >
                ZIP
                <Input
                  value={postalCode}
                  onChange={(event) => setPostalCode(event.target.value)}
                  disabled={!canManage}
                />
              </label>
            </div>
          </div>
        </FormSection>
        <FormSection
          title="Deal context"
          description="Keep the request, relationship, and internal context in one place."
        >
          <div className="space-y-3">
            <label
              className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
            >
              Deal name
              <Input
                value={dealName}
                onChange={(event) => setDealName(event.target.value)}
                disabled={!canManage}
                placeholder="Office lease, Series B financing, client engagement"
              />
            </label>
            <label
              className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
            >
              Deal type
              <Input
                value={dealType}
                onChange={(event) => setDealType(event.target.value)}
                disabled={!canManage}
                placeholder="Lease, investment, contract"
              />
            </label>
            <div className="space-y-2">
              <p
                className={`text-muted-foreground ${typeStyle("label.field")}`}
              >
                Notes
              </p>
              <MarkdownEditor
                showToolbar
                value={internalNotes}
                onChange={setInternalNotes}
                label="Requirement source notes"
                readOnly={!canManage}
              />
            </div>
            {hasHolderDetails && !holderName.trim() ? (
              <p className={`text-destructive ${typeStyle("caption.default")}`}>
                Certificate holder name is required.
              </p>
            ) : null}
            <AutoSaveStatus status={contextAutoSave.status} />
          </div>
        </FormSection>
        <section className="space-y-2 border-t border-border pt-5">
          {source.fileName ? (
            <DrawerDetail label="File" value={source.fileName} />
          ) : null}
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
              <p
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
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
                    <p
                      className={`truncate text-foreground ${typeStyle("label.field")}`}
                    >
                      {certificate.fileName ??
                        `Certificate v${certificate.versionNumber}`}
                    </p>
                    <p
                      className={`truncate text-muted-foreground ${typeStyle("caption.default")}`}
                    >
                      {[
                        certificate.policy?.carrier,
                        certificate.policy?.policyNumber,
                        formatDisplayDate(certificate.createdAt),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
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
              <p
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
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
                        setExpandedRequirementId(
                          expanded ? null : requirement._id,
                        )
                      }
                    >
                      {expanded ? (
                        <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-foreground ${typeStyle("body.medium")}`}
                        >
                          {requirement.title}
                        </span>
                        <span
                          className={`block truncate text-muted-foreground ${typeStyle("caption.default")}`}
                        >
                          {requirementDrawerSummary(requirement)}
                        </span>
                      </span>
                    </button>
                    {expanded && canManage ? (
                      <div className="border-t border-border px-3 pb-3 pt-3">
                        <RequirementEditForm
                          requirement={requirement}
                          onSave={(values) =>
                            onSaveRequirement(requirement, values)
                          }
                          onArchive={() =>
                            void onArchiveRequirement(requirement._id)
                          }
                        />
                      </div>
                    ) : expanded ? (
                      <div className="space-y-2 border-t border-border px-3 pb-3 pt-3">
                        <DrawerDetail
                          label="Line"
                          value={lineDisplayLabel(requirement.lineOfBusiness)}
                        />
                        <p
                          className={`text-muted-foreground ${typeStyle("body.default")}`}
                        >
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

const SOURCE_SORT_COLUMNS = {
  name: (source: RequirementSource) => source.title,
  sourceType: (source: RequirementSource) =>
    REQUIREMENT_SOURCE_TYPE_LABELS[source.sourceType],
  requirements: (source: RequirementSource) => source.requirementCount,
  added: (source: RequirementSource) => source.createdAt,
};

function RequirementSourcesTable({
  followKey,
  sources,
  onSelect,
}: {
  followKey: string;
  sources: RequirementSource[];
  onSelect: (sourceId: Id<"requirementSourceDocuments">) => void;
}) {
  const tableSort = useTableSort(followKey, sources, SOURCE_SORT_COLUMNS);
  if (sources.length === 0) {
    return (
      <OperationalPanel as="div" className="p-5">
        <p className={`text-foreground ${typeStyle("body.medium")}`}>
          No requirement sources yet
        </p>
        <p
          className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
        >
          Imported leases, client contracts, and vendor requirement packets will
          appear here.
        </p>
      </OperationalPanel>
    );
  }

  return (
    <OperationalPanel as="div">
      <Table className="min-w-[840px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortableTableHead
              className="w-[44%] px-4"
              {...tableSort.head("name")}
            >
              Name
            </SortableTableHead>
            <SortableTableHead
              className="w-[22%]"
              {...tableSort.head("sourceType")}
            >
              Source type
            </SortableTableHead>
            <SortableTableHead
              className="w-[14%]"
              {...tableSort.head("requirements")}
            >
              Requirements
            </SortableTableHead>
            <SortableTableHead
              className="w-[20%] px-4"
              {...tableSort.head("added")}
            >
              Added
            </SortableTableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tableSort.rows.map((source) => (
            <TableRow
              key={source._id}
              className="cursor-pointer"
              onClick={() => onSelect(source._id)}
              tabIndex={0}
              onKeyDown={(event) =>
                openOnKeyboard(event, () => onSelect(source._id))
              }
            >
              <TableCell className="max-w-72 px-4">
                <p
                  className={`truncate text-foreground ${typeStyle("body.medium")}`}
                >
                  {source.title}
                </p>
                {source.fileName ? (
                  <p
                    className={`mt-1 truncate text-muted-foreground ${typeStyle("caption.default")}`}
                  >
                    {source.fileName}
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {REQUIREMENT_SOURCE_TYPE_LABELS[source.sourceType]}
              </TableCell>
              <TableCell
                className={`text-foreground ${typeStyle("data.numeric")}`}
              >
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
  pageContext,
  surface,
}: CompliancePageProps & { surface: ComplianceSurface }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentRoute = useRef({ pathname, searchParams });
  useEffect(() => {
    currentRoute.current = { pathname, searchParams };
  }, [pathname, searchParams]);
  const { openWithUrl } = usePdf();
  const { setPageContext, pushPageContext } = usePageContext();
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
  const updateRequirements = useUpdateCachedQuery<
    Requirement[],
    { orgId: Id<"organizations"> }
  >("compliance.listRequirements");
  const updateRequirementSources = useUpdateCachedQuery<
    RequirementSource[],
    { orgId: Id<"organizations"> }
  >("compliance.listRequirementSources");
  const upsertRequirement = useMutation(
    complianceApi.compliance.upsertRequirement,
  );
  const archiveRequirement = useMutation(
    complianceApi.compliance.archiveRequirement,
  );
  const updateRequirementSource = useMutation(
    complianceApi.compliance.updateRequirementSource,
  );
  const archiveRequirementSources = useMutation(
    complianceApi.compliance.archiveRequirementSources,
  );
  const generateRequirementImportUploadUrl = useMutation(
    complianceApi.compliance.generateRequirementImportUploadUrl,
  );
  const importRequirements = useAction(
    complianceApi.actions.complianceRequirements.importRequirements,
  );
  const recheckOwnRequirement = useAction(
    complianceApi.actions.complianceReview.recheckOwnRequirement,
  );

  const requestedRequirementId = searchParams.get("requirement");
  const requestedSourceId = searchParams.get("source");
  const requestedTab =
    searchParams.get("tab") ??
    (requestedSourceId
      ? "sources"
      : requestedRequirementId
        ? "requirements"
        : null);
  const handledDeepLink = useRef<string | null>(null);
  const hasCertificatesTab = Boolean(renderCertificatesTab);
  const view: ComplianceView =
    requestedTab === "certificates" && hasCertificatesTab
      ? "certificates"
      : requestedTab === "sources" && requirementSources?.length !== 0
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
  const uiKey = `compliance:${surface}`;
  const [creationDrawer, setCreationDrawer] = useFollowedState<
    "import" | "manual" | null
  >(`${uiKey}:creation-drawer`, null);
  const [requirementScope, setRequirementScope] =
    useFollowedState<RequirementScope>(`${uiKey}:scope`, "own_org");
  const [sourceFilter, setSourceFilter] = useSavedFollowedState<string[]>(
    `${uiKey}:source-filters`,
    [],
  );
  const [lineFilter, setLineFilter] = useSavedFollowedState<string[]>(
    `${uiKey}:line-filters`,
    [],
  );
  const [limitFilter, setLimitFilter] = useSavedFollowedState<string[]>(
    `${uiKey}:limit-filters`,
    [],
  );
  const [statusFilter, setStatusFilter] = useSavedFollowedState<string[]>(
    `${uiKey}:status-filters`,
    [],
  );
  const [selectedRequirementId, setSelectedRequirementId] =
    useFollowedState<Id<"insuranceRequirements"> | null>(
      `${uiKey}:selected-requirement`,
      null,
    );
  const [selectedSourceId, setSelectedSourceId] =
    useFollowedState<Id<"requirementSourceDocuments"> | null>(
      `${uiKey}:selected-source`,
      null,
    );
  const [sourceText, setSourceText] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [sourceTypeValue, setSourceTypeValue] =
    useState<RequirementSourceDocumentType>("vendor_requirements");
  const [sourceDetails, setSourceDetails] = useState(emptySourceDetails);
  const setSourceDetail = (
    key: keyof typeof emptySourceDetails,
    value: string,
  ) => setSourceDetails((current) => ({ ...current, [key]: value }));
  const [title, setTitle] = useState("");
  const [manualRequirementSourceId, setManualRequirementSourceId] = useState<
    Id<"requirementSourceDocuments"> | typeof INTERNAL_REQUIREMENT_SOURCE
  >(INTERNAL_REQUIREMENT_SOURCE);
  const [lineOfBusiness, setLineOfBusiness] = useState("CGL");
  const [limitKind, setLimitKind] =
    useState<RequirementLimitKind>("per_occurrence");
  const [limitAmount, setLimitAmount] = useState("");
  const [requirementText, setRequirementText] = useState("");
  const [provisions, setProvisions] = useState<RequirementProvision[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [archivingSources, setArchivingSources] = useState(false);
  const [checkingRequirementId, setCheckingRequirementId] =
    useState<Id<"insuranceRequirements"> | null>(null);
  const [certificateSourceId, setCertificateSourceId] =
    useFollowedState<Id<"requirementSourceDocuments"> | null>(
      `${uiKey}:certificate-source`,
      null,
    );
  const [certificateRequirementId, setCertificateRequirementId] =
    useFollowedState<Id<"insuranceRequirements"> | null>(
      `${uiKey}:certificate-requirement`,
      null,
    );
  const [certificateTabActions, setCertificateTabActions] =
    useState<ReactNode>(null);
  const [certificateTabRightPanel, setCertificateTabRightPanel] =
    useState<ReactNode>(null);
  const canManageCompliance = currentOrg?.role === "admin";
  const complianceWriteRestriction =
    currentOrg && currentOrg.role !== "admin"
      ? "Only an organization admin can make compliance changes."
      : null;

  const hasActiveClients = (clientRows ?? []).some(
    (row) => row.status === "active",
  );
  const hasActiveVendors = (vendorRows ?? []).some(
    (row) => row.status === "active",
  );
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
    view === "requirements" && showConnectFeatures
      ? activeRequirementScope
      : view;
  const requirementNavigationOptions = showConnectFeatures
    ? [
        { value: "own_org", label: "My requirements" },
        ...(!isPureVendorAccount
          ? [{ value: "vendors", label: "Vendor requirements" }]
          : []),
      ]
    : [{ value: "requirements", label: "Requirements" }];
  const navigationOptions: Array<{ value: string; label: string }> = [
    ...(surface === "operator"
      ? []
      : [{ value: "overview", label: "Overview" }]),
    ...requirementNavigationOptions,
    ...((requirementSources?.length ?? 0) > 0
      ? [{ value: "sources", label: "Sources" }]
      : []),
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
      (requirements ?? []).filter(
        (requirement) => requirement.scope === activeRequirementScope,
      ),
    [activeRequirementScope, requirements],
  );
  const sourceFilters = useMemo(
    () => Array.from(new Set(scopedRequirements.map(requirementSourceFilter))),
    [scopedRequirements],
  );
  const lineFilters = useMemo(() => {
    const present = Array.from(
      new Set(
        scopedRequirements.map((requirement) =>
          lineFilterValue(requirement.lineOfBusiness),
        ),
      ),
    ).sort((a, b) => lineFilterLabel(a).localeCompare(lineFilterLabel(b)));
    return present;
  }, [scopedRequirements]);
  const limitFilters = useMemo(() => {
    const present = Array.from(
      new Set(scopedRequirements.flatMap(requirementLimitFilters)),
    ).sort((a, b) => limitFilterLabel(a).localeCompare(limitFilterLabel(b)));
    return present;
  }, [scopedRequirements]);
  const statusFilters = useMemo(() => {
    const order: StatusFilter[] = [
      "met",
      "not_met",
      "expired",
      "expiring_soon",
      "unverified",
      "defined",
    ];
    const present = new Set(scopedRequirements.map(statusFilterValue));
    return order.filter((status) => present.has(status));
  }, [scopedRequirements]);
  // Ignore selections that no longer match any requirement in this scope.
  const effectiveSourceFilter = sourceFilter.filter((value) =>
    (sourceFilters as string[]).includes(value),
  );
  const effectiveLineFilter = lineFilter.filter((value) =>
    (lineFilters as string[]).includes(value),
  );
  const effectiveLimitFilter = limitFilter.filter((value) =>
    (limitFilters as string[]).includes(value),
  );
  const effectiveStatusFilter = statusFilter.filter((value) =>
    (statusFilters as string[]).includes(value),
  );
  const requirementFilters: FilterDefinition[] = [
    {
      id: "status",
      label: "Status",
      inline: true,
      multiple: true,
      value: effectiveStatusFilter,
      onChange: setStatusFilter,
      options: statusFilters.map((value) => ({
        value,
        label: statusFilterLabel(value),
      })),
    },
    {
      id: "line",
      label: "Line",
      inline: true,
      multiple: true,
      value: effectiveLineFilter,
      onChange: setLineFilter,
      options: lineFilters.map((value) => ({
        value,
        label: lineFilterLabel(value),
      })),
    },
    {
      id: "source",
      label: "Source",
      icon: <FileText />,
      multiple: true,
      value: effectiveSourceFilter,
      onChange: setSourceFilter,
      options: sourceFilters.map((value) => ({
        value,
        label: sourceLabel(value, scopedRequirements),
      })),
    },
    {
      id: "limit",
      label: "Limit type",
      icon: <Scale />,
      multiple: true,
      value: effectiveLimitFilter,
      onChange: setLimitFilter,
      options: limitFilters.map((value) => ({
        value,
        label: limitFilterLabel(value),
      })),
    },
  ];
  const matchesAny = (selected: string[], values: string[]) =>
    selected.length === 0 || values.some((value) => selected.includes(value));
  const visibleRequirements =
    surface === "operator"
      ? scopedRequirements
      : scopedRequirements.filter(
          (requirement) =>
            matchesAny(effectiveSourceFilter, [
              requirementSourceFilter(requirement),
            ]) &&
            matchesAny(effectiveLineFilter, [
              lineFilterValue(requirement.lineOfBusiness),
            ]) &&
            matchesAny(
              effectiveLimitFilter,
              requirementLimitFilters(requirement),
            ) &&
            matchesAny(effectiveStatusFilter, [statusFilterValue(requirement)]),
        );
  const selectedRequirement =
    (requirements ?? []).find(
      (requirement) => requirement._id === selectedRequirementId,
    ) ?? null;
  const selectedSource =
    (requirementSources ?? []).find(
      (source) => source._id === selectedSourceId,
    ) ?? null;
  const selectedSourceRequirements = selectedSource
    ? requirements?.filter(
        (requirement) => requirement.sourceDocumentId === selectedSource._id,
      )
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
  usePageContextLayer(
    pageContext && view !== "certificates"
      ? pageContext({
          view,
          scope: activeRequirementScope,
          requirementCount:
            requirements === undefined ? undefined : scopedRequirements.length,
          sourceCount: requirementSources?.length,
          selectedRequirement: selectedRequirement
            ? {
                id: selectedRequirement._id,
                title: selectedRequirement.title,
                lineOfBusiness: selectedRequirement.lineOfBusiness,
                status: statusFilterLabel(statusFilterValue(selectedRequirement)),
                sourceId: selectedRequirement.sourceDocumentId,
              }
            : null,
          selectedSource: selectedSource
            ? {
                id: selectedSource._id,
                title: selectedSource.title,
                holderName: selectedSource.holder?.displayName,
                requirementCount: selectedSourceRequirements?.length,
              }
            : null,
          creationDrawer,
          certificateSourceId,
        })
      : null,
  );

  useEffect(() => {
    if (!requestedRequirementId && !requestedSourceId) {
      handledDeepLink.current = null;
      return;
    }
    if (
      !orgId ||
      requirements === undefined ||
      requirementSources === undefined
    )
      return;
    const key = JSON.stringify([
      orgId,
      pathname,
      requestedRequirementId,
      requestedSourceId,
    ]);
    if (handledDeepLink.current === key) return;
    // Wait for the existing drawer's save-before-close path before changing records.
    if (
      selectedRequirement ||
      selectedSource ||
      creationDrawer ||
      certificateSourceId
    )
      return;
    handledDeepLink.current = key;
    if (requestedRequirementId && requestedSourceId) {
      toast.error("Open one requirement or source at a time.");
      return;
    }
    if (requestedRequirementId) {
      const requirement = requirements.find(
        (row) => row._id === requestedRequirementId,
      );
      if (!requirement) {
        toast.error("This requirement is unavailable.");
        return;
      }
      // Synchronize the URL selection only after the prior editor has closed.
      setRequirementScope(requirement.scope);
      setSelectedRequirementId(requirement._id);
      setSelectedSourceId(null);
    } else {
      const source = requirementSources.find(
        (row) => row._id === requestedSourceId,
      );
      if (!source) {
        toast.error("This source is unavailable.");
        return;
      }
      setSelectedSourceId(source._id);
      setSelectedRequirementId(null);
    }
  }, [
    orgId,
    pathname,
    requestedRequirementId,
    requestedSourceId,
    requirements,
    requirementSources,
    selectedRequirement,
    selectedSource,
    creationDrawer,
    certificateSourceId,
    setRequirementScope,
    setSelectedRequirementId,
    setSelectedSourceId,
  ]);

  const operatorContextOrgId = surface === "operator" ? orgId : undefined;
  const operatorContextSummary = contextSummary([
    `${orgContext?.name ?? "Client"} compliance`,
    `${navigationOptions.find((option) => option.value === navigationValue)?.label ?? "Requirements"} tab`,
    view === "requirements" && requirements
      ? requirementCountsContext(scopedRequirements)
      : view === "sources" && requirementSources
        ? `${requirementSources.length} requirement sources`
        : undefined,
  ]);
  useEffect(() => {
    if (!operatorContextOrgId) return;
    setPageContext({
      pageType: "operator_client_compliance",
      entityId: operatorContextOrgId,
      summary: operatorContextSummary,
    });
    return () => setPageContext(null);
  }, [operatorContextOrgId, operatorContextSummary, setPageContext]);
  // The record in the right panel, matching its precedence below: certificate
  // generation, then the requirement drawer, then the source drawer.
  const generatingForSource =
    certificateSourceId &&
    requirementSources?.find((source) => source._id === certificateSourceId);
  const generatingForRequirement =
    generatingForSource && certificateRequirementId
      ? requirements?.find(
          (requirement) => requirement._id === certificateRequirementId,
        )
      : undefined;
  const focusedRequirement = certificateSourceId
    ? generatingForRequirement
    : selectedRequirement;
  const focusedSource = certificateSourceId
    ? generatingForSource
    : !selectedRequirement && selectedSource;
  const focusedContext =
    !operatorContextOrgId || view === "certificates"
      ? null
      : focusedRequirement
        ? {
            pageType: "requirement",
            entityId: focusedRequirement._id,
            summary: requirementContextSummary(
              focusedRequirement,
              Boolean(certificateSourceId),
            ),
          }
        : focusedSource
          ? {
              pageType: "requirement_source",
              entityId: focusedSource._id,
              summary: requirementSourceContextSummary(
                focusedSource,
                Boolean(certificateSourceId),
              ),
            }
          : null;
  const focusedPageType = focusedContext?.pageType;
  const focusedEntityId = focusedContext?.entityId;
  const focusedSummary = focusedContext?.summary;
  useEffect(() => {
    if (!focusedPageType || !focusedEntityId) return;
    return pushPageContext({
      pageType: focusedPageType,
      entityId: focusedEntityId,
      summary: focusedSummary,
    });
  }, [focusedEntityId, focusedPageType, focusedSummary, pushPageContext]);

  if (isBroker) return null;

  function clearClosedSelection(kind: "requirement" | "source", id: string) {
    const route = currentRoute.current;
    const params = new URLSearchParams(route.searchParams.toString());
    if (params.get(kind) !== id) return;
    params.delete(kind);
    if (!params.has("tab")) params.set("tab", view);
    router.replace(`${route.pathname}?${params.toString()}`, { scroll: false });
  }

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
      toast.error(
        getUserFacingErrorMessage(error, "Unable to save requirement"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function removeRequirement(requirementId: Id<"insuranceRequirements">) {
    if (!orgId) return;
    const archivedRequirement =
      (requirements ?? []).find(
        (requirement) => requirement._id === requirementId,
      ) ?? null;
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
      toast.error(
        getUserFacingErrorMessage(error, "Unable to archive requirement"),
      );
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
                  status:
                    result?.status ??
                    item.complianceCheck?.status ??
                    "unverified",
                  notes: result?.notes
                    ? `Deep check: ${result.notes}`
                    : result?.matchedSummary,
                  checkedBy: "agent",
                },
              }
            : item,
        ),
      );
      toast.success("Compliance checked");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Unable to check compliance"),
      );
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
    if (
      activeRequirementScope === "own_org" &&
      !sourceDetails.holderName.trim()
    ) {
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
          headers: {
            "Content-Type": sourceFile.type || "application/octet-stream",
          },
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
        holder: sourceDetails.holderName.trim()
          ? {
              displayName: sourceDetails.holderName.trim(),
              contactName: sourceDetails.holderContactName.trim() || undefined,
              email: sourceDetails.holderEmail.trim() || undefined,
              phone: sourceDetails.holderPhone.trim() || undefined,
              address: {
                line1: sourceDetails.addressLine1.trim() || undefined,
                line2: sourceDetails.addressLine2.trim() || undefined,
                city: sourceDetails.city.trim() || undefined,
                state: sourceDetails.state.trim() || undefined,
                postalCode: sourceDetails.postalCode.trim() || undefined,
                country: sourceDetails.country.trim() || undefined,
              },
            }
          : undefined,
        dealName: sourceDetails.dealName.trim() || undefined,
        dealType: sourceDetails.dealType.trim() || undefined,
        internalNotes: sourceDetails.internalNotes.trim() || undefined,
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
      setSourceDetails(emptySourceDetails);
      setCreationDrawer(null);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Unable to generate requirements"),
        { id: importToast },
      );
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

  async function updateSource(
    source: RequirementSource,
    patch: SourceUpdatePatch,
  ) {
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
      current.map((item) =>
        item._id === requirement._id ? nextRequirement : item,
      ),
    );
    try {
      await upsertRequirement({
        orgId,
        requirementId: requirement._id,
        kind: requirement.kind,
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
        current.map((item) =>
          item._id === requirement._id ? requirement : item,
        ),
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
        current.filter(
          (requirement) =>
            !requirement.sourceDocumentId ||
            !archivedIds.has(requirement.sourceDocumentId),
        ),
      );
      setSelectedSourceId((current) =>
        current && archivedIds.has(current) ? null : current,
      );
      toast.success(
        result.archivedRequirementCount > 0
          ? `Archived ${result.archivedRequirementCount} requirement${result.archivedRequirementCount === 1 ? "" : "s"}`
          : "Requirement source archived",
      );
      return true;
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Unable to archive sources"),
      );
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
          <PillButton
            type="button"
            disabled={importing || (!sourceText.trim() && !sourceFile)}
            onClick={() => void generateRequirements()}
          >
            {importing ? "Importing..." : "Import requirements"}
          </PillButton>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <label
          className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
        >
          Source name
          <Input
            value={sourceName}
            onChange={(event) => setSourceName(event.target.value)}
            placeholder={sourceFile?.name ?? "Client vendor requirements"}
            disabled={importing}
          />
        </label>
        <label
          className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
        >
          Source type
          <Select
            value={sourceTypeValue}
            onValueChange={(value) =>
              setSourceTypeValue(value as RequirementSourceDocumentType)
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {REQUIREMENT_SOURCE_TYPE_LABELS[sourceTypeValue]}
              </SelectValue>
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
              <label
                className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
              >
                Holder name
                <Input
                  value={sourceDetails.holderName}
                  onChange={(event) =>
                    setSourceDetail("holderName", event.target.value)
                  }
                  placeholder="Landlord, lender, investor, or client"
                  required
                />
              </label>
              <label
                className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
              >
                Contact
                <Input
                  value={sourceDetails.holderContactName}
                  onChange={(event) =>
                    setSourceDetail("holderContactName", event.target.value)
                  }
                />
              </label>
              <label
                className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
              >
                Email
                <Input
                  type="email"
                  value={sourceDetails.holderEmail}
                  onChange={(event) =>
                    setSourceDetail("holderEmail", event.target.value)
                  }
                />
              </label>
              <label
                className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
              >
                Phone
                <PhoneInput
                  value={sourceDetails.holderPhone || undefined}
                  onChange={(value) =>
                    setSourceDetail("holderPhone", value ?? "")
                  }
                  defaultCountry="US"
                />
              </label>
              <label
                className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
              >
                Address
                <AddressAutofillInput
                  id="new-requirement-source-holder-address"
                  value={{
                    street1: sourceDetails.addressLine1,
                    street2: sourceDetails.addressLine2,
                    city: sourceDetails.city,
                    state: sourceDetails.state,
                    zip: sourceDetails.postalCode,
                    country: sourceDetails.country,
                  }}
                  onChange={(address) =>
                    setSourceDetails((current) => ({
                      ...current,
                      addressLine1: address.street1 ?? "",
                      addressLine2: address.street2 ?? "",
                      city: address.city ?? "",
                      state: address.state ?? "",
                      postalCode: address.zip ?? "",
                      country: address.country ?? "",
                    }))
                  }
                  display="street1"
                />
              </label>
              <div className="grid grid-cols-[minmax(0,1fr)_72px_96px] gap-2">
                <label
                  className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
                >
                  City
                  <Input
                    value={sourceDetails.city}
                    onChange={(event) =>
                      setSourceDetail("city", event.target.value)
                    }
                  />
                </label>
                <label
                  className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
                >
                  State
                  <Input
                    value={sourceDetails.state}
                    onChange={(event) =>
                      setSourceDetail("state", event.target.value)
                    }
                  />
                </label>
                <label
                  className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
                >
                  ZIP
                  <Input
                    value={sourceDetails.postalCode}
                    onChange={(event) =>
                      setSourceDetail("postalCode", event.target.value)
                    }
                  />
                </label>
              </div>
              <label
                className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
              >
                Deal name
                <Input
                  value={sourceDetails.dealName}
                  onChange={(event) =>
                    setSourceDetail("dealName", event.target.value)
                  }
                  placeholder="Office lease, financing, or client engagement"
                />
              </label>
              <label
                className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
              >
                Deal type
                <Input
                  value={sourceDetails.dealType}
                  onChange={(event) =>
                    setSourceDetail("dealType", event.target.value)
                  }
                  placeholder="Lease, investment, contract"
                />
              </label>
              <div className="space-y-2">
                <p
                  className={`text-muted-foreground ${typeStyle("label.field")}`}
                >
                  Notes
                </p>
                <MarkdownEditor
                  showToolbar
                  value={sourceDetails.internalNotes}
                  onChange={(value) => setSourceDetail("internalNotes", value)}
                  label="New requirement source notes"
                  readOnly={importing}
                />
              </div>
            </div>
          </FormSection>
        ) : null}
        <label
          className={`flex min-h-0 flex-1 flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
        >
          Requirement text
          <Textarea
            className="min-h-0 flex-1 resize-none field-sizing-fixed"
            rows={12}
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            placeholder="Paste insurance requirements or contract language."
            disabled={importing}
          />
        </label>
        <FileDropZone
          accept=".txt,.md,.markdown,.pdf,.docx,.csv,.json,.png,.jpg,.jpeg,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/csv,application/json,image/png,image/jpeg"
          disabled={importing}
          idleLabel="Upload requirement document"
          busyLabel="Upload requirement document"
          hint="TXT, Markdown, PDF, DOCX, CSV, JSON, PNG, or JPEG"
          onFile={(file) => {
            setSourceFile(file);
            setSourceName((current) => current.trim() || file.name);
          }}
        />
        {sourceFile ? (
          <OperationalPanel
            as="div"
            className="flex items-center justify-between gap-3 px-3 py-2"
          >
            <p
              className={`min-w-0 truncate text-foreground ${typeStyle("body.medium")}`}
            >
              {sourceFile.name}
            </p>
            <PillButton
              type="button"
              size="compact"
              variant="secondary"
              disabled={importing}
              onClick={() => setSourceFile(null)}
            >
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
          <PillButton
            type="submit"
            form="manual-compliance-requirement"
            disabled={submitting}
          >
            {submitting ? "Saving..." : "Save requirement"}
          </PillButton>
        </>
      }
    >
      <form
        id="manual-compliance-requirement"
        onSubmit={submitRequirement}
        className="flex min-h-0 flex-1 flex-col gap-4"
      >
        <label
          className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
        >
          Source (optional)
          <Select
            value={String(manualRequirementSourceId)}
            onValueChange={(value) => {
              if (value) {
                setManualRequirementSourceId(
                  value as
                    | Id<"requirementSourceDocuments">
                    | typeof INTERNAL_REQUIREMENT_SOURCE,
                );
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {manualRequirementSourceId === INTERNAL_REQUIREMENT_SOURCE
                  ? "No source — internal requirement"
                  : (requirementSources?.find(
                      (source) => source._id === manualRequirementSourceId,
                    )?.title ?? "Select a source")}
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
        <label
          className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
        >
          Title
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="General liability minimum"
            required
          />
        </label>
        <label
          className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
        >
          Line
          <Select
            value={lineOfBusiness}
            onValueChange={(value) => value && setLineOfBusiness(value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue>{lobLabel(lineOfBusiness)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COMMON_LOBS.map((code) => (
                <SelectItem key={code} value={code}>
                  {lobLabel(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
          <label
            className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
          >
            Limit
            <Select
              value={limitKind}
              onValueChange={(value) =>
                setLimitKind(value as RequirementLimitKind)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {REQUIREMENT_LIMIT_KIND_LABELS[limitKind]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {LIMIT_KIND_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {REQUIREMENT_LIMIT_KIND_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label
            className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
          >
            Amount
            <Input
              value={limitAmount}
              onChange={(event) => setLimitAmount(event.target.value)}
              placeholder="$1,000,000"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {PROVISION_OPTIONS.map((option) => (
            <PillButton
              key={option}
              type="button"
              size="compact"
              variant={provisions.includes(option) ? "primary" : "secondary"}
              onClick={() =>
                setProvisions((current) =>
                  current.includes(option)
                    ? current.filter((item) => item !== option)
                    : [...current, option],
                )
              }
            >
              {REQUIREMENT_PROVISION_LABELS[option]}
            </PillButton>
          ))}
        </div>
        <label
          className={`flex min-h-0 flex-1 flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
        >
          Requirement
          <Textarea
            className="min-h-0 flex-1 resize-none field-sizing-fixed"
            rows={8}
            value={requirementText}
            onChange={(event) => setRequirementText(event.target.value)}
            placeholder="Describe the coverage requirement in plain language."
            required
          />
        </label>
      </form>
    </SettingsDrawer>
  );

  const detailPanel = selectedRequirement ? (
    <RequirementDrawer
      key={selectedRequirement._id}
      requirement={selectedRequirement}
      checking={checkingRequirementId === selectedRequirement._id}
      canManage={canManageCompliance}
      writeRestriction={complianceWriteRestriction}
      onSave={saveRequirementEdits}
      onDeepCheck={(row) => void runDeeperCheck(row)}
      onGenerate={(requirement) => {
        if (!requirement.sourceDocumentId) {
          toast.error(
            "Connect this requirement to a source before generating certificates",
          );
          return;
        }
        setCertificateRequirementId(requirement._id);
        setCertificateSourceId(requirement.sourceDocumentId);
      }}
      onArchive={(id) => void removeRequirement(id)}
      onClose={() => {
        setSelectedRequirementId(null);
        clearClosedSelection("requirement", selectedRequirement._id);
      }}
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
      onClose={() => {
        setSelectedSourceId(null);
        clearClosedSelection("source", selectedSource._id);
      }}
    />
  ) : null;

  const addRequirementAction = (
    <PillButton size="compact" variant="secondary" onClick={openAddRequirement}>
      <Plus className="h-3.5 w-3.5" />
      Add requirement
    </PillButton>
  );
  const importRequirementsAction = (
    <PillButton
      size="compact"
      variant="primary"
      onClick={openImportRequirements}
    >
      <FileUp className="h-3.5 w-3.5" />
      Import requirements
    </PillButton>
  );
  const complianceActions = canManageCompliance ? (
    <>
      {addRequirementAction}
      {importRequirementsAction}
    </>
  ) : null;
  const certificatePanel =
    orgId && certificateSourceId ? (
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
  const requirementCreationPanel =
    creationDrawer === "manual" ? addRequirementPanel : importRequirementsPanel;
  const complianceRightPanel =
    certificatePanel ?? detailPanel ?? sourcePanel ?? requirementCreationPanel;
  const tabbed = navigationOptions.length > 1;
  // With view tabs, Add/Import belong to the views they act on; a single view
  // is the whole page, so its actions stay in the top bar.
  const viewActions =
    view === "certificates"
      ? certificateTabActions
      : view === "requirements"
        ? complianceActions
        : view === "sources" && canManageCompliance
          ? importRequirementsAction
          : null;
  const actions = tabbed
    ? null
    : view === "certificates"
      ? certificateTabActions
      : complianceActions;
  const rightPanel =
    view === "certificates" ? certificateTabRightPanel : complianceRightPanel;
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
      {tabbed &&
      viewActions &&
      !(view === "requirements" && surface !== "operator") ? (
        <ListToolbar
          followKey={`${uiKey}:${view}:actions`}
          actions={viewActions}
        />
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
            followKey={`${uiKey}:sources`}
            sources={requirementSources}
            onSelect={(sourceId) => {
              setSelectedSourceId(sourceId);
              setSelectedRequirementId(null);
              setCreationDrawer(null);
            }}
          />
        )
      ) : requirements === undefined ||
        (showConnectFeatures &&
          (clientRows === undefined || vendorRows === undefined)) ? (
        <RequirementsLoadingSkeleton />
      ) : view === "overview" ? (
        <OverviewTab
          requirements={requirements}
          onOpenRequirements={(line) => {
            setSourceFilter([]);
            setLineFilter([lineFilterValue(line)]);
            setLimitFilter([]);
            setStatusFilter([]);
            changeNavigation(
              showConnectFeatures ? activeRequirementScope : "requirements",
            );
          }}
        />
      ) : (
        <>
          {surface !== "operator" ? (
            <ListToolbar
              followKey={`${uiKey}:requirements`}
              filters={requirementFilters}
              actions={tabbed ? viewActions : undefined}
            />
          ) : null}
          {visibleRequirements.length === 0 ? (
            <EmptyState />
          ) : (
            <RequirementsTable
              followKey={`${uiKey}:requirements`}
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

  const page = tabbed ? (
    <PageTabs value={navigationValue} onValueChange={changeNavigation}>
      <PageTabsList aria-label="Compliance view">
        {navigationOptions.map((option) => (
          <TabsTrigger key={option.value} value={option.value}>
            {option.label}
          </TabsTrigger>
        ))}
      </PageTabsList>
      <TabsContent value={navigationValue}>{content}</TabsContent>
    </PageTabs>
  ) : (
    content
  );

  if (renderShell) {
    return renderShell({ actions, rightPanel, children: page });
  }

  return (
    <AppShell actions={actions} rightPanel={rightPanel}>
      {page}
    </AppShell>
  );
}

export function CompliancePage(props: CompliancePageProps = {}) {
  return <ComplianceWorkspace {...props} surface="customer" />;
}

export function OperatorComplianceWorkspace(props: CompliancePageProps = {}) {
  return <ComplianceWorkspace {...props} surface="operator" />;
}
