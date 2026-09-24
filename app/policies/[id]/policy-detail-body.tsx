"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { FadeIn } from "@claritylabs-inc/ui/components/fade-in";
import { Archive, Clock3, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";
import { buildCoverageBreakdown } from "@/convex/lib/coverageBreakdown";
import { lobLabel, policyLobCodes } from "@/convex/lib/linesOfBusiness";
import { PillButton } from "@/components/ui/pill-button";
import { Tabs, TabsList, TabsTrigger } from "@claritylabs-inc/ui/components/tabs";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import {
  OperationalItem,
  OperationalPanel,
  OperationalPanelBody,
  OperationalSkeletonList,
} from "@claritylabs-inc/ui/components/operational-panel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@claritylabs-inc/ui/components/dialog";
import { usePdf } from "@/components/pdf-context";
import {
  CertificateDetailPanel,
  certificateVersionActionInput,
  type CertificateHolderDraft,
  type PolicyCertificateRecord,
} from "@/components/certificates/certificate-workspace";
import { usePageContext } from "@/hooks/use-page-context";
import { PolicyDetailsTab } from "./policy-details-tab";
import { PolicyCoveragesTab } from "./policy-coverages-tab";
import {
  extractionReviewQuestions,
  PolicyExtractionReview,
} from "./policy-extraction-review-tab";
import { PolicySectionsTab } from "./policy-sections-tab";
import { PolicyBreakdownEditor } from "./policy-breakdown-editor";
import {
  PolicyDetailsEditor,
  type PolicyDetailsEditSection,
} from "./policy-details-editor";
import { CertificatesTab, ViewPdfButton } from "./policy-certificates-tab";
import { CertificateGeneratePanel } from "@/components/certificates/certificate-generate-panel";
import {
  useCachedPolicyDetail,
  useCachedPolicySummary,
  useCachedViewerOrg,
} from "@/lib/sync/spot-cached-queries";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import {
  formatDisplayDateTime,
  formatDisplayPolicyPeriod,
} from "@/lib/date-format";
import { policyTermTypeFromVersionSnapshot } from "@/convex/lib/policyVersioning";
import { PolicyDetailSkeleton } from "./policy-detail-skeleton";
import { PolicyExtractionBanner } from "@/components/shared/extraction-banner";
import {
  ReextractControl,
  useReextractControl,
} from "@/components/shared/reextract-control";
import { resolvePolicyPartyContext } from "@/convex/lib/policyPartyContext";
import {
  extractionState,
  hasFinalExtraction,
} from "@/lib/extraction-state";
import { typeStyle } from "@/lib/typography";

type PolicyDetailTab =
  | "sections"
  | "details"
  | "coverages"
  | "review"
  | "certificates"
  | "history";

function parsePolicyDetailTab(
  value: string | null,
  fallback: PolicyDetailTab = "details",
): PolicyDetailTab {
  if (
    value === "sections" ||
    value === "details" ||
    value === "coverages" ||
    value === "review" ||
    value === "certificates" ||
    value === "history"
  ) {
    return value;
  }
  return fallback;
}

type PolicyVersionRow = {
  _id: Id<"policyVersions">;
  versionNumber: number;
  versionKind: "new_policy" | "policy_change" | "re_extraction" | "renewal";
  effectiveDate?: string;
  expirationDate?: string;
  policyNumber?: string;
  summary?: string;
  fieldDiffs?: PolicyVersionFieldDiff[];
  snapshot?: unknown;
  createdAt: number;
};

type PolicyVersionFieldDiff = {
  fieldPath?: string;
};

const POLICY_VERSION_LABELS: Record<PolicyVersionRow["versionKind"], string> = {
  new_policy: "New policy",
  policy_change: "Policy change",
  re_extraction: "Re-extraction",
  renewal: "Renewal",
};

const POLICY_VERSION_FIELD_LABEL_OVERRIDES: Record<string, string> = {
  insuredDba: "Insured DBA",
  generalAgent: "General Agent",
  mga: "General Agent",
  isRenewal: "Renewal flag",
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function changedFieldLabel(count: number) {
  return count > 0 ? pluralize(count, "field change") : "No field changes";
}

function formatVersionDate(value: number) {
  return formatDisplayDateTime(value);
}

function formatPolicyTerm(version: PolicyVersionRow) {
  return (
    formatDisplayPolicyPeriod(
      version.effectiveDate,
      version.expirationDate,
      policyTermTypeFromVersionSnapshot(version.snapshot),
    ) || "Not recorded"
  );
}

function meaningfulVersionSummary(version: PolicyVersionRow) {
  const summary = version.summary?.trim();
  if (!summary) return undefined;
  if (
    version.versionKind === "new_policy" &&
    summary.startsWith("Initial policy - ")
  ) {
    return undefined;
  }
  return summary;
}

function formatFieldLabel(fieldPath: string) {
  const knownLabel = POLICY_VERSION_FIELD_LABEL_OVERRIDES[fieldPath];
  if (knownLabel) return knownLabel;
  return fieldPath
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function changedFieldLabels(version: PolicyVersionRow) {
  return (version.fieldDiffs ?? [])
    .map((diff) => diff.fieldPath)
    .filter((fieldPath): fieldPath is string => !!fieldPath)
    .map(formatFieldLabel);
}

function HistoryDatum({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
        {label}
      </p>
      <p
        className={`mt-0.5 min-w-0 break-words text-foreground ${typeStyle("body.default")}`}
      >
        {value}
      </p>
    </div>
  );
}

function PolicyHistoryTab({ policyId }: { policyId: Id<"policies"> }) {
  const versions = useCachedQuery(
    "policyVersions.listByPolicy",
    api.policyVersions.listByPolicy,
    { policyId },
  ) as PolicyVersionRow[] | undefined;

  if (versions === undefined) {
    return <OperationalSkeletonList rows={3} />;
  }

  if (versions.length === 0) {
    return (
      <OperationalPanel as="div">
        <OperationalPanelBody className="px-4 py-8 text-center">
          <Clock3 className="mx-auto mb-3 h-5 w-5 text-muted-foreground/50" />
          <p className={`text-foreground ${typeStyle("body.medium")}`}>
            No policy history yet
          </p>
          <p
            className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
          >
            Policy versions will appear as renewals, endorsements, and
            re-extractions are recorded.
          </p>
        </OperationalPanelBody>
      </OperationalPanel>
    );
  }

  const currentPolicyNumber = versions[0]?.policyNumber;

  return (
    <OperationalPanel as="div">
      {versions.map((version, index) => {
        const fields = changedFieldLabels(version);
        const diffCount = fields.length;
        const summary = meaningfulVersionSummary(version);
        const showChangeCount =
          diffCount > 0 || version.versionKind !== "new_policy";
        const showEventKind = version.versionKind !== "new_policy";
        const showPolicyNumber =
          !!version.policyNumber &&
          versions.length > 1 &&
          version.policyNumber !== currentPolicyNumber;
        return (
          <OperationalItem key={version._id} className="py-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h3 className={`text-foreground ${typeStyle("heading.micro")}`}>
                  Version {version.versionNumber}
                </h3>
                {showEventKind ? (
                  <span
                    className={`text-muted-foreground ${typeStyle("body.default")}`}
                  >
                    {POLICY_VERSION_LABELS[version.versionKind]}
                  </span>
                ) : null}
                {index === 0 ? (
                  <StatusTag tone="success">Current</StatusTag>
                ) : null}
                <span
                  className={`text-muted-foreground sm:ml-auto ${typeStyle("caption.default")}`}
                >
                  {formatVersionDate(version.createdAt)}
                </span>
              </div>
              {summary ? (
                <p
                  className={`mt-1 max-w-4xl text-foreground ${typeStyle("body.default")}`}
                >
                  {summary}
                </p>
              ) : null}
              <div className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(10rem,1fr)_minmax(8rem,0.8fr)]">
                {showPolicyNumber ? (
                  <HistoryDatum
                    label="Policy number"
                    value={version.policyNumber}
                  />
                ) : null}
                <HistoryDatum label="Term" value={formatPolicyTerm(version)} />
                {showChangeCount ? (
                  <HistoryDatum
                    label="Changes"
                    value={changedFieldLabel(diffCount)}
                  />
                ) : null}
              </div>
              {fields.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span
                    className={`text-muted-foreground ${typeStyle("caption.default")}`}
                  >
                    Changed
                  </span>
                  {fields.slice(0, 5).map((field) => (
                    <Badge
                      key={`${version._id}-${field}`}
                      variant="ghost"
                      className={`text-muted-foreground ${typeStyle("label.tag")}`}
                    >
                      {field}
                    </Badge>
                  ))}
                  {fields.length > 5 ? (
                    <span
                      className={`text-muted-foreground ${typeStyle("caption.default")}`}
                    >
                      +{fields.length - 5} more
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </OperationalItem>
        );
      })}
    </OperationalPanel>
  );
}

export interface PolicyDetailBodyProps {
  id: string;
  /** Called whenever the breadcrumb label changes. Host renders it. */
  onBreadcrumb?: (node: ReactNode) => void;
  /** Called whenever the header actions change. Host renders them. */
  onActions?: (node: ReactNode) => void;
  /** Called whenever the right-side panel changes. Host renders it next to the main pane. */
  onRightPanel?: (node: ReactNode) => void;
  /** Where to navigate after a policy is archived. */
  afterArchiveHref?: string;
  /** Where to navigate after a policy is restored. */
  afterRestoreHref?: string;
  /** Hide management actions for read-only connected-vendor policy access. */
  readOnly?: boolean;
  /** Enable direct operator management without treating the operator as a broker member. */
  operatorMode?: boolean;
  /**
   * With readOnly, still allow archive, restore, and extraction cancellation
   * for policies the viewer's own client organization uploaded.
   */
  canManageOwnUploads?: boolean;
}

export function PolicyDetailBody({
  id,
  onBreadcrumb,
  onActions,
  onRightPanel,
  afterArchiveHref = "/policies?view=archived",
  afterRestoreHref = "/policies",
  readOnly = false,
  operatorMode = false,
  canManageOwnUploads = false,
}: PolicyDetailBodyProps) {
  const viewerOrg = useCachedViewerOrg();
  const searchParams = useSearchParams();
  const [showCertificateSheet, setShowCertificateSheet] = useState(false);
  const [showEditExtractedFields, setShowEditExtractedFields] = useState(false);
  const [editingPolicyDetails, setEditingPolicyDetails] =
    useState<PolicyDetailsEditSection | null>(null);
  const [selectedCertificate, setSelectedCertificate] =
    useState<PolicyCertificateRecord | null>(null);
  const [reissuingCertificateId, setReissuingCertificateId] =
    useState<Id<"policyCertificates"> | null>(null);
  const [savingCertificateId, setSavingCertificateId] =
    useState<Id<"policyCertificates"> | null>(null);
  const [archivingCertificateId, setArchivingCertificateId] =
    useState<Id<"policyCertificates"> | null>(null);
  const [activeTab, setActiveTab] = useState<PolicyDetailTab>(() =>
    parsePolicyDetailTab(
      searchParams.get("tab"),
      operatorMode && (searchParams.get("run") || searchParams.get("traceId"))
        ? "sections"
        : "details",
    ),
  );
  const policySummary = useCachedPolicySummary(id as Id<"policies">);
  const fullPolicy = useCachedPolicyDetail(
    id as Id<"policies">,
  );
  const policy = fullPolicy ?? policySummary;
  const history = useCachedQuery(
    "policyVersions.listByPolicy",
    api.policyVersions.listByPolicy,
    !operatorMode ? { policyId: id as Id<"policies"> } : "skip",
  );
  const hasHistory = (history?.length ?? 0) > 0;
  const certificates = useCachedQuery(
    "certificateLifecycle.listByPolicy",
    api.certificateLifecycle.listByPolicy,
    { policyId: id as Id<"policies"> },
  );
  const certificateActivity = useCachedQuery(
    "certificates.listActivityByPolicy",
    api.certificates.listActivityByPolicy,
    { policyId: id as Id<"policies"> },
  );
  const hasCertificates = (certificates?.length ?? 0) > 0 || (certificateActivity?.certificates.length ?? 0) > 0 || (certificateActivity?.holds.length ?? 0) > 0;
  const fileUrl = useCachedQuery(
    "policies.getPolicyFileUrl.detail",
    api.policies.getPolicyFileUrl,
    policy ? { policyId: id as Id<"policies"> } : "skip",
  );

  const archivePolicy = useMutation(api.policies.archive);
  const restorePolicy = useMutation(api.policies.restore);
  const archiveCertificateMutation = useMutation(
    api.certificateLifecycle.archive,
  );
  const generateCertificate = useAction(api.certificates.generateForPolicy);
  const { control: reextract, dialog: reextractDialog } = useReextractControl(
    policy?._id,
  );

  const router = useRouter();
  const initialPage = Number(searchParams.get("page")) || undefined;
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const { openWithUrl, setFileUrl: preloadPdfUrl } = usePdf();
  const { setPageContext } = usePageContext();

  useEffect(() => {
    if (policy) {
      const lines = policyLobCodes(policy).map(lobLabel);
      const parties = resolvePolicyPartyContext(policy);
      setPageContext({
        pageType: "policy",
        entityId: policy._id,
        summary: `${parties.primaryDisplayName ?? "Unknown"} ${policy.policyNumber ?? ""} — ${lines.join(", ")}`,
      });
    }
    return () => setPageContext(null);
  }, [policy, setPageContext]);

  const didAutoOpen = useRef(false);
  useEffect(() => {
    if (fileUrl && !didAutoOpen.current) {
      didAutoOpen.current = true;
      preloadPdfUrl(fileUrl);
      if (initialPage) {
        openWithUrl(fileUrl, initialPage);
      }
    }
  }, [fileUrl, initialPage, openWithUrl, preloadPdfUrl]);

  const p = (policy ?? {}) as unknown as Record<string, unknown>;
  const policyParties = resolvePolicyPartyContext(p);
  const displayName = policyParties.primaryDisplayName ?? "";
  const policyNumber = (p.policyNumber as string | undefined) ?? "";
  const isArchived = !!p.deletedAt;
  const canEditExtractedFields =
    operatorMode ||
    (viewerOrg?.org as { type?: "broker" } | undefined)?.type === "broker";
  const state = useMemo(
    () => extractionState((policy ?? {}) as Record<string, unknown>),
    [policy],
  );
  const isRejectedDocument = state.kind === "not_a_policy";
  const breadcrumbLabel =
    (!isRejectedDocument &&
      [displayName, policyNumber]
        .filter(
          (value) => value &&
            !/^(unknown|extracting\.{0,3}|not applicable|n\/a)$/i.test(value.trim()),
        )
        .join(" ")) ||
    (p.fileName as string | undefined) ||
    "Uploaded document";
  const isPolicyFinal = hasFinalExtraction(state);
  const canEditPolicyDetails =
    canEditExtractedFields && !readOnly && !isArchived && isPolicyFinal;
  const canManageUpload =
    !readOnly || (canManageOwnUploads && p.uploadedBySide === "client");
  const canControlExtraction = canManageUpload && !isArchived;
  const reviewQuestions = extractionReviewQuestions(p);
  const hasExtractionReviews = reviewQuestions.length > 0;
  const coverageBreakdown = buildCoverageBreakdown(p);
  const hasCoverages = coverageBreakdown.all.length > 0 || coverageBreakdown.schedules.length > 0;
  const visibleTabs = [
    { id: "details" as const, label: "Details" },
    ...(!isRejectedDocument && hasCoverages
      ? [{ id: "coverages" as const, label: "Coverages" }]
      : []),
    ...(hasExtractionReviews && !isRejectedDocument
      ? [{ id: "review" as const, label: "Review" }]
      : []),
    ...(!isRejectedDocument && hasCertificates
      ? [{ id: "certificates" as const, label: "Certificates" }]
      : []),
    ...(operatorMode ? [{ id: "sections" as const, label: "Sections" }] : []),
    ...(!operatorMode && hasHistory
      ? [{ id: "history" as const, label: "History" }]
      : []),
  ];
  const visibleActiveTab = visibleTabs.some((tab) => tab.id === activeTab)
    ? activeTab
    : "details";
  const selectedCertificateForPanel =
    visibleActiveTab === "certificates" &&
    selectedCertificate?.policyId === policy?._id
      ? selectedCertificate
      : null;

  const openPolicyDetailsEditor = useCallback(
    (section: PolicyDetailsEditSection) => {
      setShowCertificateSheet(false);
      setShowEditExtractedFields(false);
      setSelectedCertificate(null);
      setEditingPolicyDetails(section);
    },
    [],
  );

  const reissueCertificate = useCallback(
    async (row: PolicyCertificateRecord) => {
      const holder = row.holder;
      if (!holder?.displayName) {
        toast.error("Certificate holder is missing");
        return;
      }
      setReissuingCertificateId(row._id);
      try {
        const result = await generateCertificate(
          certificateVersionActionInput(row),
        );
        if (
          (result as { status?: string }).status ===
          "ambiguous_certificate_holder"
        ) {
          toast.message(
            (result as { message?: string }).message ??
              "Choose the existing certificate to reissue.",
          );
          return;
        }
        if (
          (result as { status?: string }).status ===
          "held_policy_change_required"
        ) {
          toast.message(
            (result as { message?: string }).message ??
              "Broker review is needed before reissue.",
          );
          return;
        }
        toast.success("Certificate reissued");
        if ((result as { url?: string }).url) {
          openWithUrl((result as { url: string }).url);
        }
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(error, "Could not reissue certificate"),
        );
      } finally {
        setReissuingCertificateId(null);
      }
    },
    [generateCertificate, openWithUrl],
  );

  const editCertificateHolder = useCallback(
    async (row: PolicyCertificateRecord, draft: CertificateHolderDraft) => {
      setSavingCertificateId(row._id);
      try {
        const result = await generateCertificate(
          certificateVersionActionInput(row, draft),
        );
        if (
          (result as { status?: string }).status ===
          "held_policy_change_required"
        ) {
          toast.message(
            (result as { message?: string }).message ??
              "Broker review is needed before generating this version.",
          );
          return false;
        }
        const versionNumber = (result as { versionNumber?: number })
          .versionNumber;
        toast.success(
          versionNumber
            ? `Certificate version ${versionNumber} generated`
            : "New certificate version generated",
        );
        if ((result as { url?: string }).url) {
          openWithUrl((result as { url: string }).url);
        }
        return true;
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(
            error,
            "Could not update certificate holder",
          ),
        );
        return false;
      } finally {
        setSavingCertificateId(null);
      }
    },
    [generateCertificate, openWithUrl],
  );

  const archiveCertificate = useCallback(
    async (row: PolicyCertificateRecord) => {
      setArchivingCertificateId(row._id);
      try {
        await archiveCertificateMutation({ certificateId: row._id });
        setSelectedCertificate(null);
        toast.success("Certificate archived");
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(error, "Could not archive certificate"),
        );
      } finally {
        setArchivingCertificateId(null);
      }
    },
    [archiveCertificateMutation],
  );

  useEffect(() => {
    if (!onBreadcrumb) return;
    if (!policy) {
      onBreadcrumb(null);
      return;
    }
    onBreadcrumb(
      <span className="inline-flex min-w-0 items-center gap-2">
        <span className="truncate">
          {breadcrumbLabel}
        </span>
        {operatorMode && Boolean(p.isDemo) ? (
          <Badge variant="ghost" className="shrink-0 text-muted-foreground">
            Demo data
          </Badge>
        ) : null}
      </span>,
    );
    return () => onBreadcrumb(null);
  }, [onBreadcrumb, operatorMode, p.isDemo, policy, breadcrumbLabel]);

  const handleArchive = async () => {
    if (!policy) return;
    setArchiving(true);
    try {
      await archivePolicy({ id: policy._id });
      setShowArchiveDialog(false);
      toast.success("Policy archived");
      router.push(afterArchiveHref);
    } catch {
      toast.error("Failed to archive policy");
    } finally {
      setArchiving(false);
    }
  };

  const handleRestore = async () => {
    if (!policy) return;
    setRestoring(true);
    try {
      await restorePolicy({ id: policy._id });
      toast.success("Policy restored");
      router.push(afterRestoreHref);
    } catch {
      toast.error("Failed to restore policy");
    } finally {
      setRestoring(false);
    }
  };

  useEffect(() => {
    if (!onActions) return;
    if (!policy) {
      onActions(null);
      return;
    }
    onActions(
      <>
        <ViewPdfButton url={fileUrl} disabled={!fileUrl} />
        {canControlExtraction ? (
          <ReextractControl control={reextract} state={state} />
        ) : null}
        {canManageUpload && !isArchived && (
          <PillButton
            size="compact"
            variant="secondary"
            label="Archive"
            expandLabel
            onClick={() => setShowArchiveDialog(true)}
          >
            <Archive className="size-3.5" strokeWidth={2} />
          </PillButton>
        )}
        {!readOnly && !isArchived && (
          <PillButton
            size="compact"
            onClick={() => {
              if (!isPolicyFinal) {
                toast.message("Available once Spot finishes reading this policy");
                return;
              }
              setSelectedCertificate(null);
              setShowCertificateSheet(true);
            }}
          >
            <Plus className="size-3.5" />
            Generate COI
          </PillButton>
        )}
      </>,
    );
    return () => onActions(null);
  }, [
    onActions,
    policy,
    readOnly,
    canManageUpload,
    canControlExtraction,
    isArchived,
    isPolicyFinal,
    reextract,
    state,
    fileUrl,
  ]);

  useEffect(() => {
    if (!onRightPanel) return;
    if (!policy) {
      onRightPanel(null);
      return;
    }
    if (showCertificateSheet && !readOnly && isPolicyFinal && policy.orgId) {
      onRightPanel(
        <CertificateGeneratePanel
          open={showCertificateSheet}
          onOpenChange={setShowCertificateSheet}
          orgId={policy.orgId}
          initialPolicyId={policy._id}
          policyLocked
        />,
      );
      return () => onRightPanel(null);
    }
    if (editingPolicyDetails && fullPolicy && canEditPolicyDetails) {
      onRightPanel(
        <PolicyDetailsEditor
          key={`${fullPolicy._id}:${editingPolicyDetails}`}
          policy={
            fullPolicy as unknown as Record<string, unknown> & {
              _id: Id<"policies">;
            }
          }
          section={editingPolicyDetails}
          open
          onOpenChange={(open) => {
            if (!open) setEditingPolicyDetails(null);
          }}
        />,
      );
      return () => onRightPanel(null);
    }
    if (
      showEditExtractedFields &&
      fullPolicy &&
      canEditExtractedFields &&
      !isArchived
    ) {
      onRightPanel(
        <PolicyBreakdownEditor
          key={fullPolicy._id}
          policy={
            fullPolicy as unknown as Record<string, unknown> & {
              _id: Id<"policies">;
            }
          }
          readOnly={false}
          open={showEditExtractedFields}
          onOpenChange={setShowEditExtractedFields}
        />,
      );
      return () => onRightPanel(null);
    }
    if (selectedCertificateForPanel) {
      onRightPanel(
        <CertificateDetailPanel
          row={selectedCertificateForPanel}
          onClose={() => setSelectedCertificate(null)}
          onReissue={!readOnly ? reissueCertificate : undefined}
          onEditHolder={!readOnly ? editCertificateHolder : undefined}
          onArchive={!readOnly ? archiveCertificate : undefined}
          reissuing={reissuingCertificateId === selectedCertificateForPanel._id}
          savingHolder={savingCertificateId === selectedCertificateForPanel._id}
          archiving={archivingCertificateId === selectedCertificateForPanel._id}
        />,
      );
      return () => onRightPanel(null);
    }
    onRightPanel(null);
    return () => onRightPanel(null);
  }, [
    onRightPanel,
    policy,
    fullPolicy,
    readOnly,
    isPolicyFinal,
    showCertificateSheet,
    showEditExtractedFields,
    editingPolicyDetails,
    selectedCertificateForPanel,
    reissueCertificate,
    editCertificateHolder,
    archiveCertificate,
    reissuingCertificateId,
    savingCertificateId,
    archivingCertificateId,
    canEditExtractedFields,
    canEditPolicyDetails,
    isArchived,
  ]);

  if (policy === undefined) {
    return <PolicyDetailSkeleton />;
  }

  if (policy === null) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-2">Policy not found</p>
        <Link
          href={afterRestoreHref}
          className={`text-primary hover:underline ${typeStyle("control.button")}`}
        >
          Back to policies
        </Link>
      </div>
    );
  }

  return (
    <>
      <FadeIn when={true} staggerIndex={0} duration={0.6}>
        {isArchived && (
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-input bg-foreground/[0.025] px-4 py-2.5">
            <p
              className={`flex-1 text-muted-foreground ${typeStyle("body.default")}`}
            >
              {isRejectedDocument
                ? "This document is archived and excluded from active Spot workflows."
                : "This policy is archived and excluded from active Spot workflows."}
            </p>
            {canManageUpload ? (
              <PillButton
                variant="secondary"
                size="compact"
                onClick={handleRestore}
                disabled={restoring}
              >
                {restoring ? "Restoring..." : "Restore"}
              </PillButton>
            ) : null}
          </div>
        )}
      </FadeIn>

      <Dialog
        open={showArchiveDialog}
        onOpenChange={(v) => !v && setShowArchiveDialog(false)}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Archive policy</DialogTitle>
            <DialogDescription>
              Archive <strong>{policyNumber}</strong>? It will be excluded from
              active policy lists, compliance, search, and Spot tools until
              restored.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <PillButton
              variant="secondary"
              onClick={() => setShowArchiveDialog(false)}
              disabled={archiving}
            >
              Cancel
            </PillButton>
            <PillButton
              variant="secondary"
              onClick={handleArchive}
              disabled={archiving}
            >
              {archiving ? "Archiving..." : "Archive"}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {reextractDialog}

      {/* The local cache can briefly hold another policy; toasts outlive renders. */}
      {!operatorMode && policy._id === id ? (
        <PolicyExtractionBanner
          policyId={policy._id}
          state={state}
          onReextract={
            canControlExtraction ? reextract.requestReextract : undefined
          }
          onCancel={canControlExtraction ? reextract.cancel : undefined}
          cancelling={reextract.cancelling}
        />
      ) : null}

      {visibleTabs.length > 1 ? (
        <Tabs
          value={visibleActiveTab}
          onValueChange={(value) => setActiveTab(value as PolicyDetailTab)}
          className="mb-6"
        >
          <TabsList variant="pill">
            {visibleTabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.id === "review" ? (
                  <span className="inline-flex items-center gap-1.5">
                    Review
                    <span
                      className={`rounded-full border border-border-emphasized px-1.5 text-muted-foreground ${typeStyle("label.tag")}`}
                    >
                      {reviewQuestions.length}
                    </span>
                  </span>
                ) : (
                  tab.label
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      {visibleActiveTab === "details" && (
        <PolicyDetailsTab
          policy={policy}
          state={state}
          fileUrl={fileUrl}
          canEdit={canEditPolicyDetails}
          onEdit={openPolicyDetailsEditor}
        />
      )}

      {visibleActiveTab === "sections" && operatorMode ? (
        <PolicySectionsTab policyId={policy._id} fileUrl={fileUrl} />
      ) : null}

      {visibleActiveTab === "coverages" && fullPolicy === undefined ? (
        <OperationalSkeletonList rows={5} showTrailing={false} />
      ) : null}

      {visibleActiveTab === "coverages" && fullPolicy ? (
        <PolicyCoveragesTab policy={fullPolicy} fileUrl={fileUrl} />
      ) : null}

      {visibleActiveTab === "review" && hasExtractionReviews && (
        <FadeIn when={true} staggerIndex={1} duration={0.5}>
          <PolicyExtractionReview
            policy={
              policy as unknown as Record<string, unknown> & {
                _id: Id<"policies">;
              }
            }
            readOnly={readOnly || isArchived}
          />
        </FadeIn>
      )}

      {visibleActiveTab === "certificates" && !isPolicyFinal && (
        <OperationalPanel as="div">
          <OperationalPanelBody
            className={`text-muted-foreground ${typeStyle("body.default")}`}
          >
            Certificates are available once Spot finishes reading this policy.
          </OperationalPanelBody>
        </OperationalPanel>
      )}

      {visibleActiveTab === "certificates" && isPolicyFinal && (
        <CertificatesTab
          policyId={policy._id}
          selectedCertificateId={selectedCertificateForPanel?._id ?? null}
          onSelectCertificate={setSelectedCertificate}
        />
      )}

      {visibleActiveTab === "history" && (
        <PolicyHistoryTab policyId={policy._id} />
      )}
    </>
  );
}
