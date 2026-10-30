"use client";

import dayjs from "dayjs";
import { InformationDrawer } from "./information/information-drawer";
import { InformationFormWorkspace } from "./information/form-workspace";
import {
  InformationRequestActions,
  InformationRequests,
} from "./information/information-requests";
import type { InformationDrawerTarget } from "./information/shared";
import { RemoveButton } from "@/components/ui/remove-button";
import { LogoIcon } from "@/components/ui/logo-icon";
import { AppShellPortal } from "@/components/app-shell-slots";
import { InlineFieldCard, InlineFieldRow } from "@/components/ui/inline-fields";
import { IntakeApplicationFields } from "@/components/insurance-intake/application-fields";
import {
  coverageRequestLabel,
  COVERAGE_OPTIONS,
  detailsFromAnswers,
  newCoverage,
  type CoverageId,
  type CoverageRequest,
  type IntakeDetails,
} from "@/lib/insurance-intake-details";
import type { IntakeAnswers } from "@/lib/insurance-intake";
import { IntakeReviewCompact } from "@/components/insurance-intake/company-review";
import { IntakeApplicationReview } from "@/components/insurance-intake/application-review";
import {
  intakeQuoteSections,
  type IntakeApplication,
} from "@/lib/intake-application";
import {
  ADD_COVERAGE_SECTION,
  applicationSectionGroups,
  COVERAGE_ICONS,
  coverageSectionKey,
  OTHER_COVERAGE_SECTION,
  PROVIDER_ICONS,
  SectionMenu,
} from "@/components/insurance-intake/application-section-nav";
import {
  formatPremiumEstimate,
  type IntakePremiumEstimateValue,
} from "@/components/insurance-intake/premium-estimate";

import type { StoredProposalFinding } from "@/convex/lib/proposalReview";

import { RequestCompletionOutcome } from "./request-completion-outcome";
import { ReaderBoundary } from "@/components/inbox/reader-boundary";
import { useResolvedThreadId } from "@/components/inbox/resolve-thread-id";
import { TeamInbox } from "@/components/inbox/team-inbox";
import type { InboxThread } from "@/components/inbox/team-inbox";
import {
  ClientOutreachComposer,
  RequestEmailAudienceTabs,
  type RequestEmailAudience,
} from "./client-outreach-composer";
import { NewEmailComposer } from "@/components/inbox/new-email-composer";
import { ProviderEmailComposer } from "./provider-email-composer";
import {
  FitChips,
  OutreachSequenceActions,
  isLiveSequence,
  outreachStatusSortValue,
  ProviderContactPill,
  ProviderOutreachPanel,
  ProviderSelectionCell,
  ProviderOutreachCadence,
  SequenceState,
  followUpKey,
  followUpSortValue,
  sequenceForOutreach,
  useProviderOutreach,
} from "./provider-outreach-panel";

import {
  useCallback,
  useImperativeHandle,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import {
  FileText,
  ListChecks,
  Loader2,
  StickyNote,
  Plus,
  Link,
  Upload,
  ChevronRight,
  ArrowLeft,
  Clock3,
  SquarePen,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";

import { ClientFileUploadPanel } from "@/components/client-files/client-files-workspace";
import { usePdf } from "@/components/pdf-context";
import {
  type PacketEditorHandle,
  PacketLinkDrawer,
  PacketWorkspace,
} from "@/components/procurement/packet-workspace";
import {
  OUTREACH_STATUS_OPTIONS,
  OutreachStatusTag,
  ProcurementEmailDrawer,
  REQUEST_STATUS_OPTIONS,
  OutreachStatusLabel,
  RequestStatusLabel,
  type ProcurementEmailDrawerHandle,
  type ProcurementOutreachStatus,
  type ProcurementRequestStatus,
} from "@/components/procurement/procurement-shared";
import {
  procurementRequestPageContext,
  type ProcurementContextPart,
} from "@/components/procurement/procurement-page-context";
import { OperatorPageContextRegistration } from "@/components/operator-agent/operator-page-context";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { FileDownloadButton } from "@claritylabs-inc/ui/components/file-download-button";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { DateField } from "@claritylabs-inc/ui/components/date-field";
import { Input } from "@claritylabs-inc/ui/components/input";
import {
  OperationalItem,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
  OperationalSkeletonList,
} from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import { SearchableSelect } from "@claritylabs-inc/ui/components/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import { TableCell, TableRow } from "@/components/ui/table";
import { TabsTrigger } from "@claritylabs-inc/ui/components/tabs";
import { DrawerTabs, DrawerTabsList } from "@/components/ui/folder-tabs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useFollowedState } from "@/hooks/use-followed-state";
import {
  useCachedOperatorBrokers,
  useCachedOperatorClients,
} from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const NONE = "__none__";
const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;
const SUBMISSION_NOTES_SECTION = "Submission notes";

type PolicyOption = {
  policyId: Id<"policies">;
  label: string;
  archived: boolean;
};

type ClientFileOption = {
  _id: Id<"clientFiles">;
  name: string;
  originalName: string;
  contentType: string;
  size: number;
  url: string | null;
  uploadedBySide: "operator" | "procurement_email" | "client";
};

type RequestSummary = {
  intakeRevision?: number;
  intakeAnswers?: IntakeAnswers;
  intakeDetails?: IntakeDetails;
  application?: IntakeApplication | null;
  intakeSubmittedAt?: number;
  intakeSubmittedContentHash?: string;
  intakePremiumEstimate?: IntakePremiumEstimateValue & {
    contentHash: string;
    startedAt: number;
    provisional?: boolean;
  };
  completionOutcome?: React.ComponentProps<
    typeof RequestCompletionOutcome
  >["outcome"];
  _id: Id<"procurementRequests">;
  clientOrgId: Id<"organizations">;
  title: string;
  targetEffectiveDate?: string;
  status: ProcurementRequestStatus;
  replacingPolicyId?: Id<"policies">;
  resultingPolicyId?: Id<"policies">;
  clientVisible?: boolean;
  forwardingAddress: string;
  brokerCount: number;
  quoteCount: number;
  emailThreadCount: number;
  replacingPolicy: { policyId: Id<"policies">; label: string } | null;
  resultingPolicy: { policyId: Id<"policies">; label: string } | null;
  updatedAt: number;
};

type Outreach = {
  _id: Id<"procurementBrokerOutreaches">;
  brokerOrgId?: Id<"organizations">;
  brokerName: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  status: ProcurementOutreachStatus;
  updatedAt: number;
};

type ProcurementFileItem = {
  _id: Id<"procurementFileItems">;
  /** The provider this file came from or was prepared for. */
  providerOutreachId?: Id<"procurementBrokerOutreaches">;
  from: { name: string; receivedAt: number } | null;
  clientFileId?: Id<"clientFiles">;
  sourceEmailMessageId?: Id<"teamEmailMessages">;
  intakeCategory?: "requirements" | "policy" | "loss_runs" | "supporting";
  label: string;
  brokerRelease?: "hidden" | "listed" | "attached";
  clientVisible?: boolean;
  updatedAt: number;
  clientFile: ClientFileOption | null;
};

type EmailThread = {
  _id: Id<"teamEmailThreads">;
  subject: string;
  category: "broker" | "client" | "internal" | "mixed" | "other";
  participantEmails: string[];
  latestMessageAt: number;
  messageCount: number;
  latestFromName?: string;
  preview?: string;
  /** The provider this conversation is with. */
  providerOutreachId?: Id<"procurementBrokerOutreaches">;
};

type RequestPanel =
  | { kind: "notes" }
  | { kind: "packet-link" }
  | { kind: "outreach"; outreachId?: string; proposalId?: string }
  | {
      kind: "upload";
      documentCategory: "requirements" | "policy" | "loss_runs" | "supporting";
    }
  | { kind: "file"; fileItemId: string }
  | { kind: "image"; fileItemId: string }
  | {
      kind: "composer";
      audience: RequestEmailAudience;
      informationFormId?: Id<"procurementInformationForms">;
    }
  | { kind: "information"; target: InformationDrawerTarget }
  | {
      kind: "provider-email";
      brokerOrgIds: Id<"organizations">[];
      contacts: Record<string, Id<"brokerContacts">>;
      merge: boolean;
    };

type RequestDetails = {
  request: RequestSummary;
  outreaches: Outreach[];
  files: ProcurementFileItem[];
  emailThreads: EmailThread[];
};

const DOCUMENT_CATEGORY_LABELS = {
  requirements: "insurance requirements",
  policy: "current policies",
  loss_runs: "loss runs",
  supporting: "supporting documents",
} as const;

/** What the open request drawer shows, for the agent's page context. */
function requestPanelContext(
  panel: RequestPanel | null,
  details: RequestDetails,
  proposals: ReadonlyArray<{
    _id: string;
    outreachId: string;
    brokerName?: string;
    status: string;
    reviews: ReadonlyArray<{
      modelConclusion: keyof typeof REVIEW_CONCLUSION_LABELS;
      staffConclusion?: keyof typeof REVIEW_CONCLUSION_LABELS;
    }>;
  }>,
): ProcurementContextPart | null {
  if (!panel) return null;
  switch (panel.kind) {
    case "notes":
      return {
        text: "internal notes (private.md)",
        refs: [{ kind: "view", id: "internal_notes", label: "Internal notes" }],
      };
    case "packet-link":
      return {
        text: "provider packet link",
        refs: [
          { kind: "view", id: "packet_links", label: "Provider packet link" },
        ],
      };
    case "upload":
      return {
        text: `uploading ${DOCUMENT_CATEGORY_LABELS[panel.documentCategory]}`,
      };
    case "composer":
      return {
        text: `new ${panel.audience} email`,
        refs: panel.informationFormId
          ? [{
                kind: "procurement_information_form",
                id: panel.informationFormId,
              }]
          : undefined,
      };
    case "information":
      return panel.target.questionId
        ? {
            text: "information question",
            refs: [
              {
                kind: "procurement_information_question",
                id: panel.target.questionId,
              },
            ],
          }
        : { text: "new information question" };
    case "file":
    case "image": {
      const file = details.files.find((row) => row._id === panel.fileItemId);
      if (!file) return null;
      return {
        text: `request document "${file.label.slice(0, 120)}"`,
        refs: [
          { kind: "procurement_file_item", id: file._id, label: file.label },
          ...(file.clientFileId
            ? [{ kind: "client_file", id: file.clientFileId }]
            : []),
        ],
      };
    }
    case "outreach": {
      const outreach = details.outreaches.find(
        (row) => row._id === panel.outreachId,
      );
      if (!outreach) return { text: "adding a provider" };
      // The editor shows the linked proposal, else the outreach's active one.
      const proposal = proposals.find(
        (row) =>
          row.outreachId === outreach._id &&
          (panel.proposalId
            ? row._id === panel.proposalId
            : row.status !== "archived" && row.status !== "withdrawn"),
      );
      const outreachStatus = OUTREACH_STATUS_OPTIONS.find(
        (option) => option.value === outreach.status,
      )?.label;
      const review = proposal?.reviews[0];
      const conclusion = review?.staffConclusion ?? review?.modelConclusion;
      return {
        text: [
          `provider ${outreach.brokerName.slice(0, 80)}${outreachStatus ? ` (${outreachStatus})` : ""}`,
          proposal
            ? `${proposal.status} proposal${conclusion ? `, review ${REVIEW_CONCLUSION_LABELS[conclusion].toLowerCase()}${review?.staffConclusion ? "" : " (unconfirmed)"}` : ""}`
            : null,
        ]
          .filter(Boolean)
          .join(" with "),
        refs: [
          {
            kind: "procurement_outreach",
            id: outreach._id,
            label: outreach.brokerName,
          },
          ...(proposal
            ? [{ kind: "procurement_proposal", id: proposal._id }]
            : []),
        ],
      };
    }
    case "provider-email":
      return {
        text: `composing provider outreach to ${panel.brokerOrgIds.length} provider${panel.brokerOrgIds.length === 1 ? "" : "s"}${panel.merge ? " (mail merge)" : ""}`,
        refs: panel.brokerOrgIds
          .slice(0, 5)
          .map((id) => ({ kind: "broker", id })),
      };
  }
}

type BrokerOption = {
  _id: Id<"organizations">;
  name: string;
  iconUrl?: string | null;
  website?: string;
};

type ProposalView = {
  _id: Id<"procurementProposals">;
  brokerName?: string;
  status: string;
  extractedOffer?: unknown;
  proposalMarkdown: string;
  sectionHeadings: Record<string, string>;
  documents: Array<{
    _id: Id<"procurementProposalDocuments">;
    fileName: string;
    url?: string | null;
  }>;
  reviews: Array<{
    _id: Id<"procurementProposalReviews">;
    modelConclusion:
      | "meets_requirements"
      | "has_gaps"
      | "insufficient_evidence";
    staffConclusion?:
      | "meets_requirements"
      | "has_gaps"
      | "insufficient_evidence";
    stale: boolean;
    findings: StoredProposalFinding[];
  }>;
  extraction: {
    latest: {
      status: "pending" | "running" | "complete" | "failed";
      stuck: boolean;
      attempts: number;
      maxAttempts: number;
      lastError: string | null;
    } | null;
  };
};

function proposalExtractionState(proposal: ProposalView) {
  const latest = proposal.extraction.latest;
  if (latest?.stuck || latest?.status === "failed") return "failed";
  if (latest?.status === "pending" || latest?.status === "running") {
    return "reading";
  }
  return null;
}

function ProposalExtractionStatus({
  proposal,
  readOnly,
}: {
  proposal: ProposalView;
  readOnly: boolean;
}) {
  const retryExtraction = useMutation(api.procurementProposals.retryExtraction);
  const cancelExtraction = useMutation(
    api.procurementProposals.cancelExtraction,
  );
  const [working, setWorking] = useState(false);
  const failed = proposalExtractionState(proposal) === "failed";

  async function run() {
    setWorking(true);
    try {
      await (failed
        ? retryExtraction({ proposalId: proposal._id })
        : cancelExtraction({ proposalId: proposal._id }));
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not update the quote"),
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <StatusTag tone={failed ? "danger" : "info"}>
        {failed
          ? `Couldn't read ${proposal.documents[0]?.fileName ?? "this quote"}`
          : "Reading quote…"}
      </StatusTag>
      {!readOnly ? (
        <PillButton
          size="xs"
          variant="secondary"
          disabled={working}
          onClick={() => void run()}
        >
          {failed ? "Retry" : "Cancel"}
        </PillButton>
      ) : null}
    </div>
  );
}

const REVIEW_CONCLUSION_LABELS = {
  meets_requirements: "Meets requirements",
  has_gaps: "Has gaps",
  insufficient_evidence: "Insufficient evidence",
} as const;

function CoveragePicker({
  existing,
  onPick,
}: {
  existing: CoverageRequest[];
  onPick: (coverage: CoverageId) => void;
}) {
  const options = COVERAGE_OPTIONS.filter(
    (option) => !existing.some((line) => line.coverage === option.id),
  );
  return (
    <section aria-label="Add coverage" className="space-y-5">
      <h2 className={typeStyle("heading.item")}>Add coverage</h2>
      <InlineFieldCard>
        {options.map((option) => {
          const Icon = COVERAGE_ICONS[option.id];
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onPick(option.id)}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-foreground/4 focus-visible:bg-foreground/4 focus-visible:outline-none ${typeStyle("body.default")}`}
            >
              <Icon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span className="flex-1">{option.label}</span>
              <ChevronRight
                aria-hidden="true"
                className="size-4 text-muted-foreground/60"
              />
            </button>
          );
        })}
      </InlineFieldCard>
    </section>
  );
}

/** Accepted-application sections for read-only operators, one coverage at a time. */
function ReadOnlyApplicationSection({
  application,
  section,
  extraRows,
}: {
  application: IntakeApplication;
  section: string;
  extraRows: { label: string; value?: ReactNode }[];
}) {
  const line = application.details.coverages.find(
    (row) => coverageSectionKey(row.coverage) === section,
  );
  if (!line)
    return (
      <IntakeApplicationReview
        activeSection={
          section === OTHER_COVERAGE_SECTION ? "Coverage Requested" : section
        }
        extraRows={extraRows}
        application={application}
      />
    );
  const scoped = {
    ...application,
    details: { ...application.details, coverages: [line] },
  };
  const quote = intakeQuoteSections(scoped.details).filter(
    (title) => title !== "Follow-up answers",
  );
  return (
    <div className="space-y-8">
      <IntakeApplicationReview
        activeSection="Coverage Requested"
        application={scoped}
      />
      {quote.map((title) => (
        <section key={title} aria-label={title} className="space-y-3">
          <h2 className={typeStyle("heading.item")}>{title}</h2>
          <IntakeApplicationReview activeSection={title} application={scoped} />
        </section>
      ))}
    </div>
  );
}

function OperatorPremiumEstimate({
  request,
  readOnly,
}: {
  request: RequestSummary;
  readOnly: boolean;
}) {
  const refresh = useMutation(api.procurementRequests.refreshPremiumEstimate);
  const [busy, setBusy] = useState(false);
  const estimate = request.intakePremiumEstimate;
  const current =
    !!estimate &&
    !estimate.provisional &&
    estimate.contentHash === request.intakeSubmittedContentHash;
  const amount =
    estimate?.status === "completed"
      ? formatPremiumEstimate(estimate)
      : undefined;
  const running =
    current && (estimate.status === "pending" || estimate.status === "running");
  const action =
    readOnly || running
      ? null
      : current
        ? estimate.status === "failed"
          ? "Retry estimate"
          : null
        : estimate
          ? "Refresh estimate"
          : "Estimate premium";
  return (
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-3 px-3 py-1">
      <span className={current && amount ? "" : "text-muted-foreground"}>
        {running
          ? "Estimating…"
          : current && estimate.status === "failed"
            ? "Estimate unavailable"
            : amount
              ? `${amount} ${estimate!.currency} / month${current ? "" : " · earlier application version"}`
              : "Not estimated"}
      </span>
      {action && (
        <PillButton
          variant="secondary"
          size="default"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await refresh({
                requestId: request._id,
                expectedStartedAt: estimate?.startedAt,
              });
            } catch (error) {
              toast.error(
                getUserFacingErrorMessage(error, "Could not estimate premium"),
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {action}
        </PillButton>
      )}
    </div>
  );
}

function RequestEditorFrame({
  inline,
  embedded,
  status,
  saving,
  ...props
}: React.ComponentProps<typeof SettingsDrawer> & {
  inline?: boolean;
  embedded?: boolean;
  status: React.ComponentProps<typeof AutoSaveStatus>["status"];
  saving: boolean;
}) {
  if (embedded)
    return (
      <div data-operator-form data-operator-inline-fields className="space-y-4">
        <AutoSaveStatus status={status} />
        {props.children}
        {props.footer}
      </div>
    );
  if (!inline) return <SettingsDrawer {...props} />;
  return (
    <div data-operator-form className="space-y-5">
      <AppShellPortal slot="actions">
        <div className="flex items-center gap-2">
          <AutoSaveStatus status={status} />
          {props.footer}
          <PillButton
            variant="secondary"
            disabled={saving}
            onClick={() => props.onOpenChange(false)}
          >
            <ArrowLeft className="size-3.5" />
            Back
          </PillButton>
        </div>
      </AppShellPortal>
      <fieldset disabled={saving} className="space-y-5">
        {props.children}
      </fieldset>
    </div>
  );
}

type RequestEditorHandle = PacketEditorHandle & {
  acceptUpdatedAt: (updatedAt: number) => void;
  addCoverage: (coverage: CoverageId) => void;
  removeCoverage: (section: string) => void;
};

function RequestEditor({
  inline = false,
  embedded = false,
  activeSection,
  extraRows,
  onDraftChange,
  onSectionChange,
  onRightPanel,
  saveRef,
  readOnly = false,
  request,
  policies,
  onClose,
}: {
  inline?: boolean;
  embedded?: boolean;
  activeSection?: string;
  extraRows?: { label: string; value?: ReactNode }[];
  onDraftChange?: (draft: {
    answers: IntakeAnswers;
    details: IntakeDetails;
  }) => void;
  onSectionChange?: (section: string) => void;
  onRightPanel?: (node: ReactNode) => void;
  saveRef?: React.Ref<RequestEditorHandle>;
  readOnly?: boolean;
  request: RequestSummary;
  policies: PolicyOption[];
  onClose: () => void;
}) {
  const saveApplication = useMutation(
    api.procurementRequests.updateApplication,
  );
  const [saving, setSaving] = useState(false);
  const version = useRef({
    revision: request.intakeRevision ?? 0,
    updatedAt: request.updatedAt,
  });
  const savedAnswers: IntakeAnswers =
    request.intakeAnswers ?? request.application?.answers ?? {};
  const savedDetails: IntakeDetails =
    request.intakeDetails ??
    request.application?.details ??
    detailsFromAnswers(request.intakeAnswers ?? {});
  const source = {
    title: request.title,
    targetEffectiveDate: request.targetEffectiveDate ?? "",
    status: request.status,
    replacingPolicyId: request.replacingPolicyId ?? NONE,
    resultingPolicyId: request.resultingPolicyId ?? NONE,
    clientVisible: request.clientVisible ?? true,
    answers: inline ? savedAnswers : undefined,
    details: inline ? savedDetails : undefined,
  };
  const [answers, setAnswers] = useState(savedAnswers);
  const [intakeDetails, setIntakeDetails] = useState(savedDetails);
  const updateRequest = useMutation(api.procurementRequests.update);
  const [title, setTitle] = useState(source.title);
  const [targetEffectiveDate, setTargetEffectiveDate] = useState(
    source.targetEffectiveDate,
  );
  const [status, setStatus] = useState<ProcurementRequestStatus>(source.status);
  const [replacingPolicyId, setReplacingPolicyId] = useState(
    source.replacingPolicyId,
  );
  const [resultingPolicyId, setResultingPolicyId] = useState(
    source.resultingPolicyId,
  );
  const [clientVisible, setClientVisible] = useState(source.clientVisible);

  const policyOptions = [
    { value: NONE, label: "No policy" },
    ...policies.map((policy) => ({
      value: policy.policyId,
      label: `${policy.label}${policy.archived ? " · Archived" : ""}`,
    })),
  ];

  const values = {
    title,
    targetEffectiveDate,
    status,
    replacingPolicyId,
    resultingPolicyId,
    clientVisible,
    answers: inline ? answers : undefined,
    details: inline ? intakeDetails : undefined,
  };
  const saved = useRef(values);
  const autoSave = useLocalFirstAutoSave({
    mutationName: "procurementRequests.update",
    enabled: !readOnly,
    args: values,
    canSave: !!title.trim(),
    flush: async (next) => {
      if (inline) {
        const result = await saveApplication({
          requestId: request._id,
          expectedRevision: version.current.revision,
          expectedUpdatedAt: version.current.updatedAt,
          title: next.title,
          targetEffectiveDate: next.targetEffectiveDate || null,
          status: next.status,
          replacingPolicyId:
            next.replacingPolicyId === NONE
              ? null
              : (next.replacingPolicyId as Id<"policies">),
          resultingPolicyId:
            next.resultingPolicyId === NONE
              ? null
              : (next.resultingPolicyId as Id<"policies">),
          clientVisible: next.clientVisible,
          answers: next.answers!,
          details: next.details!,
        });
        version.current = {
          revision: result.revision,
          updatedAt: result.updatedAt,
        };
      } else
        await updateRequest({
          requestId: request._id,
          title: next.title !== saved.current.title ? next.title : undefined,
          targetEffectiveDate:
            next.targetEffectiveDate !== saved.current.targetEffectiveDate
              ? next.targetEffectiveDate || null
              : undefined,
          status:
            next.status !== saved.current.status ? next.status : undefined,
          replacingPolicyId:
            next.replacingPolicyId !== saved.current.replacingPolicyId
              ? next.replacingPolicyId === NONE
                ? null
                : (next.replacingPolicyId as Id<"policies">)
              : undefined,
          resultingPolicyId:
            next.resultingPolicyId !== saved.current.resultingPolicyId
              ? next.resultingPolicyId === NONE
                ? null
                : (next.resultingPolicyId as Id<"policies">)
              : undefined,
          clientVisible:
            next.clientVisible !== saved.current.clientVisible
              ? next.clientVisible
              : undefined,
        });
      saved.current = next;
    },
    // Edits from the Spot agent or an MCP client show up as they are saved.
    source,
    adopt: (next) => {
      setTitle(next.title);
      setTargetEffectiveDate(next.targetEffectiveDate);
      setStatus(next.status);
      setReplacingPolicyId(next.replacingPolicyId);
      setResultingPolicyId(next.resultingPolicyId);
      setClientVisible(next.clientVisible);
      if (next.answers) setAnswers(next.answers);
      if (next.details) setIntakeDetails(next.details);
      saved.current = source;
      version.current = {
        revision: request.intakeRevision ?? 0,
        updatedAt: request.updatedAt,
      };
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Could not update the request"),
  });

  // With nothing unsaved, a write elsewhere (a file or outreach change from the
  // Spot agent) is the version the next save builds on.
  const clean = autoSave.status === "saved";
  useEffect(() => {
    if (clean && request.updatedAt > version.current.updatedAt) {
      version.current = {
        revision: request.intakeRevision ?? 0,
        updatedAt: request.updatedAt,
      };
    }
  });
  useEffect(() => {
    onDraftChange?.({ answers, details: intakeDetails });
  }, [answers, intakeDetails, onDraftChange]);
  const removeCoverage = (section: string) => {
    const line = intakeDetails.coverages.find(
      (row) => coverageSectionKey(row.coverage) === section,
    );
    if (!line) return;
    const previous = intakeDetails;
    setIntakeDetails({
      ...intakeDetails,
      coverages: intakeDetails.coverages.filter((row) => row !== line),
    });
    if (section === activeSection) onSectionChange?.("Request details");
    toast.success(`${coverageRequestLabel(line)} removed`, {
      action: { label: "Undo", onClick: () => setIntakeDetails(previous) },
    });
  };
  useImperativeHandle(
    saveRef,
    () => ({
      save: autoSave.saveNow,
      acceptUpdatedAt: (updatedAt: number) => {
        version.current.updatedAt = updatedAt;
      },
      addCoverage: (coverage: CoverageId) => {
        setIntakeDetails((current) => ({
          ...current,
          coverages:
            coverage === "unknown"
              ? [newCoverage("unknown")]
              : [
                  ...current.coverages.filter(
                    (line) => line.coverage !== "unknown",
                  ),
                  newCoverage(coverage),
                ],
        }));
        onSectionChange?.(coverageSectionKey(coverage));
      },
      removeCoverage,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- removeCoverage reads the same state
    [autoSave.saveNow, intakeDetails, activeSection, onSectionChange],
  );
  const requestCard = (
    <InlineFieldCard>
      <InlineFieldRow label="Title">
        <Input
          aria-label="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </InlineFieldRow>
      <InlineFieldRow label="Target effective date">
        <DateField
          id="request-effective-date"
          label="Target effective date"
          hideLabel
          value={targetEffectiveDate}
          onChange={setTargetEffectiveDate}
        />
      </InlineFieldRow>
      <InlineFieldRow label="Status">
        <Select
          value={status}
          onValueChange={(value) =>
            setStatus(value as ProcurementRequestStatus)
          }
        >
          <SelectTrigger aria-label="Status" className="w-full">
            <SelectValue>
              <RequestStatusLabel status={status} />
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {REQUEST_STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <RequestStatusLabel status={option.value} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </InlineFieldRow>
      <InlineFieldRow label="Policy being replaced">
        <SearchableSelect
          ariaLabel="Policy being replaced"
          value={replacingPolicyId}
          options={policyOptions}
          onChange={setReplacingPolicyId}
        />
      </InlineFieldRow>
      <InlineFieldRow label="Resulting policy">
        <SearchableSelect
          ariaLabel="Resulting policy"
          value={resultingPolicyId}
          options={policyOptions}
          onChange={setResultingPolicyId}
        />
      </InlineFieldRow>
      <InlineFieldRow label="Client visibility">
        <div className="flex h-9 items-center px-3">
          <SettingsSwitch
            label="Client visibility"
            checked={clientVisible}
            onCheckedChange={() => setClientVisible(!clientVisible)}
          />
        </div>
      </InlineFieldRow>
    </InlineFieldCard>
  );
  return (
    <RequestEditorFrame
      inline={inline}
      embedded={embedded}
      saving={saving}
      status={autoSave.status}
      open
      onOpenChange={(open) => {
        if (!open) {
          setSaving(true);
          void autoSave
            .saveNow()
            .then((saved) => {
              if (saved) onClose();
            })
            .finally(() => setSaving(false));
        }
      }}
      title="Edit request"
    >
      <AutoSaveStatus status={autoSave.status} />
      {!embedded && requestCard}
      {inline ? (
        <fieldset
          disabled={readOnly}
          onBlur={() => {
            if (!readOnly) void autoSave.saveNow();
          }}
        >
          <IntakeApplicationFields
            activeSection={activeSection}
            onRemoveCoverage={removeCoverage}
            onRightPanel={onRightPanel}
            requestCard={embedded ? requestCard : undefined}
            companyGroup={embedded}
            extraRows={extraRows}
            answers={answers}
            details={intakeDetails}
            onAnswersChange={setAnswers}
            onDetailsChange={setIntakeDetails}
          />
        </fieldset>
      ) : null}
    </RequestEditorFrame>
  );
}

/** Signature and inline images that email clients attach to every message. */
const EMAIL_INLINE_IMAGE = /^(inline-image-\d+|image\d*)\.(png|jpe?g|gif)$/i;

/** One of the provider's files: open it, rename it in place or remove it from the request. */
function ProviderFileRow({
  file,
  readOnly,
  removing,
  onOpen,
  onRemove,
}: {
  file: ProcurementFileItem & { clientFile: ClientFileOption };
  readOnly: boolean;
  removing: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const updateFileItem = useMutation(api.procurementRequests.updateFileItem);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(file.label);

  async function rename() {
    setRenaming(false);
    const label = draft.trim();
    if (!label || label === file.label) return setDraft(file.label);
    try {
      await updateFileItem({ fileItemId: file._id, label });
    } catch (error) {
      setDraft(file.label);
      toast.error(getUserFacingErrorMessage(error, "Could not rename the file"));
    }
  }

  return (
    <li className="flex min-h-11 items-center gap-2 py-1.5">
      <div className="min-w-0 flex-1">
        {renaming ? (
          <Input
            autoFocus
            aria-label="File name"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void rename()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setDraft(file.label);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            onClick={onOpen}
            className="block w-full text-left break-words underline underline-offset-2 hover:text-foreground"
          >
            {file.label}
          </button>
        )}
        <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
          {file.from
            ? `${file.from.name} · ${dayjs(file.from.receivedAt).format("MMM D")}`
            : `Prepared · ${dayjs(file.updatedAt).format("MMM D")}`}
        </p>
      </div>
      {!readOnly && !renaming ? (
        <PillButton
          variant="icon"
          size="compact"
          iconOnly
          label={`Rename ${file.label}`}
          onClick={() => {
            setDraft(file.label);
            setRenaming(true);
          }}
        >
          <Pencil />
        </PillButton>
      ) : null}
      {!readOnly ? (
        <RemoveButton
          label={`Remove ${file.label}`}
          busy={removing}
          disabled={removing}
          onClick={onRemove}
        />
      ) : null}
    </li>
  );
}

/**
 * One provider on the request: Details (provider, contact, status), Threads
 * (its outreach and other mail) and Files (what it sent and what was
 * prepared for it).
 */
function OutreachEditor({
  requestId,
  outreach,
  brokers,
  files,
  emailThreads,
  hasProposal,
  removingFileId,
  onOpenFile,
  onRemoveFile,
  onOpenThread,
  readOnly = false,
  onClose,
}: {
  requestId: Id<"procurementRequests">;
  outreach?: Outreach;
  brokers: BrokerOption[];
  /** The request's files and conversations; the drawer shows this provider's. */
  files: ProcurementFileItem[];
  emailThreads: EmailThread[];
  /** A provider with a proposal keeps its organization. */
  hasProposal: boolean;
  removingFileId: string | null;
  onOpenFile: (file: ClientFileOption) => void;
  onRemoveFile: (fileItemId: Id<"procurementFileItems">) => void;
  onOpenThread: (threadId: Id<"teamEmailThreads">) => void;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const createOutreach = useMutation(api.procurementRequests.createOutreach);
  const updateOutreach = useMutation(api.procurementRequests.updateOutreach);
  const stopFollowUps = useMutation(api.providerOutreach.stop);
  const outreachPanel = useQuery(
    api.providerOutreach.getPanel,
    readOnly ? "skip" : { requestId },
  );
  const [outreachId, setOutreachId] = useState(outreach?._id);
  const currentRequest = useQuery(
    api.procurementRequests.get,
    outreachId ? { requestId } : "skip",
  );
  const currentOutreach =
    currentRequest?.outreaches.find((row) => row._id === outreachId) ??
    outreach;
  const sequence = outreachId
    ? sequenceForOutreach(outreachPanel?.sequences, outreachId)
    : null;
  const [tab, setTab] = useFollowedState(
    `procurement:${requestId}:provider-tab`,
    "details",
  );
  const shownTab = outreachId ? tab : "details";
  const providerName = currentOutreach?.brokerName ?? "this provider";
  const providerFiles = files
    .filter(
      (file): file is ProcurementFileItem & { clientFile: ClientFileOption } =>
        file.providerOutreachId === outreachId &&
        !!file.clientFile &&
        !EMAIL_INLINE_IMAGE.test(file.clientFile.name),
    )
    .sort(
      (a, b) =>
        (b.from?.receivedAt ?? b.updatedAt) - (a.from?.receivedAt ?? a.updatedAt),
    );
  const threads = emailThreads.filter(
    (thread) => thread.providerOutreachId === outreachId,
  );
  const [brokerOrgId, setBrokerOrgId] = useState(outreach?.brokerOrgId ?? "");
  const [contactName, setContactName] = useState(outreach?.contactName ?? "");
  const [contactEmail, setContactEmail] = useState(
    outreach?.contactEmail ?? "",
  );
  const [contactPhone, setContactPhone] = useState(
    outreach?.contactPhone ?? "",
  );
  const [statusDraft, setStatus] = useState<ProcurementOutreachStatus>();
  const status = statusDraft ?? currentOutreach?.status ?? "request_sent";
  const savedOutreach =
    outreachId && currentOutreach
      ? {
          brokerOrgId: currentOutreach.brokerOrgId ?? "",
          contactName: currentOutreach.contactName ?? "",
          contactEmail: currentOutreach.contactEmail ?? "",
          contactPhone: currentOutreach.contactPhone ?? "",
        }
      : undefined;
  const savedValues = useRef({
    brokerOrgId,
    contactName,
    contactEmail,
    contactPhone,
  });
  const [saving, setSaving] = useState(false);
  const [working, setWorking] = useState(false);
  const busy = saving || working;

  const autoSave = useLocalFirstAutoSave({
    mutationName: "procurementRequests.updateOutreach",
    args: {
      brokerOrgId,
      contactName,
      contactEmail,
      contactPhone,
      statusDraft,
    },
    enabled: !readOnly,
    canSave: !!outreachId && !!brokerOrgId,
    flush: async (next) => {
      if (!outreachId) return;
      const previous = savedValues.current;
      if (
        next.statusDraft === undefined &&
        Object.keys(previous).every(
          (key) =>
            next[key as keyof typeof previous] ===
            previous[key as keyof typeof previous],
        )
      )
        return;
      await updateOutreach({
        outreachId,
        brokerOrgId:
          next.brokerOrgId !== previous.brokerOrgId
            ? (next.brokerOrgId as Id<"organizations">)
            : undefined,
        status: next.statusDraft,
        contactName:
          next.contactName !== previous.contactName
            ? next.contactName || null
            : undefined,
        contactEmail:
          next.contactEmail !== previous.contactEmail
            ? next.contactEmail || null
            : undefined,
        contactPhone:
          next.contactPhone !== previous.contactPhone
            ? next.contactPhone || null
            : undefined,
      });
      savedValues.current = {
        brokerOrgId: next.brokerOrgId,
        contactName: next.contactName,
        contactEmail: next.contactEmail,
        contactPhone: next.contactPhone,
      };
    },
    // Edits from the Spot agent or an MCP client show up as they are saved.
    source: savedOutreach && {
      ...savedOutreach,
      statusDraft: undefined,
    },
    adopt: (next) => {
      setBrokerOrgId(next.brokerOrgId);
      setContactName(next.contactName);
      setContactEmail(next.contactEmail);
      setContactPhone(next.contactPhone);
      if (savedOutreach) savedValues.current = savedOutreach;
    },
    onFlushed: (_, next) =>
      setStatus((current) =>
        current === next.statusDraft ? undefined : current,
      ),
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Could not update provider details"),
  });

  async function addBroker() {
    if (readOnly || busy || !brokerOrgId) return;
    setSaving(true);
    try {
      const created = await createOutreach({
        requestId,
        brokerOrgId: brokerOrgId as Id<"organizations">,
        contactName: contactName || undefined,
        contactEmail: contactEmail || undefined,
        contactPhone: contactPhone || undefined,
        status,
      });
      savedValues.current = {
        brokerOrgId,
        contactName,
        contactEmail,
        contactPhone,
      };
      setOutreachId(created.outreachId);
      setStatus(undefined);
      toast.success("Provider added");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not add provider"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open && !busy) {
          if (!outreachId || readOnly) onClose();
          else
            void autoSave.saveNow().then((saved) => {
              if (saved) onClose();
            });
        }
      }}
      title={outreachId ? providerName : "Add provider"}
      tabs={
        outreachId ? (
          <DrawerTabs value={tab} onValueChange={setTab}>
            <DrawerTabsList aria-label={providerName}>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="threads">Threads</TabsTrigger>
              <TabsTrigger value="files">Files</TabsTrigger>
            </DrawerTabsList>
          </DrawerTabs>
        ) : undefined
      }
      footer={
        !outreachId && !readOnly ? (
          <PillButton
            type="button"
            onClick={() => void addBroker()}
            disabled={busy || !brokerOrgId}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Add provider
          </PillButton>
        ) : undefined
      }
    >
      {shownTab === "details" ? (
        <>
          <AutoSaveStatus status={outreachId ? autoSave.status : "saved"} />
          <fieldset disabled={readOnly || busy} className="min-w-0 space-y-4">
            {!hasProposal ? (
              <label className="block space-y-1.5">
                <span
                  className={`text-muted-foreground ${typeStyle("caption.default")}`}
                >
                  Provider
                </span>
                <SearchableSelect
                  value={brokerOrgId}
                  onChange={setBrokerOrgId}
                  options={brokers.map((broker) => ({
                    value: broker._id,
                    label: broker.name,
                    icon: (
                      <OrgBrandIcon
                        name={broker.name}
                        iconUrl={broker.iconUrl}
                        size="xs"
                      />
                    ),
                  }))}
                />
              </label>
            ) : null}
            <label className="block space-y-1.5">
              <span
                className={`text-muted-foreground ${typeStyle("label.field")}`}
              >
                Contact name
              </span>
              <Input
                value={contactName}
                onChange={(event) => setContactName(event.target.value)}
                placeholder="Contact name"
              />
            </label>
            <label className="block space-y-1.5">
              <span
                className={`text-muted-foreground ${typeStyle("label.field")}`}
              >
                Contact email
              </span>
              <Input
                type="email"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                placeholder="Contact email"
              />
            </label>
            <label className="block space-y-1.5">
              <span
                className={`text-muted-foreground ${typeStyle("label.field")}`}
              >
                Contact phone
              </span>
              <Input
                value={contactPhone}
                onChange={(event) => setContactPhone(event.target.value)}
                placeholder="Contact phone"
              />
            </label>
            <label className="block space-y-1.5">
              <span
                className={`text-muted-foreground ${typeStyle("label.field")}`}
              >
                Status
              </span>
              <Select
                value={status}
                onValueChange={(value) =>
                  setStatus(value as ProcurementOutreachStatus)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    <OutreachStatusLabel status={status} />
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {OUTREACH_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <OutreachStatusLabel status={option.value} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </fieldset>
        </>
      ) : null}
      {shownTab === "threads" ? (
        <div className="space-y-3">
          {sequence ? (
            <div className="flex items-center gap-2">
              <span
                className={`text-muted-foreground ${typeStyle("caption.default")}`}
              >
                Follow-ups
              </span>
              <SequenceState sequence={sequence} />
              {!readOnly && isLiveSequence(sequence) ? (
                <PillButton
                  type="button"
                  size="compact"
                  variant="ghost"
                  className="ml-auto"
                  disabled={working}
                  onClick={() => {
                    setWorking(true);
                    void stopFollowUps({ sequenceId: sequence.sequenceId })
                      .then(() => toast.success("Follow-ups stopped"))
                      .catch((error) =>
                        toast.error(
                          getUserFacingErrorMessage(
                            error,
                            "Could not stop follow-ups",
                          ),
                        ),
                      )
                      .finally(() => setWorking(false));
                  }}
                >
                  Stop follow-ups
                </PillButton>
              ) : null}
            </div>
          ) : null}
          {threads.length ? (
            <ul className="divide-y divide-border">
              {threads.map((thread) => (
                <li key={thread._id}>
                  <button
                    type="button"
                    onClick={() => onOpenThread(thread._id)}
                    className="block w-full py-2 text-left hover:text-foreground"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className={`min-w-0 truncate ${typeStyle("body.medium")}`}>
                        {thread.subject || "(no subject)"}
                      </span>
                      <span
                        className={`shrink-0 text-muted-foreground ${typeStyle("caption.default")}`}
                      >
                        {dayjs(thread.latestMessageAt).format("MMM D")}
                      </span>
                    </span>
                    <span
                      className={`block truncate text-muted-foreground ${typeStyle("caption.default")}`}
                    >
                      {[thread.latestFromName, thread.preview]
                        .filter(Boolean)
                        .join(": ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              No email with {providerName} yet.
            </p>
          )}
        </div>
      ) : null}
      {shownTab === "files" ? (
        providerFiles.length ? (
          <ul className="divide-y divide-border">
            {providerFiles.map((file) => (
              <ProviderFileRow
                key={file._id}
                file={file}
                readOnly={readOnly}
                removing={removingFileId === file._id}
                onOpen={() => onOpenFile(file.clientFile)}
                onRemove={() => onRemoveFile(file._id)}
              />
            ))}
          </ul>
        ) : (
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            No files from {providerName} yet.
          </p>
        )
      ) : null}
    </SettingsDrawer>
  );
}

function ProcurementFileEditor({
  fileItem,
  onClose,
  onPreview,
  readOnly,
}: {
  fileItem: ProcurementFileItem;
  onClose: () => void;
  onPreview: (file: ClientFileOption) => void;
  readOnly: boolean;
}) {
  const updateFileItem = useMutation(api.procurementRequests.updateFileItem);
  const source = {
    label: fileItem.label,
    brokerRelease: fileItem.brokerRelease ?? "hidden",
    clientVisible: fileItem.clientVisible ?? false,
  };
  const [label, setLabel] = useState(source.label);
  const [brokerRelease, setBrokerRelease] = useState(source.brokerRelease);
  const [clientVisible, setClientVisible] = useState(source.clientVisible);

  const values = {
    label,
    brokerRelease,
    clientVisible,
  };
  const saved = useRef(values);
  const autoSave = useLocalFirstAutoSave({
    mutationName: "procurementRequests.updateFileItem",
    args: values,
    enabled: !readOnly,
    canSave: !!label.trim(),
    flush: async (next) => {
      const previous = saved.current;
      if (
        Object.keys(previous).every(
          (key) =>
            next[key as keyof typeof previous] ===
            previous[key as keyof typeof previous],
        )
      )
        return;
      await updateFileItem({
        fileItemId: fileItem._id,
        label: next.label !== previous.label ? next.label : undefined,
        brokerRelease:
          next.brokerRelease !== previous.brokerRelease
            ? next.brokerRelease
            : undefined,
        clientVisible:
          next.clientVisible !== previous.clientVisible
            ? next.clientVisible
            : undefined,
      });
      saved.current = next;
    },
    // Edits from the Spot agent or an MCP client show up as they are saved.
    source,
    adopt: (next) => {
      setLabel(next.label);
      setBrokerRelease(next.brokerRelease);
      setClientVisible(next.clientVisible);
      saved.current = source;
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Could not update the file"),
  });

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open) {
          if (readOnly) onClose();
          else
            void autoSave.saveNow().then((saved) => {
              if (saved) onClose();
            });
        }
      }}
      title="Edit procurement file"
      footer={
        <>
          {fileItem.clientFile?.url ? (
            <>
              {/pdf|image/.test(fileItem.clientFile.contentType) ||
              /\.(pdf|avif|gif|jpe?g|png|webp)$/i.test(
                fileItem.clientFile.name,
              ) ? (
                <PillButton
                  variant="secondary"
                  onClick={() => {
                    void autoSave.saveNow().then((saved) => {
                      if (saved || readOnly) onPreview(fileItem.clientFile!);
                    });
                  }}
                >
                  Preview
                </PillButton>
              ) : null}
              <FileDownloadButton
                href={fileItem.clientFile.url}
                fileName={fileItem.clientFile.name}
              />
            </>
          ) : null}
        </>
      }
    >
      <AutoSaveStatus status={autoSave.status} />
      <fieldset disabled={readOnly} className="min-w-0 space-y-5">
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Label
          </span>
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Roof condition report"
          />
        </label>
        <div className="space-y-1.5">
          <p className={`text-muted-foreground ${typeStyle("label.field")}`}>
            Sharing
          </p>
          <OperationalPanel aria-label="File sharing">
            <OperationalItem className="flex items-center justify-between gap-4">
              <span className={typeStyle("body.default")}>
                Client visibility
              </span>
              <SettingsSwitch
                label="Client visibility"
                checked={clientVisible}
                disabled={readOnly}
                onCheckedChange={() => setClientVisible(!clientVisible)}
              />
            </OperationalItem>
            <OperationalItem className="flex items-center justify-between gap-4">
              <span className={typeStyle("body.default")}>
                Provider visibility
              </span>
              <SettingsSwitch
                label="Provider visibility"
                checked={brokerRelease !== "hidden"}
                disabled={readOnly}
                onCheckedChange={() =>
                  setBrokerRelease(
                    brokerRelease === "hidden" ? "attached" : "hidden",
                  )
                }
              />
            </OperationalItem>
          </OperationalPanel>
        </div>
      </fieldset>
    </SettingsDrawer>
  );
}

function ImagePreview({
  file,
  onClose,
}: {
  file: ClientFileOption;
  onClose: () => void;
}) {
  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={file.name}
      footer={
        file.url ? (
          <FileDownloadButton href={file.url} fileName={file.name} />
        ) : null
      }
    >
      {file.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={file.url}
          alt={file.name}
          className="h-auto max-h-[calc(100vh-11rem)] w-auto max-w-full object-contain"
        />
      ) : null}
    </SettingsDrawer>
  );
}

export function ProcurementRequestWorkspace({
  clientOrgId,
  requestId,
  basePath,
  view,
  readOnly,
  onActions,
  onRightPanel: setRightPanel,
  sidebarFooter,
}: {
  clientOrgId: Id<"organizations">;
  requestId: Id<"procurementRequests">;
  basePath: string;
  view:
    | "application"
    | "edit"
    | "proposals"
    | "cadence"
    | "files"
    | "email"
    | "information";
  readOnly: boolean;
  onActions?: (node: ReactNode) => void;
  onRightPanel: (node: ReactNode) => void;
  sidebarFooter?: (collapsed: boolean) => ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedProposalId = searchParams.get("proposal");
  const selectedInformationForm =
    view === "information" ? searchParams.get("form") : null;
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const handledProposalLink = useRef<string | null>(null);
  // The email in the right panel, and the one being opened. Any other panel
  // replaces it, which clears the first.
  const openedEmailId = useRef<string | null>(null);
  const openingEmailId = useRef<string | null>(null);
  const [panel, setPanel] = useFollowedState<RequestPanel | null>(
    `procurement:${requestId}:panel`,
    null,
  );
  const shownPanel = useRef<RequestPanel | null>(null);
  const composerDraft = useRef<{ text?: string; title?: string }>({});
  const showPanel = useCallback(
    (node: ReactNode) => {
      openedEmailId.current = null;
      setRightPanelOpen(node !== null);
      setRightPanel(node);
    },
    [setRightPanel],
  );
  // Panels that are not driven by `panel` replace it.
  const onRightPanel = useCallback(
    (node: ReactNode) => {
      shownPanel.current = null;
      setPanel(null);
      showPanel(node);
    },
    [setPanel, showPanel],
  );
  const [applicationSection, setApplicationSection] = useFollowedState(
    `procurement:${requestId}:application-section`,
    "Contact details",
  );
  const result = useQuery(api.procurementRequests.get, { requestId });
  const policies = useQuery(api.procurementRequests.listPolicyOptions, {
    clientOrgId,
  });
  const policyRows = useQuery(api.policies.listForOrg, {
    orgId: clientOrgId,
    documentType: "policy",
  });
  const brokers = useCachedOperatorBrokers() as BrokerOption[] | undefined;
  const clients = useCachedOperatorClients();
  const proposals = useQuery(api.procurementProposals.list, { requestId });
  const informationForms = useQuery(api.procurementInformation.operatorForms, {
    requestId,
  });
  const providerOutreach = useProviderOutreach(requestId, readOnly, (target) =>
    setPanel({ kind: "provider-email", ...target }),
  );
  // The header actions depend on primitives only; handlers read the latest controller.
  const providerOutreachRef = useRef(providerOutreach);
  useEffect(() => {
    providerOutreachRef.current = providerOutreach;
  });
  const createFileItem = useMutation(api.procurementRequests.createFileItem);
  const packetEditorRef = useRef<PacketEditorHandle>(null);
  const submissionNotesRef = useRef<PacketEditorHandle>(null);
  const latestTabChange = useRef(0);
  const removeFileItem = useMutation(api.procurementRequests.removeFileItem);
  const [removingFileId, setRemovingFileId] = useState<string | null>(null);
  const requestEditorRef = useRef<RequestEditorHandle>(null);
  const [draft, setDraft] = useState<{
    answers: IntakeAnswers;
    details: IntakeDetails;
  } | null>(null);
  const handleRemoveFile = useCallback(
    async (fileItemId: Id<"procurementFileItems">) => {
      if (requestEditorRef.current && !(await requestEditorRef.current.save()))
        return;
      setRemovingFileId(fileItemId);
      try {
        const result = await removeFileItem({
          fileItemId: fileItemId,
        });
        requestEditorRef.current?.acceptUpdatedAt(result.updatedAt);
        toast.success("Document removed from request");
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(error, "Could not remove document"),
        );
      } finally {
        setRemovingFileId(null);
      }
    },
    [removeFileItem],
  );
  const changeView = async (
    nextView: string,
    threadId?: string,
    informationFormId?: string,
  ) => {
    const change = ++latestTabChange.current;
    if (requestEditorRef.current && !(await requestEditorRef.current.save()))
      return;
    if (packetEditorRef.current && !(await packetEditorRef.current.save()))
      return;
    if (emailDrawerRef.current && !(await emailDrawerRef.current.save()))
      return;
    if (
      submissionNotesRef.current &&
      !(await submissionNotesRef.current.save())
    )
      return;
    if (change !== latestTabChange.current) return;
    closeRightPanel();
    router.push(
      `${basePath}/${requestId}?view=${nextView}${threadId ? `&thread=${threadId}` : ""}${informationFormId ? `&form=${encodeURIComponent(informationFormId)}` : ""}`,
    );
  };
  const { openWithUrl } = usePdf();

  const details = result as RequestDetails | null | undefined;
  const policyOptions = useMemo(
    () => (policies ?? []) as PolicyOption[],
    [policies],
  );
  const closeRightPanel = useCallback(() => onRightPanel(null), [onRightPanel]);
  const openNotes = useCallback(async () => {
    if (packetEditorRef.current && !(await packetEditorRef.current.save()))
      return;
    setPanel({ kind: "notes" });
  }, [setPanel]);

  const openPacketLink = useCallback(async () => {
    if (packetEditorRef.current && !(await packetEditorRef.current.save()))
      return;
    if (
      submissionNotesRef.current &&
      !(await submissionNotesRef.current.save())
    )
      return;
    setPanel({ kind: "packet-link" });
  }, [setPanel]);

  const openOutreachEditor = useCallback(
    (outreach?: Outreach, proposalId?: Id<"procurementProposals">) => {
      setPanel({ kind: "outreach", outreachId: outreach?._id, proposalId });
    },
    [setPanel],
  );

  useEffect(() => {
    const linkKey = requestedProposalId
      ? `${requestId}:${requestedProposalId}`
      : null;
    if (!linkKey) {
      handledProposalLink.current = null;
      return;
    }
    if (
      handledProposalLink.current === linkKey ||
      rightPanelOpen ||
      proposals === undefined ||
      !details ||
      details.request.clientOrgId !== clientOrgId
    )
      return;
    handledProposalLink.current = linkKey;
    const proposal = proposals.find((row) => row._id === requestedProposalId);
    const outreach = details.outreaches.find(
      (row) => row._id === proposal?.outreachId,
    );
    if (!proposal || !outreach) {
      toast.error("This proposal is not available for this request.");
      return;
    }
    // Route navigation synchronizes the externally owned app-shell drawer.
    openOutreachEditor(outreach, proposal._id);
  }, [
    clientOrgId,
    details,
    openOutreachEditor,
    proposals,
    requestId,
    requestedProposalId,
    rightPanelOpen,
  ]);

  const openUpload = useCallback(
    (
      documentCategory:
        | "requirements"
        | "policy"
        | "loss_runs"
        | "supporting" = applicationSection === "Insurance history"
        ? "policy"
        : "supporting",
    ) => {
      setPanel({ kind: "upload", documentCategory });
    },
    [setPanel, applicationSection],
  );

  const openFileEditor = useCallback(
    (fileItem: ProcurementFileItem) => {
      if (!details) return;
      setPanel({ kind: "file", fileItemId: fileItem._id });
    },
    [details, setPanel],
  );

  const emailDrawerRef = useRef<ProcurementEmailDrawerHandle>(null);
  const closeEmail = useCallback(() => {
    closeRightPanel();
    router.replace(`${basePath}/${requestId}?view=email`, { scroll: false });
  }, [closeRightPanel, router, basePath, requestId]);
  const openEmail = useCallback(
    async (
      thread: {
        _id: Id<"teamEmailThreads">;
        subject?: string;
        source?: InboxThread["source"];
      },
      onClose: () => void = closeEmail,
    ) => {
      if (
        openedEmailId.current === thread._id ||
        openingEmailId.current === thread._id
      )
        return;
      openingEmailId.current = thread._id;
      try {
        if (emailDrawerRef.current && !(await emailDrawerRef.current.save()))
          return;
        onRightPanel(
          <ReaderBoundary resetKey={thread._id} onClose={onClose}>
            <ProcurementEmailDrawer
              ref={emailDrawerRef}
              emailThreadId={thread._id}
              subject={thread.subject}
              replyable={thread.source === "outreach"}
              requestId={requestId}
              includeArchived
              readOnly={readOnly}
              onClose={onClose}
            />
          </ReaderBoundary>,
        );
        openedEmailId.current = thread._id;
      } finally {
        openingEmailId.current = null;
      }
    },
    [closeEmail, onRightPanel, readOnly, requestId],
  );

  // The reader opens from the URL on its own, so a saved link works whether or
  // not the conversation is in the loaded page. Legacy ids move to the current
  // one; an unavailable id is reported once and cleared.
  const threadParam = view === "email" ? searchParams.get("thread") : null;
  const resolvedThread = useResolvedThreadId(threadParam, requestId);
  const handledThread = useRef<string | null>(null);
  useEffect(() => {
    if (resolvedThread.status === "none") handledThread.current = null;
    if (
      resolvedThread.status === "unavailable" &&
      handledThread.current !== threadParam
    ) {
      handledThread.current = threadParam;
      toast.error("That conversation is not available");
      router.replace(`${basePath}/${requestId}?view=email`, { scroll: false });
    }
    if (resolvedThread.status !== "ready") return;
    const id = resolvedThread.threadId;
    if (handledThread.current === id) return;
    handledThread.current = id;
    if (resolvedThread.redirected)
      router.replace(`${basePath}/${requestId}?view=email&thread=${id}`, {
        scroll: false,
      });
    void openEmail({ _id: id });
  }, [resolvedThread, threadParam, openEmail, router, basePath, requestId]);

  const requestTitle = details?.request.title ?? "";
  const openClientComposer = useCallback(
    async (
      initialText?: string,
      informationFormId?: Id<"procurementInformationForms">,
      informationFormTitle?: string,
    ) => {
      if (emailDrawerRef.current && !(await emailDrawerRef.current.save()))
        return;
      // The prefilled draft stays with the leader; followers only see which form is open.
      composerDraft.current = {
        text: initialText,
        title: informationFormTitle,
      };
      router.replace(
        `${basePath}/${requestId}?view=${informationFormId ? `information&form=${informationFormId}` : "email"}`,
        { scroll: false },
      );
      setPanel({ kind: "composer", audience: "client", informationFormId });
    },
    [basePath, requestId, router, setPanel],
  );

  useEffect(() => {
    if (!panel) {
      if (shownPanel.current) {
        shownPanel.current = null;
        showPanel(null);
      }
      return;
    }
    let node: ReactNode = null;
    if (panel.kind === "notes") {
      const close = async () => {
        if (packetEditorRef.current && !(await packetEditorRef.current.save()))
          return;
        closeRightPanel();
      };
      node = (
        <SettingsDrawer
          open
          title="Internal notes"
          onOpenChange={(open) => {
            if (!open) void close();
          }}
        >
          <PacketWorkspace
            key={requestId}
            ref={packetEditorRef}
            readOnly={readOnly}
            requestId={requestId}
            filename="private.md"
            inlineNotes="sidebar"
          />
        </SettingsDrawer>
      );
    } else if (panel.kind === "packet-link") {
      node = (
        <PacketLinkDrawer
          requestId={requestId}
          onClose={closeRightPanel}
          beforeRegenerate={() =>
            submissionNotesRef.current?.save() ?? Promise.resolve(true)
          }
        />
      );
    } else if (panel.kind === "outreach") {
      const { proposalId } = panel;
      const outreach = details?.outreaches.find(
        (row) => row._id === panel.outreachId,
      );
      if (!panel.outreachId || outreach)
        node = (
          <OutreachEditor
            key={outreach?._id ?? "new-outreach"}
            requestId={requestId}
            outreach={outreach}
            readOnly={readOnly}
            brokers={brokers ?? []}
            files={details?.files ?? []}
            emailThreads={details?.emailThreads ?? []}
            hasProposal={
              !!outreach &&
              !!proposals?.some((row) => row.outreachId === outreach._id)
            }
            removingFileId={removingFileId}
            onRemoveFile={(fileItemId) => void handleRemoveFile(fileItemId)}
            onOpenThread={(threadId) =>
              void openEmail(
                { _id: threadId, source: "outreach" },
                closeRightPanel,
              )
            }
            onOpenFile={(file) => {
              if (!file.url) return;
              if (
                file.contentType === "application/pdf" ||
                /\.pdf$/i.test(file.name)
              ) {
                // The PDF opens beside the provider drawer.
                openWithUrl(file.url, undefined, undefined, {
                  kind: "clientFile",
                  clientFileId: file._id,
                  filename: file.name,
                });
              } else window.open(file.url, "_blank", "noopener");
            }}
            onClose={() => {
              const url = new URL(window.location.href);
              if (
                proposalId &&
                url.pathname === `${basePath}/${requestId}` &&
                url.searchParams.get("proposal") === proposalId
              ) {
                url.searchParams.delete("proposal");
                router.replace(`${url.pathname}${url.search}${url.hash}`, {
                  scroll: false,
                });
              }
              closeRightPanel();
            }}
          />
        );
    } else if (panel.kind === "upload") {
      node = (
        <ClientFileUploadPanel
          clientOrgId={clientOrgId}
          showBrokerVisibility
          onClose={closeRightPanel}
          onUploaded={async (uploaded, visibility) => {
            await Promise.all(
              uploaded.map((file) =>
                createFileItem({
                  requestId,
                  clientFileId: file.clientFileId,
                  label: file.originalName,
                  documentCategory: panel.documentCategory,
                  clientVisible: visibility.clientVisible,
                  brokerRelease: visibility.brokerVisible
                    ? "attached"
                    : "hidden",
                }),
              ),
            );
          }}
        />
      );
    } else if (panel.kind === "file") {
      const fileItem = details?.files.find(
        (file) => file._id === panel.fileItemId,
      );
      if (fileItem)
        node = (
          <ProcurementFileEditor
            key={fileItem._id}
            fileItem={fileItem}
            readOnly={readOnly}
            onPreview={(file) => {
              if (!file.url) return;
              if (
                file.contentType === "application/pdf" ||
                /\.pdf$/i.test(file.name)
              ) {
                openWithUrl(file.url, undefined, undefined, {
                  kind: "clientFile",
                  clientFileId: file._id,
                  filename: file.name,
                });
              } else {
                setPanel({ kind: "image", fileItemId: fileItem._id });
              }
            }}
            onClose={closeRightPanel}
          />
        );
    } else if (panel.kind === "information") {
      node = (
        <InformationDrawer
          key={JSON.stringify(panel.target)}
          requestId={requestId}
          target={panel.target}
          onClose={closeRightPanel}
        />
      );
    } else if (panel.kind === "provider-email") {
      node = (
        <ProviderEmailComposer
          key={`${panel.merge ? "merge" : "single"}:${panel.brokerOrgIds.join(",")}`}
          requestId={requestId}
          requestTitle={requestTitle}
          target={panel}
          onClose={closeRightPanel}
        />
      );
    } else if (panel.kind === "image") {
      const file = details?.files.find(
        (row) => row._id === panel.fileItemId,
      )?.clientFile;
      if (file?.url)
        node = <ImagePreview file={file} onClose={closeRightPanel} />;
    } else {
      const audienceTabs = (
        <RequestEmailAudienceTabs
          value={panel.audience}
          onChange={(audience) => setPanel({ kind: "composer", audience })}
        />
      );
      node =
        panel.audience === "provider" ? (
          details ? (
            <NewEmailComposer
              key="provider-composer"
              request={{ requestId, clientOrgId, title: requestTitle }}
              header={audienceTabs}
              onClose={closeRightPanel}
              onSent={closeRightPanel}
            />
          ) : null
        ) : (
          <ClientOutreachComposer
            key={panel.informationFormId ?? requestId}
            informationFormId={panel.informationFormId}
            requestId={requestId}
            requestTitle={composerDraft.current.title ?? requestTitle}
            initialText={composerDraft.current.text}
            header={audienceTabs}
            onClose={closeRightPanel}
            onSent={closeRightPanel}
          />
        );
    }
    if (!node) {
      // The record is gone (or another request loaded): drop its stale panel.
      if (details !== undefined && shownPanel.current) {
        shownPanel.current = null;
        showPanel(null);
      }
      return;
    }
    shownPanel.current = panel;
    showPanel(node);
  }, [
    basePath,
    brokers,
    clientOrgId,
    closeRightPanel,
    createFileItem,
    details,
    handleRemoveFile,
    onRightPanel,
    openEmail,
    openWithUrl,
    panel,
    proposals,
    readOnly,
    removingFileId,
    requestId,
    requestTitle,
    router,
    setPanel,
    showPanel,
  ]);

  const openInformationDrawer = useCallback(
    (target: InformationDrawerTarget) => {
      setPanel({ kind: "information", target });
    },
    [setPanel],
  );

  const askClientForInformation = useCallback(
    (
      formId: Id<"procurementInformationForms">,
      questions: string[],
      title?: string,
    ) => {
      const questionList = questions
        .map((question, index) => `${index + 1}. ${question}`)
        .join("\n\n");
      void openClientComposer(
        `We need a few more details to continue obtaining your insurance quotes. You can reply to this email with your answers or complete the short form below.\n\n${questionList.length <= 6500 ? `${questionList}\n\n` : ""}Complete the form: ${window.location.origin}/intake/information/${formId}`,
        formId,
        title,
      );
    },
    [openClientComposer],
  );

  // The Inbox keeps its selection in the URL so a thread can be deep-linked.
  // The reader opens before navigation, so the panel never closes in between.
  const selectInboxThread = useCallback(
    (thread: InboxThread | null, options?: { replace?: boolean }) => {
      if (!thread) closeRightPanel();
      const query = new URLSearchParams(window.location.search);
      query.set("view", "email");
      if (thread) query.set("thread", thread._id);
      else query.delete("thread");
      const href = `${basePath}/${requestId}?${query}`;
      if (options?.replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [basePath, requestId, router, closeRightPanel],
  );
  const selectedProviderCount = providerOutreach.selectedIds.length;
  const canEmailProviders = providerOutreach.panel?.request.canLaunch ?? false;
  useEffect(() => {
    if (readOnly) {
      onActions?.(null);
      return () => onActions?.(null);
    }

    const actions =
      view === "proposals" ? (
        <>
          <PillButton
            type="button"
            variant="secondary"
            expandLabel
            label="Share link"
            onClick={() => void openPacketLink()}
          >
            <Link className="size-3.5" />
          </PillButton>
          <PillButton
            type="button"
            variant="secondary"
            onClick={() => openOutreachEditor()}
          >
            <Plus className="size-3.5" />
            Add provider
          </PillButton>
          <span className="hidden sm:contents">
            <PillButton
              type="button"
              disabled={selectedProviderCount === 0 || !canEmailProviders}
              onClick={() => providerOutreachRef.current.sendSelected()}
            >
              {`Email selected (${selectedProviderCount})`}
            </PillButton>
          </span>
        </>
      ) : view === "email" ? (
        <>
          <PillButton type="button" onClick={() => void openClientComposer()}>
            <SquarePen className="size-3.5" />
            New email
          </PillButton>
        </>
      ) : view === "information" ? (
        <InformationRequestActions
          requestId={requestId}
          readOnly={readOnly}
          onOpenDrawer={openInformationDrawer}
          inboxHref={`${basePath}/${requestId}?view=email`}
          onAskClient={askClientForInformation}
          selectedForm={selectedInformationForm}
        />
      ) : view === "files" ? (
        <PillButton type="button" onClick={() => openUpload()}>
          <Upload className="size-3.5" />
          Upload files
        </PillButton>
      ) : null;

    onActions?.(
      <>
        <PillButton
          type="button"
          variant="secondary"
          expandLabel
          label="Notes"
          onClick={() => void openNotes()}
        >
          <StickyNote className="size-3.5" />
        </PillButton>
        {actions}
      </>,
    );
    return () => onActions?.(null);
  }, [
    onActions,
    requestId,
    basePath,
    onRightPanel,
    askClientForInformation,
    openInformationDrawer,
    selectedInformationForm,
    selectedProviderCount,
    canEmailProviders,
    openNotes,
    openPacketLink,
    openUpload,
    readOnly,
    view,
    openOutreachEditor,
    openClientComposer,
  ]);

  const client = clients?.find((row) => row._id === clientOrgId);
  const loadingPageContext = procurementRequestPageContext({
    requestId,
    clientOrgId,
    title: details?.request.title,
    clientName: client?.name,
  });

  if (
    result === undefined ||
    policies === undefined ||
    policyRows === undefined ||
    brokers === undefined ||
    proposals === undefined
  ) {
    return (
      <>
        <OperatorPageContextRegistration context={loadingPageContext} />
        <OperationalSkeletonList rows={4} />
      </>
    );
  }

  if (!details || details.request.clientOrgId !== clientOrgId) {
    return (
      <OperationalPanel>
        <OperatorPageContextRegistration context={loadingPageContext} />
        <OperationalPanelHeader title="Procurement request not found" />
        <OperationalPanelBody>
          <PillButton href={basePath} variant="secondary">
            Back to procurement
          </PillButton>
        </OperationalPanelBody>
      </OperationalPanel>
    );
  }

  const activeProposals = proposals.filter(
    (proposal) =>
      proposal.status !== "archived" && proposal.status !== "withdrawn",
  );

  const fileRow = (
    category: "requirements" | "policy" | "loss_runs" | "supporting",
    label: string,
  ) => ({
    label,
    value: (
      <div data-inline-multiline className="space-y-1 px-3">
        {category === "requirements" &&
          details.request.application?.answers.requirements?.trim() && (
            <p>{details.request.application.answers.requirements}</p>
          )}
        {details.files
          .filter((file) => (file.intakeCategory ?? "supporting") === category)
          .map((file) => (
            <div key={file._id} className="flex min-h-9 items-center gap-3">
              <button
                type="button"
                onClick={() => openFileEditor(file)}
                className="min-w-0 flex-1 text-left whitespace-normal break-words underline underline-offset-2 hover:text-foreground"
              >
                {file.label}
              </button>
              {!readOnly && (
                <RemoveButton
                  label={`Remove ${file.label}`}
                  busy={removingFileId === file._id}
                  disabled={removingFileId !== null}
                  onClick={() => void handleRemoveFile(file._id)}
                />
              )}
            </div>
          ))}
        {!readOnly && (
          <div className="flex justify-end py-1">
            <PillButton
              size="default"
              variant="secondary"
              onClick={() => openUpload(category)}
            >
              <Plus className="size-3.5" />
              Add document
            </PillButton>
          </div>
        )}
      </div>
    ),
  });
  const application = details.request.application;
  // Editors validate against live drafts; read-only views use the accepted application.
  // The menu follows the live draft while editing, else the accepted application.
  const menuSource = readOnly
    ? application && {
        answers: application.answers,
        details: application.details,
      }
    : (draft ?? {
        answers: details.request.intakeAnswers ?? application?.answers ?? {},
        details:
          details.request.intakeDetails ??
          application?.details ??
          detailsFromAnswers(details.request.intakeAnswers ?? {}),
      });
  const applicationGroups = menuSource
    ? applicationSectionGroups(menuSource.answers, menuSource.details, {
        editable: !readOnly,
      })
    : [];
  const notesItem = {
    key: SUBMISSION_NOTES_SECTION,
    label: SUBMISSION_NOTES_SECTION,
    icon: PROVIDER_ICONS.notes,
  };
  const menuGroups = [
    ...applicationGroups.map((group) =>
      group.label === "Application"
        ? { ...group, items: [...group.items, notesItem] }
        : group,
    ),
    {
      label: "Information needed",
      items: [
        { key: "information", label: "All Questions", icon: ListChecks },
        ...(informationForms ?? []).map((form) => ({
          key: `information-form:${form.id}`,
          label: form.title,
          icon: FileText,
          count: form.questionCount,
          attention: form.status === "open",
        })),
        ...(!readOnly
          ? [
              {
                key: "information-form:new",
                label: "Add form",
                icon: Plus,
                subtle: true,
              },
            ]
          : []),
      ],
    },
    {
      label: "Outreach",
      items: [
        {
          key: "providers",
          label: "Providers",
          icon: PROVIDER_ICONS.providers,
          count:
            details.outreaches.length +
            (providerOutreach.panel?.candidates.matched.filter(
              (candidate) =>
                !details.outreaches.some(
                  (outreach) => outreach.brokerOrgId === candidate.brokerOrgId,
                ),
            ).length ?? 0),
        },
        ...(!readOnly
          ? [{ key: "cadence", label: "Follow-up cadence", icon: Clock3 }]
          : []),
        {
          key: "email",
          label: "Inbox",
          icon: PROVIDER_ICONS.email,
        },
      ],
    },
  ];
  const activeApplicationSection =
    applicationSection === SUBMISSION_NOTES_SECTION ||
    applicationGroups.some((group) =>
      group.items.some((item) => item.key === applicationSection),
    )
      ? applicationSection
      : "Contact details";
  const activeMenuKey =
    view === "information"
      ? selectedInformationForm
        ? `information-form:${selectedInformationForm}`
        : "information"
      : view === "proposals"
        ? "providers"
        : view === "cadence"
          ? "cadence"
          : view === "email"
            ? "email"
            : activeApplicationSection;
  const selectMenu = async (key: string) => {
    if (requestEditorRef.current && !(await requestEditorRef.current.save()))
      return;
    if (packetEditorRef.current && !(await packetEditorRef.current.save()))
      return;
    if (
      submissionNotesRef.current &&
      !(await submissionNotesRef.current.save())
    )
      return;
    if (key.startsWith("information-form:")) {
      void changeView(
        "information",
        undefined,
        key.slice("information-form:".length),
      );
      return;
    }
    if (
      key === "providers" ||
      key === "cadence" ||
      key === "email" ||
      key === "information"
    ) {
      closeRightPanel();
      void changeView(key === "providers" ? "proposals" : key);
      return;
    }
    setApplicationSection(key);
    if (view !== "application") void changeView("application");
  };
  const documentRows =
    activeApplicationSection === "Request details"
      ? [
          fileRow("requirements", "Insurance requirements"),
          ...(details.files.some(
            (file) => (file.intakeCategory ?? "supporting") === "supporting",
          )
            ? [fileRow("supporting", "Other documents")]
            : []),
          ...(details.request.application &&
          details.request.application.answers.intakeGoal !== "savings" &&
          details.request.application.details.coverages.length
            ? [
                {
                  label: "Estimated monthly premium",
                  value: (
                    <OperatorPremiumEstimate
                      request={details.request}
                      readOnly={readOnly}
                    />
                  ),
                },
              ]
            : []),
        ]
      : activeApplicationSection === "Insurance history"
        ? [
            ...(details.request.application?.answers.currentInsurance !==
              "No" ||
            details.files.some((file) => file.intakeCategory === "policy")
              ? [fileRow("policy", "Current policies")]
              : []),
            ...(details.files.some(
              (file) => file.intakeCategory === "loss_runs",
            )
              ? [fileRow("loss_runs", "Loss runs / claims history")]
              : []),
          ]
        : [];

  const activeMenuGroup = menuGroups.find((group) =>
    group.items.some((item) => item.key === activeMenuKey),
  );
  const activeMenuItem = activeMenuGroup?.items.find(
    (item) => item.key === activeMenuKey,
  );
  const sectionLabel = `${activeMenuGroup?.label} › ${activeMenuItem?.label}`;
  // The prefetch reads what the section shows (`convex/lib/pageContext/procurement.ts`).
  const sectionViewId =
    view === "proposals"
      ? "providers"
      : view === "email"
        ? "inbox"
        : view === "cadence" || view === "information"
          ? view
          : activeApplicationSection === SUBMISSION_NOTES_SECTION
            ? "submission_notes"
            : "application";
  const pageContext = procurementRequestPageContext({
    requestId,
    clientOrgId,
    title: details.request.title,
    clientName: client?.name,
    status: REQUEST_STATUS_OPTIONS.find(
      (option) => option.value === details.request.status,
    )?.label,
    section: activeMenuGroup &&
      activeMenuItem && {
        text: `${sectionLabel}${
          view === "proposals"
            ? ` (${plural(details.outreaches.length, "provider")}, ${plural(activeProposals.length, "active proposal")})`
            : ""
        }`,
        refs: [
          { kind: "view", id: sectionViewId, label: sectionLabel },
          ...(selectedInformationForm
            ? [
                {
                  kind: "procurement_information_form",
                  id: selectedInformationForm,
                },
              ]
            : []),
        ],
      },
    open: requestPanelContext(panel, details, proposals),
  });

  return (
    <IntakeReviewCompact.Provider value={true}>
      <OperatorPageContextRegistration context={pageContext} />
      <div className="space-y-5">
        <SectionMenu
          label="Request sections"
          brand={{ name: "Operator", icon: <LogoIcon size={15} /> }}
          back={{ label: "Procurement", href: basePath }}
          footer={sidebarFooter}
          groups={menuGroups}
          active={activeMenuKey}
          onChange={(key) => void selectMenu(key)}
          onRemove={
            readOnly
              ? undefined
              : (key) => requestEditorRef.current?.removeCoverage(key)
          }
        />

        {view === "application" || view === "files" || view === "edit" ? (
          <>
            {!readOnly && activeApplicationSection === ADD_COVERAGE_SECTION ? (
              <CoveragePicker
                existing={menuSource?.details.coverages ?? []}
                onPick={(coverage) =>
                  requestEditorRef.current?.addCoverage(coverage)
                }
              />
            ) : null}
            {activeApplicationSection === SUBMISSION_NOTES_SECTION ? (
              <PacketWorkspace
                key={`${requestId}:submission-notes`}
                ref={submissionNotesRef}
                readOnly={readOnly}
                requestId={requestId}
                filename="public.md"
                inlineNotes
              />
            ) : !readOnly ? (
              <RequestEditor
                key={requestId}
                inline
                embedded
                request={details.request}
                policies={policyOptions}
                onClose={() => {}}
                activeSection={activeApplicationSection}
                extraRows={documentRows}
                onDraftChange={setDraft}
                onSectionChange={setApplicationSection}
                onRightPanel={onRightPanel}
                saveRef={requestEditorRef}
              />
            ) : application ? (
              <ReadOnlyApplicationSection
                application={application}
                section={activeApplicationSection}
                extraRows={documentRows}
              />
            ) : null}
          </>
        ) : null}

        {view === "proposals" ? (
          <ProviderOutreachPanel
            controller={providerOutreach}
            readOnly={readOnly}
            submittedProviders={details.outreaches.map((outreach) => {
              const proposal = activeProposals.find(
                (row) => row.outreachId === outreach._id,
              );
              const candidate = providerOutreach.panel
                ? [
                    ...providerOutreach.panel.candidates.matched,
                    ...providerOutreach.panel.candidates.unknown,
                    ...providerOutreach.panel.candidates.excluded,
                  ].find((row) => row.brokerOrgId === outreach.brokerOrgId)
                : undefined;
              const broker = brokers?.find(
                (row) => row._id === outreach.brokerOrgId,
              );
              const sequence = sequenceForOutreach(
                providerOutreach.panel?.sequences,
                outreach._id,
              );
              return {
                key: outreach._id,
                brokerOrgId: outreach.brokerOrgId,
                sort: {
                  provider: outreach.brokerName,
                  contact: sequence?.recipient.email ?? outreach.contactEmail,
                  coverage: candidate?.lines.covered.length,
                  status: outreachStatusSortValue(outreach.status),
                  followUp: followUpSortValue(sequence),
                },
                match: {
                  text: `${outreach.brokerName} ${sequence?.recipient.email ?? outreach.contactEmail ?? ""}`,
                  status: outreach.status,
                  followUp: followUpKey(sequence),
                },
                row: (
                  <TableRow
                    key={outreach._id}
                    className="cursor-pointer"
                    onClick={() => openOutreachEditor(outreach, proposal?._id)}
                  >
                    <ProviderSelectionCell
                      controller={providerOutreach}
                      brokerOrgId={outreach.brokerOrgId}
                      name={outreach.brokerName}
                    />
                    <TableCell className="whitespace-normal">
                      <div className="flex items-center gap-3">
                        <OrgBrandIcon
                          name={outreach.brokerName}
                          iconUrl={candidate?.iconUrl ?? broker?.iconUrl}
                          website={candidate?.website ?? broker?.website}
                          size="md"
                        />
                        <span className={typeStyle("body.medium")}>
                          {outreach.brokerName}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="min-w-64 whitespace-normal">
                      {(sequence?.recipient.email ?? outreach.contactEmail) ? (
                        <ProviderContactPill
                          provider={{
                            name: outreach.brokerName,
                            iconUrl: candidate?.iconUrl ?? broker?.iconUrl,
                            website: candidate?.website ?? broker?.website,
                          }}
                          name={sequence?.recipient.name ?? outreach.contactName}
                          email={(sequence?.recipient.email ?? outreach.contactEmail)!}
                        />
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {candidate ? <FitChips candidate={candidate} /> : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-2">
                        <OutreachStatusTag status={outreach.status} />
                        {proposal && proposalExtractionState(proposal) ? (
                          <ProposalExtractionStatus
                            proposal={proposal}
                            readOnly={readOnly}
                          />
                        ) : proposal ? (
                          <StatusTag
                            indicator={
                              proposal.status === "draft"
                                ? "draft"
                                : proposal.status === "selected"
                                  ? "complete"
                                  : proposal.status === "withdrawn"
                                    ? "cancelled"
                                    : proposal.status === "archived"
                                      ? "inactive"
                                      : "progress"
                            }
                            progress={
                              proposal.status === "reviewed" ? 0.75 : 0.4
                            }
                            tone={
                              proposal.status === "selected"
                                ? "success"
                                : proposal.status === "reviewed"
                                  ? "info"
                                  : "neutral"
                            }
                          >
                            {proposal.status.charAt(0).toUpperCase() +
                              proposal.status.slice(1).replaceAll("_", " ")}
                          </StatusTag>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      {sequence ? (
                        <SequenceState sequence={sequence} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div
                        className="flex flex-wrap items-center justify-end gap-2"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {!readOnly && sequence ? (
                          <OutreachSequenceActions
                            sequence={sequence}
                            onOpenThread={(threadId) =>
                              void changeView("email", threadId)
                            }
                          />
                        ) : null}
                        {!readOnly &&
                        candidate &&
                        !candidate.launchBlock &&
                        providerOutreach.panel?.request.canLaunch ? (
                          <PillButton
                            type="button"
                            size="compact"
                            onClick={() =>
                              providerOutreach.send(candidate.brokerOrgId)
                            }
                          >
                            Send
                          </PillButton>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ),
              };
            })}
          />
        ) : null}

        {view === "information" &&
          (selectedInformationForm ? (
            <InformationFormWorkspace
              key={selectedInformationForm}
              requestId={requestId}
              readOnly={readOnly}
              onOpenDrawer={openInformationDrawer}
              inboxHref={`${basePath}/${requestId}?view=email`}
              onAskClient={askClientForInformation}
              selectedForm={selectedInformationForm}
            />
          ) : (
            <InformationRequests
              requestId={requestId}
              readOnly={readOnly}
              onOpenDrawer={openInformationDrawer}
              inboxHref={`${basePath}/${requestId}?view=email`}
              onAskClient={askClientForInformation}
            />
          ))}
        {view === "cadence" && !readOnly ? (
          <ProviderOutreachCadence controller={providerOutreach} />
        ) : null}

        {view === "email" ? (
          <TeamInbox
            key={requestId}
            scope={{ kind: "request", requestId }}
            selectedThreadId={
              resolvedThread.status === "loading"
                ? threadParam
                : resolvedThread.threadId
            }
            onSelect={selectInboxThread}
            onOpenThread={(thread) => void openEmail(thread)}
          />
        ) : null}
      </div>
    </IntakeReviewCompact.Provider>
  );
}
