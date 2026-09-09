"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Copy,
  File,
  FileImage,
  FileText,
  Loader2,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import {
  ClientFileUploadPanel,
  type ClientFilePolicyOption,
} from "@/components/client-files/client-files-workspace";
import { usePdf } from "@/components/pdf-context";
import { ProseMarkdown } from "@/components/prose-markdown";
import {
  PacketEditor,
  PacketLinkDrawer,
  PacketWorkspace,
} from "@/components/procurement/packet-workspace";
import {
  EmailCategoryBadge,
  FILE_PURPOSE_OPTIONS,
  FILE_STATUS_OPTIONS,
  OUTREACH_STATUS_OPTIONS,
  OutreachStatusTag,
  ProcurementEmailDrawer,
  RequestStatusTag,
  REQUEST_STATUS_OPTIONS,
  procurementFilePurposeLabel,
  procurementFileStatusLabel,
  procurementOutreachStatusLabel,
  procurementRequestStatusLabel,
  writableProcurementRequestStatus,
  type ProcurementEmailDrawerHandle,
  type ProcurementFilePurpose,
  type ProcurementFileStatus,
  type ProcurementOutreachStatus,
  type ProcurementRequestStatus,
  type StoredProcurementRequestStatus,
} from "@/components/procurement/procurement-shared";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { FileDownloadButton } from "@/components/ui/file-download-button";
import { FileDropZone } from "@/components/ui/file-drop";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { Input } from "@/components/ui/input";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { StatusTag } from "@/components/ui/status-tag";
import { SearchableSelect } from "@/components/ui/searchable-select";
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
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-format";
import { inferProcurementUploadPurpose } from "@/lib/procurement-files";
import { useCachedOperatorBrokers } from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const NONE = "__none__";

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
  _id: Id<"procurementRequests">;
  clientOrgId: Id<"organizations">;
  title: string;
  narrative: string;
  targetEffectiveDate?: string;
  status: StoredProcurementRequestStatus;
  replacingPolicyId?: Id<"policies">;
  resultingPolicyId?: Id<"policies">;
  forwardingAddress: string;
  brokerCount: number;
  quoteCount: number;
  outstandingFileCount: number;
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
  log: string;
  updatedAt: number;
};

type ProcurementFileItem = {
  _id: Id<"procurementFileItems">;
  outreachId?: Id<"procurementBrokerOutreaches">;
  clientFileId?: Id<"clientFiles">;
  sourceEmailMessageId?: Id<"procurementEmailMessages">;
  purpose: ProcurementFilePurpose;
  label: string;
  status: ProcurementFileStatus;
  brokerRelease?: "hidden" | "listed" | "attached";
  clientVisible?: boolean;
  notes?: string;
  updatedAt: number;
  clientFile: ClientFileOption | null;
};

type EmailThread = {
  _id: Id<"procurementEmailThreads">;
  subject: string;
  category: "broker" | "client" | "internal" | "mixed" | "other";
  participantEmails: string[];
  latestMessageAt: number;
  messageCount: number;
};

type RequestDetails = {
  request: RequestSummary;
  outreaches: Outreach[];
  files: ProcurementFileItem[];
  emailThreads: EmailThread[];
};

type BrokerOption = {
  _id: Id<"organizations">;
  name: string;
  iconUrl?: string | null;
  website?: string;
};

type ProposalUploadTarget = {
  _id: Id<"procurementProposals">;
  status: string;
};

function ProposalDropzone({
  requestId,
  outreach,
  proposal,
  disabled = false,
  onUploadingChange,
}: {
  requestId: Id<"procurementRequests">;
  outreach: Outreach;
  proposal?: ProposalUploadTarget;
  disabled?: boolean;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const generateUploadUrl = useMutation(
    api.procurementProposals.generateUploadUrl,
  );
  const registerUpload = useMutation(api.procurementProposals.registerUpload);
  const discardUpload = useMutation(api.clientFiles.discardUpload);
  const fileProposal = useMutation(api.procurementProposals.file);

  async function upload(files: File[]) {
    if (
      uploading ||
      disabled ||
      !outreach.brokerOrgId ||
      !files.length ||
      proposal?.status === "selected"
    )
      return;
    if (
      files.some(
        (file) =>
          file.type !== "application/pdf" &&
          !file.name.toLowerCase().endsWith(".pdf"),
      )
    ) {
      toast.error("Proposal documents must be PDFs");
      return;
    }
    if (files.some((file) => file.size > 50 * 1024 * 1024)) {
      toast.error("Each proposal PDF must be 50 MB or smaller");
      return;
    }
    const pendingUploads: Array<{
      uploadIntentId: Id<"clientFileUploadIntents">;
      fileId?: Id<"_storage">;
    }> = [];
    setUploading(true);
    onUploadingChange(true);
    const uploadToast = toast.loading(
      `Uploading ${files.length === 1 ? "proposal PDF" : `${files.length} proposal PDFs`}…`,
    );
    try {
      const sources: Array<{
        kind: "upload";
        fileId: Id<"_storage">;
        fileName: string;
        contentType?: string;
        uploadIntentId: Id<"clientFileUploadIntents">;
      }> = [];
      for (const file of files) {
        const target = await generateUploadUrl({ requestId });
        const pending: (typeof pendingUploads)[number] = {
          uploadIntentId: target.uploadIntentId,
        };
        pendingUploads.push(pending);
        const response = await fetch(target.uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/pdf" },
          body: file,
        });
        if (!response.ok) throw new Error("Upload failed");
        const { storageId } = (await response.json()) as {
          storageId: Id<"_storage">;
        };
        pending.fileId = storageId;
        await registerUpload({
          requestId,
          uploadIntentId: target.uploadIntentId,
          fileId: storageId,
        });
        sources.push({
          kind: "upload",
          fileId: storageId,
          fileName: file.name,
          contentType: file.type || "application/pdf",
          uploadIntentId: target.uploadIntentId,
        });
      }
      const filed = await fileProposal({
        requestId,
        outreachId: outreach._id,
        sources,
        proposalId: proposal?.status === "draft" ? proposal._id : undefined,
        supersedesProposalId:
          proposal && proposal.status !== "draft" ? proposal._id : undefined,
      });
      toast.success(
        filed.status === "already_filed"
          ? "These proposal documents are already filed"
          : filed.status === "revised"
            ? "Proposal revision filed and queued for extraction"
            : "Proposal filed and queued for extraction",
        { id: uploadToast },
      );
    } catch (error) {
      await Promise.allSettled(
        pendingUploads.map((upload) =>
          discardUpload({
            uploadIntentId: upload.uploadIntentId,
            fileId: upload.fileId,
          }),
        ),
      );
      toast.error(
        getUserFacingErrorMessage(error, "Could not file the proposal"),
        { id: uploadToast },
      );
    } finally {
      setUploading(false);
      onUploadingChange(false);
    }
  }

  return (
    <FileDropZone
      multiple
      accept="application/pdf,.pdf"
      disabled={
        disabled ||
        uploading ||
        !outreach.brokerOrgId ||
        proposal?.status === "selected"
      }
      idleLabel={
        proposal?.status === "selected"
          ? "Proposal selected"
          : proposal && proposal.status !== "draft"
            ? "Drop revised proposal PDFs"
            : "Drop proposal PDFs"
      }
      activeLabel="Drop to file proposal"
      hint={
        proposal?.status === "selected"
          ? null
          : "or choose PDFs · up to 50 MB each"
      }
      padding="px-3 py-3"
      onFiles={(files) => void upload(files)}
    />
  );
}

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
    findings: ProposalReviewFinding[];
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

type ProposalReviewFinding = {
  sectionKey: string;
  conclusion: "meets" | "has_gap" | "insufficient_evidence";
  summary: string;
  evidence: Array<{
    proposalDocumentId: string;
    pageStart: number | null;
  }>;
};

const FINDING_TONE = {
  meets: "success",
  has_gap: "danger",
  insufficient_evidence: "warning",
} as const;

const FINDING_LABEL = {
  meets: "Meets",
  has_gap: "Gap",
  insufficient_evidence: "Unverified",
} as const;

const REVIEW_CONCLUSION_LABELS = {
  meets_requirements: "Meets requirements",
  has_gaps: "Has gaps",
  insufficient_evidence: "Insufficient evidence",
} as const;

function ProposalReviewDetails({
  proposal,
  conclusion,
  onConclusionChange,
  readOnly,
}: {
  proposal: ProposalView;
  conclusion: keyof typeof REVIEW_CONCLUSION_LABELS;
  onConclusionChange: (value: keyof typeof REVIEW_CONCLUSION_LABELS) => void;
  readOnly: boolean;
}) {
  const review = proposal.reviews[0];
  const documents = new Map(
    proposal.documents.map((document) => [String(document._id), document]),
  );
  return (
    <div className="space-y-4 border-b border-border pb-4">
      {proposal.proposalMarkdown ? (
        <ProseMarkdown>{proposal.proposalMarkdown}</ProseMarkdown>
      ) : (
        <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
          No extracted terms yet.
        </p>
      )}
      {review ? (
        <details open>
          <summary
            className={`cursor-pointer text-foreground ${typeStyle("body.medium")}`}
          >
            Packet review{" "}
            <span className="ml-2">
              <StatusTag
                tone={
                  review.stale
                    ? "warning"
                    : review.staffConclusion
                      ? "info"
                      : "neutral"
                }
              >
                {review.stale
                  ? "Stale"
                  : review.staffConclusion
                    ? "Confirmed"
                    : "Needs confirmation"}
              </StatusTag>
            </span>
          </summary>
          <div className="mt-3 space-y-4">
            {review.findings.map((finding) => {
              const evidence = finding.evidence[0];
              const document = evidence
                ? documents.get(evidence.proposalDocumentId)
                : undefined;
              return (
                <div
                  key={finding.sectionKey}
                  className="space-y-2 border-b border-border pb-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className={typeStyle("body.medium")}>
                      {proposal.sectionHeadings[finding.sectionKey] ??
                        finding.sectionKey}
                    </p>
                    <StatusTag tone={FINDING_TONE[finding.conclusion]}>
                      {FINDING_LABEL[finding.conclusion]}
                    </StatusTag>
                  </div>
                  <p
                    className={`text-muted-foreground ${typeStyle("body.default")}`}
                  >
                    {finding.summary}
                  </p>
                  {document?.url ? (
                    <PillButton
                      href={`${document.url}#page=${evidence?.pageStart ?? 1}`}
                      target="_blank"
                      rel="noreferrer"
                      size="compact"
                      variant="secondary"
                    >
                      Open evidence
                      {evidence?.pageStart ? ` · p. ${evidence.pageStart}` : ""}
                    </PillButton>
                  ) : null}
                </div>
              );
            })}
            {review.stale ? (
              <p
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
                The packet changed. Re-run the review before confirming.
              </p>
            ) : (
              <label className="block space-y-1.5">
                <span
                  className={`text-muted-foreground ${typeStyle("label.field")}`}
                >
                  Conclusion
                </span>
                <Select
                  value={conclusion}
                  items={REVIEW_CONCLUSION_LABELS}
                  disabled={readOnly || Boolean(review.staffConclusion)}
                  onValueChange={(value) =>
                    onConclusionChange(value as typeof conclusion)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(REVIEW_CONCLUSION_LABELS).map(
                      ([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </label>
            )}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function RequestEditor({
  request,
  policies,
  onClose,
}: {
  request: RequestSummary;
  policies: PolicyOption[];
  onClose: () => void;
}) {
  const updateRequest = useMutation(api.procurementRequests.update);
  const [title, setTitle] = useState(request.title);
  const [narrative, setNarrative] = useState(request.narrative);
  const [targetEffectiveDate, setTargetEffectiveDate] = useState(
    request.targetEffectiveDate ?? "",
  );
  const [status, setStatus] = useState<ProcurementRequestStatus>(
    writableProcurementRequestStatus(request.status),
  );
  const [replacingPolicyId, setReplacingPolicyId] = useState(
    request.replacingPolicyId ?? NONE,
  );
  const [resultingPolicyId, setResultingPolicyId] = useState(
    request.resultingPolicyId ?? NONE,
  );

  const policyOptions = [
    { value: NONE, label: "No policy" },
    ...policies.map((policy) => ({
      value: policy.policyId,
      label: `${policy.label}${policy.archived ? " · Archived" : ""}`,
    })),
  ];

  const values = {
    title,
    narrative,
    targetEffectiveDate,
    status,
    replacingPolicyId,
    resultingPolicyId,
  };
  const saved = useRef(values);
  const autoSave = useLocalFirstAutoSave({
    mutationName: "procurementRequests.update",
    args: values,
    canSave: !!title.trim() && !!narrative.trim(),
    flush: async (next) => {
      await updateRequest({
        requestId: request._id,
        title: next.title !== saved.current.title ? next.title : undefined,
        narrative:
          next.narrative !== saved.current.narrative
            ? next.narrative
            : undefined,
        targetEffectiveDate:
          next.targetEffectiveDate !== saved.current.targetEffectiveDate
            ? next.targetEffectiveDate || null
            : undefined,
        status: next.status !== saved.current.status ? next.status : undefined,
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
      });
      saved.current = next;
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Could not update the request"),
  });

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open)
          void autoSave.saveNow().then((saved) => {
            if (saved) onClose();
          });
      }}
      title="Edit request"
    >
      <AutoSaveStatus status={autoSave.status} />
      <div className="space-y-5">
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Title
          </span>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            What the client asked for
          </span>
          <Textarea
            value={narrative}
            onChange={(event) => setNarrative(event.target.value)}
            className="min-h-36"
          />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Target effective date
            </span>
            <Input
              type="date"
              value={targetEffectiveDate}
              onChange={(event) => setTargetEffectiveDate(event.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Status
            </span>
            <Select
              value={status}
              onValueChange={(value) =>
                setStatus(value as ProcurementRequestStatus)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {procurementRequestStatusLabel(status)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {REQUEST_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Policy being replaced
          </span>
          <SearchableSelect
            value={replacingPolicyId}
            options={policyOptions}
            onChange={setReplacingPolicyId}
          />
        </label>
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Resulting policy
          </span>
          <SearchableSelect
            value={resultingPolicyId}
            options={policyOptions}
            onChange={setResultingPolicyId}
          />
        </label>
      </div>
    </SettingsDrawer>
  );
}

export function OutreachEditor({
  requestId,
  outreach,
  brokers,
  readOnly = false,
  onClose,
}: {
  requestId: Id<"procurementRequests">;
  outreach?: Outreach;
  brokers: BrokerOption[];
  readOnly?: boolean;
  onClose: () => void;
}) {
  const createOutreach = useMutation(api.procurementRequests.createOutreach);
  const updateOutreach = useMutation(api.procurementRequests.updateOutreach);
  const generateReview = useAction(api.actions.proposalReview.generateReview);
  const confirmReview = useMutation(api.procurementProposals.confirmReview);
  const selectProposal = useMutation(api.procurementProposals.select);
  const archiveProposal = useMutation(api.procurementProposals.archive);
  const retryExtraction = useMutation(api.procurementProposals.retryExtraction);
  const cancelExtraction = useMutation(
    api.procurementProposals.cancelExtraction,
  );
  const [outreachId, setOutreachId] = useState(outreach?._id);
  const currentRequest = useQuery(
    api.procurementRequests.get,
    outreachId ? { requestId } : "skip",
  );
  const proposals = useQuery(
    api.procurementProposals.list,
    outreachId ? { requestId } : "skip",
  );
  const currentOutreach =
    currentRequest?.outreaches.find((row) => row._id === outreachId) ??
    outreach;
  const proposal: (ProposalView & ProposalUploadTarget) | undefined =
    proposals?.find(
      (row) =>
        row.outreachId === outreachId &&
        row.status !== "archived" &&
        row.status !== "withdrawn",
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
  const [log, setLog] = useState(outreach?.log ?? "");
  const savedValues = useRef({
    brokerOrgId,
    contactName,
    contactEmail,
    contactPhone,
    log,
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [working, setWorking] = useState(false);
  const [sidebarTab, setSidebarTab] = useState("pdfs");
  const review = proposal?.reviews[0];
  const latestExtraction = proposal?.extraction.latest;
  const [reviewChoice, setReviewChoice] = useState<{
    reviewId: string;
    value: keyof typeof REVIEW_CONCLUSION_LABELS;
  }>();
  const conclusion =
    reviewChoice && reviewChoice.reviewId === review?._id
      ? reviewChoice.value
      : (review?.staffConclusion ??
        review?.modelConclusion ??
        "insufficient_evidence");
  const busy = saving || uploading || working;

  async function run(
    action: () => Promise<unknown>,
    pending: string,
    success: string,
    close = false,
  ) {
    if (readOnly || busy) return;
    setWorking(true);
    const toastId = toast.loading(pending);
    try {
      await action();
      toast.success(success, { id: toastId });
      if (close) onClose();
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not update the proposal"),
        { id: toastId },
      );
    } finally {
      setWorking(false);
    }
  }

  const autoSave = useLocalFirstAutoSave({
    mutationName: "procurementRequests.updateOutreach",
    args: {
      brokerOrgId,
      contactName,
      contactEmail,
      contactPhone,
      log,
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
        log: next.log !== previous.log ? next.log || null : undefined,
      });
      savedValues.current = {
        brokerOrgId: next.brokerOrgId,
        contactName: next.contactName,
        contactEmail: next.contactEmail,
        contactPhone: next.contactPhone,
        log: next.log,
      };
    },
    onFlushed: (_, next) =>
      setStatus((current) =>
        current === next.statusDraft ? undefined : current,
      ),
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Could not update broker details"),
  });

  const changed = !!outreachId && autoSave.status !== "saved";

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
        log: log || undefined,
      });
      savedValues.current = {
        brokerOrgId,
        contactName,
        contactEmail,
        contactPhone,
        log,
      };
      setOutreachId(created.outreachId);
      setStatus(undefined);
      toast.success("Broker added");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not add broker"));
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
      title={
        outreachId
          ? (currentOutreach?.brokerName ?? "Broker outreach")
          : "Add broker"
      }
      footer={
        <>
          {!readOnly ? (
            <>
              {proposal && proposal.status !== "selected" ? (
                <PillButton
                  variant="destructive"
                  disabled={busy || changed}
                  onClick={() =>
                    void run(
                      () => archiveProposal({ proposalId: proposal._id }),
                      "Archiving proposal…",
                      "Proposal archived",
                      true,
                    )
                  }
                >
                  Archive
                </PillButton>
              ) : null}
              {proposal &&
              (latestExtraction?.stuck ||
                latestExtraction?.status === "failed") ? (
                <PillButton
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => retryExtraction({ proposalId: proposal._id }),
                      "Queuing extraction…",
                      "Proposal extraction queued",
                    )
                  }
                >
                  Retry extraction
                </PillButton>
              ) : proposal &&
                (latestExtraction?.status === "pending" ||
                  latestExtraction?.status === "running") ? (
                <PillButton
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => cancelExtraction({ proposalId: proposal._id }),
                      "Cancelling extraction…",
                      "Proposal extraction cancelled",
                    )
                  }
                >
                  Cancel extraction
                </PillButton>
              ) : null}
              {sidebarTab === "terms" ? (
                <>
                  {proposal?.extractedOffer && (!review || review.stale) ? (
                    <PillButton
                      disabled={busy || changed}
                      onClick={() =>
                        void run(
                          () => generateReview({ proposalId: proposal._id }),
                          "Reviewing proposal…",
                          "Proposal review ready",
                        )
                      }
                    >
                      {review?.stale ? "Re-run review" : "Generate review"}
                    </PillButton>
                  ) : review && !review.stale && !review.staffConclusion ? (
                    <PillButton
                      disabled={busy || changed}
                      onClick={() =>
                        void run(
                          () =>
                            confirmReview({ reviewId: review._id, conclusion }),
                          "Confirming review…",
                          "Proposal review confirmed",
                        )
                      }
                    >
                      Confirm conclusion
                    </PillButton>
                  ) : proposal?.status === "reviewed" &&
                    !review?.stale &&
                    review?.staffConclusion === "meets_requirements" ? (
                    <PillButton
                      disabled={busy || changed}
                      onClick={() =>
                        void run(
                          () => selectProposal({ proposalId: proposal._id }),
                          "Selecting proposal…",
                          "Proposal selected",
                        )
                      }
                    >
                      Select proposal
                    </PillButton>
                  ) : null}
                </>
              ) : null}
              {!outreachId ? (
                <PillButton
                  type="button"
                  onClick={() => void addBroker()}
                  disabled={busy || !brokerOrgId}
                >
                  {saving ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  Add broker
                </PillButton>
              ) : null}
            </>
          ) : null}
        </>
      }
    >
      <AutoSaveStatus status={outreachId ? autoSave.status : "saved"} />
      <div className="space-y-4">
        {outreachId ? (
          <Tabs value={sidebarTab} onValueChange={setSidebarTab}>
            <TabsList variant="pill" aria-label="Proposal sidebar">
              <TabsTrigger value="pdfs">PDFs</TabsTrigger>
              <TabsTrigger value="terms">Terms</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
        {sidebarTab === "pdfs" && outreachId && currentOutreach ? (
          <div className="space-y-3 border-b border-border pb-4">
            {proposal?.documents.map((document) =>
              document.url ? (
                <PillButton
                  key={document._id}
                  href={document.url}
                  target="_blank"
                  rel="noreferrer"
                  variant="secondary"
                  className="w-full justify-start"
                >
                  <FileText className="size-3.5 shrink-0" />
                  <span className="truncate">{document.fileName}</span>
                </PillButton>
              ) : null,
            )}
            <ProposalDropzone
              requestId={requestId}
              outreach={currentOutreach}
              proposal={proposal}
              disabled={
                readOnly ||
                busy ||
                proposals === undefined ||
                brokerOrgId !== currentOutreach.brokerOrgId
              }
              onUploadingChange={setUploading}
            />
            {proposal &&
            proposal.status !== "draft" &&
            proposal.status !== "selected" ? (
              <p
                className={`text-muted-foreground ${typeStyle("caption.default")}`}
              >
                Uploading revised PDFs replaces the current proposal. Include
                all documents for the new revision.
              </p>
            ) : null}
          </div>
        ) : null}
        {sidebarTab === "terms" && proposal ? (
          <ProposalReviewDetails
            proposal={proposal}
            conclusion={conclusion}
            onConclusionChange={(value) =>
              review && setReviewChoice({ reviewId: review._id, value })
            }
            readOnly={readOnly || busy}
          />
        ) : null}
        {sidebarTab === "terms" && !proposal ? (
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            Upload proposal PDFs to extract their terms.
          </p>
        ) : null}
        {sidebarTab === "pdfs" ? (
          <fieldset disabled={readOnly || busy} className="min-w-0 space-y-4">
            {!proposals?.some((row) => row.outreachId === outreachId) ? (
              <label className="block space-y-1.5">
                <span
                  className={`text-muted-foreground ${typeStyle("caption.default")}`}
                >
                  Broker
                </span>
                <SearchableSelect
                  value={brokerOrgId}
                  onChange={setBrokerOrgId}
                  disabled={proposals?.some(
                    (row) => row.outreachId === outreachId,
                  )}
                  options={brokers.map((broker) => ({
                    value: broker._id,
                    label: broker.name,
                    icon: (
                      <OrgBrandIcon
                        name={broker.name}
                        iconUrl={broker.iconUrl}
                        website={broker.website}
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
                    {procurementOutreachStatusLabel(status)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {OUTREACH_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="block space-y-1.5">
              <span
                className={`text-muted-foreground ${typeStyle("label.field")}`}
              >
                Log
              </span>
              <Textarea
                value={log}
                onChange={(event) => setLog(event.target.value)}
                className="min-h-64"
                placeholder="Add outreach updates in Markdown"
              />
            </label>
          </fieldset>
        ) : null}
      </div>
    </SettingsDrawer>
  );
}

function ProcurementFileEditor({
  requestId,
  fileItem,
  outreaches,
  clientFiles,
  onClose,
  onPreview,
  readOnly,
}: {
  requestId: Id<"procurementRequests">;
  fileItem?: ProcurementFileItem;
  outreaches: Outreach[];
  clientFiles: ClientFileOption[];
  onClose: () => void;
  onPreview: (file: ClientFileOption) => void;
  readOnly: boolean;
}) {
  const brokers = useCachedOperatorBrokers();
  const createFileItem = useMutation(api.procurementRequests.createFileItem);
  const updateFileItem = useMutation(api.procurementRequests.updateFileItem);
  const [label, setLabel] = useState(fileItem?.label ?? "");
  const [purpose, setPurpose] = useState<ProcurementFilePurpose>(
    fileItem?.purpose ?? "requested_document",
  );
  const [status, setStatus] = useState<ProcurementFileStatus>(
    fileItem?.status ?? "requested",
  );
  const [outreachId, setOutreachId] = useState(fileItem?.outreachId ?? NONE);
  const [clientFileId, setClientFileId] = useState(
    fileItem?.clientFileId ?? NONE,
  );
  const [notes, setNotes] = useState(fileItem?.notes ?? "");
  const [brokerRelease, setBrokerRelease] = useState<
    "hidden" | "listed" | "attached"
  >(fileItem?.brokerRelease ?? "hidden");
  const [clientVisible, setClientVisible] = useState(
    fileItem?.clientVisible ?? false,
  );
  const [saving, setSaving] = useState(false);

  const values = {
    label,
    purpose,
    status,
    outreachId,
    clientFileId,
    brokerRelease,
    clientVisible,
    notes,
  };
  const saved = useRef(values);
  const autoSave = useLocalFirstAutoSave({
    mutationName: "procurementRequests.updateFileItem",
    args: values,
    enabled: !readOnly,
    canSave: !!fileItem && !!label.trim(),
    flush: async (next) => {
      if (!fileItem) return;
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
        purpose: next.purpose !== previous.purpose ? next.purpose : undefined,
        status: next.status !== previous.status ? next.status : undefined,
        outreachId:
          next.outreachId !== previous.outreachId
            ? next.outreachId === NONE
              ? null
              : (next.outreachId as Id<"procurementBrokerOutreaches">)
            : undefined,
        clientFileId:
          next.clientFileId !== previous.clientFileId
            ? next.clientFileId === NONE
              ? null
              : (next.clientFileId as Id<"clientFiles">)
            : undefined,
        brokerRelease:
          next.brokerRelease !== previous.brokerRelease
            ? next.brokerRelease
            : undefined,
        clientVisible:
          next.clientVisible !== previous.clientVisible
            ? next.clientVisible
            : undefined,
        notes: next.notes !== previous.notes ? next.notes || null : undefined,
      });
      saved.current = next;
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Could not update the file"),
  });

  async function addFile() {
    if (readOnly || saving || !label.trim()) return;
    setSaving(true);
    try {
      await createFileItem({
        requestId,
        label,
        purpose,
        status,
        outreachId:
          outreachId === NONE
            ? undefined
            : (outreachId as Id<"procurementBrokerOutreaches">),
        clientFileId:
          clientFileId === NONE
            ? undefined
            : (clientFileId as Id<"clientFiles">),
        brokerRelease,
        clientVisible,
        notes: notes || undefined,
      });
      toast.success("File request added");
      onClose();
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not add file request"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open && !saving) {
          if (!fileItem || readOnly) onClose();
          else
            void autoSave.saveNow().then((saved) => {
              if (saved) onClose();
            });
        }
      }}
      title={fileItem ? "Edit procurement file" : "Add file request"}
      footer={
        <>
          {fileItem?.clientFile?.url ? (
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
          {!readOnly && !fileItem ? (
            <PillButton
              type="button"
              onClick={addFile}
              disabled={saving || !label.trim()}
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Add file request
            </PillButton>
          ) : null}
        </>
      }
    >
      <AutoSaveStatus status={fileItem ? autoSave.status : "saved"} />
      <fieldset disabled={readOnly || saving} className="min-w-0 space-y-5">
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Purpose
            </span>
            <Select
              value={purpose}
              onValueChange={(value) =>
                setPurpose(value as ProcurementFilePurpose)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {procurementFilePurposeLabel(purpose)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FILE_PURPOSE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-1.5">
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Status
            </span>
            <Select
              value={status}
              onValueChange={(value) =>
                setStatus(value as ProcurementFileStatus)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>{procurementFileStatusLabel(status)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FILE_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Broker outreach
          </span>
          <SearchableSelect
            value={outreachId}
            onChange={setOutreachId}
            options={[
              { value: NONE, label: "General request file" },
              ...outreaches.map((outreach) => ({
                value: outreach._id,
                label: outreach.brokerName,
                icon: (
                  <OrgBrandIcon
                    name={outreach.brokerName}
                    {...brokers?.find(
                      (broker) => broker._id === outreach.brokerOrgId,
                    )}
                    size="xs"
                  />
                ),
              })),
            ]}
          />
        </label>
        <div className="space-y-1.5">
          <p className={`text-muted-foreground ${typeStyle("label.field")}`}>
            Sharing
          </p>
          <Table aria-label="File sharing">
            <TableBody>
              <TableRow>
                <TableCell>Client visibility</TableCell>
                <TableCell className="text-right">
                  <SettingsSwitch
                    label="Client visibility"
                    checked={clientVisible}
                    disabled={readOnly || clientFileId === NONE}
                    onCheckedChange={() => setClientVisible(!clientVisible)}
                  />
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Broker visibility</TableCell>
                <TableCell className="text-right">
                  <SettingsSwitch
                    label="Broker visibility"
                    checked={brokerRelease !== "hidden"}
                    disabled={
                      readOnly || clientFileId === NONE || outreachId !== NONE
                    }
                    onCheckedChange={() =>
                      setBrokerRelease(
                        brokerRelease === "hidden" ? "attached" : "hidden",
                      )
                    }
                  />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          {outreachId !== NONE ? (
            <p
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Broker-specific files stay out of the shared packet.
            </p>
          ) : brokerRelease !== "hidden" ? (
            <p
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Regenerate the packet link to share visibility changes.
            </p>
          ) : null}
        </div>
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Client file
          </span>
          <SearchableSelect
            value={clientFileId}
            onChange={(value) => {
              setClientFileId(value);
              if (value !== NONE && status === "requested")
                setStatus("available");
            }}
            options={[
              { value: NONE, label: "Not available yet" },
              ...clientFiles.map((file) => ({
                value: file._id,
                label: file.name,
              })),
            ]}
          />
        </label>
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Notes
          </span>
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="min-h-24"
          />
        </label>
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
  onRightPanel,
}: {
  clientOrgId: Id<"organizations">;
  requestId: Id<"procurementRequests">;
  basePath: string;
  view: "overview" | "packet" | "proposals" | "files" | "email";
  readOnly: boolean;
  onActions?: (node: ReactNode) => void;
  onRightPanel: (node: ReactNode) => void;
}) {
  const router = useRouter();
  const result = useQuery(api.procurementRequests.get, { requestId });
  const policies = useQuery(api.procurementRequests.listPolicyOptions, {
    clientOrgId,
  });
  const policyRows = useQuery(api.policies.listForOrg, {
    orgId: clientOrgId,
    documentType: "policy",
  });
  const clientFilesResult = useQuery(api.clientFiles.list, {
    clientOrgId,
    limit: 250,
  });
  const requestRows = useQuery(api.procurementRequests.list, {
    clientOrgId,
    limit: 100,
  });
  const brokers = useCachedOperatorBrokers() as BrokerOption[] | undefined;
  const proposals = useQuery(api.procurementProposals.list, { requestId });
  const packetLinks = useQuery(api.procurementPacket.listLinks, { requestId });
  const mintPacketLink = useMutation(api.procurementPacket.mintLink);
  const rotatePacketLink = useMutation(api.procurementPacket.rotateLink);
  const createFileItem = useMutation(api.procurementRequests.createFileItem);
  const [regeneratingPacketLink, setRegeneratingPacketLink] = useState(false);
  const { openWithUrl, closePdf } = usePdf();

  const details = result as RequestDetails | null | undefined;
  const policyOptions = useMemo(
    () => (policies ?? []) as PolicyOption[],
    [policies],
  );
  const clientFiles = useMemo(
    () => (clientFilesResult?.files ?? []) as ClientFileOption[],
    [clientFilesResult?.files],
  );
  const requestOptions = useMemo(
    () =>
      (requestRows ?? []) as Array<{
        _id: Id<"procurementRequests">;
        title: string;
      }>,
    [requestRows],
  );
  const closeRightPanel = useCallback(() => onRightPanel(null), [onRightPanel]);

  const openRequestEditor = useCallback(() => {
    if (!details) return;
    closePdf();
    onRightPanel(
      <RequestEditor
        key={requestId}
        request={details.request}
        policies={policyOptions}
        onClose={closeRightPanel}
      />,
    );
  }, [
    closePdf,
    closeRightPanel,
    details,
    onRightPanel,
    policyOptions,
    requestId,
  ]);

  const openPacketEditor = useCallback(() => {
    closePdf();
    onRightPanel(
      <PacketEditor
        key={requestId}
        requestId={requestId}
        onClose={closeRightPanel}
      />,
    );
  }, [closePdf, closeRightPanel, onRightPanel, requestId]);

  const openOutreachEditor = useCallback(
    (outreach?: Outreach) => {
      closePdf();
      onRightPanel(
        <OutreachEditor
          key={outreach?._id ?? "new-outreach"}
          requestId={requestId}
          outreach={outreach}
          readOnly={readOnly}
          brokers={brokers ?? []}
          onClose={closeRightPanel}
        />,
      );
    },
    [brokers, closePdf, closeRightPanel, onRightPanel, readOnly, requestId],
  );

  const openFileEditor = useCallback(
    (fileItem?: ProcurementFileItem) => {
      if (!details) return;
      closePdf();
      onRightPanel(
        <ProcurementFileEditor
          key={fileItem?._id ?? "new-file"}
          requestId={requestId}
          fileItem={fileItem}
          outreaches={details?.outreaches ?? []}
          clientFiles={clientFiles}
          readOnly={readOnly}
          onPreview={(file) => {
            if (!file.url) return;
            if (
              file.contentType === "application/pdf" ||
              /\.pdf$/i.test(file.name)
            ) {
              onRightPanel(null);
              openWithUrl(file.url);
            } else {
              onRightPanel(
                <ImagePreview file={file} onClose={closeRightPanel} />,
              );
            }
          }}
          onClose={closeRightPanel}
        />,
      );
    },
    [
      clientFiles,
      closePdf,
      closeRightPanel,
      details,
      onRightPanel,
      openWithUrl,
      readOnly,
      requestId,
    ],
  );

  const openUpload = useCallback(() => {
    closePdf();
    onRightPanel(
      <ClientFileUploadPanel
        clientOrgId={clientOrgId}
        policies={(policyRows ?? []) as ClientFilePolicyOption[]}
        onClose={closeRightPanel}
        onUploaded={async (uploaded) => {
          await Promise.all(
            uploaded.map((file) =>
              createFileItem({
                requestId,
                clientFileId: file.clientFileId,
                purpose: inferProcurementUploadPurpose(file.originalName),
                label: file.originalName,
                status: "available",
              }),
            ),
          );
        }}
      />,
    );
  }, [
    clientOrgId,
    closePdf,
    closeRightPanel,
    createFileItem,
    onRightPanel,
    policyRows,
    requestId,
  ]);

  const emailDrawerRef = useRef<ProcurementEmailDrawerHandle>(null);
  const openEmail = useCallback(
    async (emailThreadId: Id<"procurementEmailThreads">) => {
      if (emailDrawerRef.current && !(await emailDrawerRef.current.save()))
        return;
      closePdf();
      onRightPanel(
        <ProcurementEmailDrawer
          key={emailThreadId}
          ref={emailDrawerRef}
          emailThreadId={emailThreadId}
          requests={requestOptions}
          readOnly={readOnly}
          onClose={closeRightPanel}
        />,
      );
    },
    [closePdf, closeRightPanel, onRightPanel, readOnly, requestOptions],
  );

  const regeneratePacketLink = useCallback(async () => {
    const activeLink = packetLinks?.find(
      (link) => link.outreachId === null && link.state === "active",
    );
    setRegeneratingPacketLink(true);
    try {
      const result = activeLink
        ? await rotatePacketLink({ linkId: activeLink.linkId })
        : await mintPacketLink({ requestId });
      closePdf();
      onRightPanel(
        <PacketLinkDrawer url={result.url} onClose={closeRightPanel} />,
      );
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Could not regenerate the packet link",
        ),
      );
    } finally {
      setRegeneratingPacketLink(false);
    }
  }, [
    closePdf,
    closeRightPanel,
    mintPacketLink,
    onRightPanel,
    packetLinks,
    requestId,
    rotatePacketLink,
  ]);

  useEffect(() => {
    if (readOnly) {
      onActions?.(null);
      return () => onActions?.(null);
    }

    const actions =
      view === "overview" ? (
        <PillButton
          type="button"
          variant="secondary"
          onClick={openRequestEditor}
        >
          <Pencil className="size-3.5" />
          Edit request
        </PillButton>
      ) : view === "packet" ? (
        <>
          <PillButton
            type="button"
            variant="secondary"
            disabled={regeneratingPacketLink || packetLinks === undefined}
            onClick={() => void regeneratePacketLink()}
          >
            {regeneratingPacketLink ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Regenerate link
          </PillButton>
          <PillButton type="button" onClick={openPacketEditor}>
            <Pencil className="size-3.5" />
            Edit packet
          </PillButton>
        </>
      ) : view === "proposals" ? (
        <>
          <PillButton
            type="button"
            variant="secondary"
            disabled={regeneratingPacketLink || packetLinks === undefined}
            onClick={() => void regeneratePacketLink()}
          >
            {regeneratingPacketLink ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Regenerate link
          </PillButton>
          <PillButton type="button" onClick={() => openOutreachEditor()}>
            <Plus className="size-3.5" />
            Add broker
          </PillButton>
        </>
      ) : view === "files" ? (
        <>
          <PillButton
            type="button"
            variant="secondary"
            onClick={() => openFileEditor()}
          >
            <Plus className="size-3.5" />
            Add file request
          </PillButton>
          <PillButton type="button" onClick={openUpload}>
            <Upload className="size-3.5" />
            Upload files
          </PillButton>
        </>
      ) : null;

    onActions?.(actions);
    return () => onActions?.(null);
  }, [
    onActions,
    openFileEditor,
    openOutreachEditor,
    openPacketEditor,
    openRequestEditor,
    openUpload,
    packetLinks,
    readOnly,
    regeneratePacketLink,
    regeneratingPacketLink,
    view,
  ]);

  async function copyAddress() {
    if (!details) return;
    await navigator.clipboard.writeText(details.request.forwardingAddress);
    toast.success("Forwarding address copied");
  }

  if (
    result === undefined ||
    policies === undefined ||
    policyRows === undefined ||
    clientFilesResult === undefined ||
    requestRows === undefined ||
    brokers === undefined ||
    proposals === undefined
  ) {
    return (
      <OperationalPanel
        as="div"
        className="flex h-40 items-center justify-center"
      >
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </OperationalPanel>
    );
  }

  if (!details || details.request.clientOrgId !== clientOrgId) {
    return (
      <OperationalPanel>
        <OperationalPanelHeader title="Procurement request not found" />
        <OperationalPanelBody>
          <PillButton href={basePath} variant="secondary">
            Back to procurement
          </PillButton>
        </OperationalPanelBody>
      </OperationalPanel>
    );
  }

  const outreachById = new Map(
    details.outreaches.map((outreach) => [outreach._id, outreach]),
  );
  const activeProposals = proposals.filter(
    (proposal) =>
      proposal.status !== "archived" && proposal.status !== "withdrawn",
  );
  const proposalOutreachIds = new Set(
    activeProposals.map((proposal) => String(proposal.outreachId)),
  );
  const outreachesWithoutProposal = details.outreaches.filter(
    (outreach) => !proposalOutreachIds.has(String(outreach._id)),
  );
  const blockers = [
    ...(details.outreaches.length === 0
      ? ["No broker outreach has been added"]
      : []),
    ...(details.request.outstandingFileCount
      ? [
          `${details.request.outstandingFileCount} requested file${details.request.outstandingFileCount === 1 ? " is" : "s are"} outstanding`,
        ]
      : []),
    ...(activeProposals.filter(
      (proposal) =>
        proposal.extraction.latest?.stuck ||
        proposal.extraction.latest?.status === "failed",
    ).length
      ? ["Proposal extraction needs attention"]
      : []),
  ];
  const nextActions = blockers.length
    ? blockers
    : activeProposals.some((proposal) => proposal.status === "review_ready")
      ? ["Review extracted proposals against the broker packet"]
      : details.outreaches.some(
            (outreach) => outreach.status === "quote_received",
          ) && activeProposals.length === 0
        ? ["File received quote documents as proposals"]
        : [
            "Continue broker follow-up and import replies at the forwarding address",
          ];
  const requestPath = `${basePath}/${requestId}`;

  return (
    <div className="space-y-5">
      <div className="overflow-x-auto">
        <Tabs
          value={view}
          onValueChange={(nextView) =>
            router.push(
              nextView === "overview"
                ? requestPath
                : `${requestPath}?view=${nextView}`,
            )
          }
        >
          <TabsList variant="pill" aria-label="Procurement request view">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="packet">Packet</TabsTrigger>
            <TabsTrigger value="proposals">
              Proposals
              <span className="text-muted-foreground/60">
                {details.outreaches.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="files">
              Files
              <span className="text-muted-foreground/60">
                {details.files.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="email">
              Imported email
              <span className="text-muted-foreground/60">
                {details.emailThreads.length}
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {view === "overview" ? (
        <div className="space-y-4">
          <OperationalLabelValueList>
            <OperationalLabelValueRow
              label="Current stage"
              value={<RequestStatusTag status={details.request.status} />}
            />
            <OperationalLabelValueRow
              label="Proposals"
              value={`${details.request.brokerCount} brokers · ${activeProposals.length} proposals`}
            />
            <OperationalLabelValueRow
              label="Target effective date"
              value={formatDisplayDate(
                details.request.targetEffectiveDate,
                "Not set",
              )}
            />
            <OperationalLabelValueRow label="Next" value={nextActions[0]} />
          </OperationalLabelValueList>
          <OperationalLabelValueList>
            <OperationalLabelValueRow
              label="What the client asked for"
              layout="stacked"
              value={
                <span className="whitespace-pre-wrap">
                  {details.request.narrative}
                </span>
              }
            />
          </OperationalLabelValueList>
        </div>
      ) : null}

      {view === "packet" ? (
        <PacketWorkspace
          key={requestId}
          requestId={requestId}
          readOnly={readOnly}
        />
      ) : null}

      {view === "proposals" ? (
        <div className="space-y-4">
          {activeProposals.length ? (
            <OperationalPanel as="section">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Broker</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Premium</TableHead>
                    <TableHead>Review</TableHead>
                    <TableHead>Documents</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeProposals.map((proposal) => {
                    const offer = (proposal.extractedOffer ?? {}) as {
                      premium?: string;
                      premiumAmount?: number;
                      proposedEffectiveDate?: string;
                      proposedExpirationDate?: string;
                      coverages?: Array<{ name?: string; limit?: string }>;
                    };
                    const review = proposal.reviews[0];
                    const conclusion = review?.stale
                      ? undefined
                      : (review?.staffConclusion ?? review?.modelConclusion);
                    const latestExtraction = proposal.extraction.latest;
                    const proposalOutreach = outreachById.get(
                      proposal.outreachId,
                    );
                    return (
                      <TableRow
                        key={proposal._id}
                        tabIndex={proposalOutreach ? 0 : undefined}
                        onClick={() =>
                          proposalOutreach &&
                          openOutreachEditor(proposalOutreach)
                        }
                        onKeyDown={(event) => {
                          if (
                            proposalOutreach &&
                            (event.key === "Enter" || event.key === " ")
                          ) {
                            event.preventDefault();
                            openOutreachEditor(proposalOutreach);
                          }
                        }}
                        className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                      >
                        <TableCell className="max-w-64 whitespace-normal">
                          <span
                            className={`text-foreground ${typeStyle("body.medium")}`}
                          >
                            {proposal.brokerName ?? "Broker"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <StatusTag
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
                          {latestExtraction?.stuck ? (
                            <p
                              className={`mt-1 text-warning ${typeStyle("caption.default")}`}
                            >
                              Extraction lease expired
                            </p>
                          ) : latestExtraction?.status === "failed" ? (
                            <p
                              className={`mt-1 max-w-48 truncate text-destructive ${typeStyle("caption.default")}`}
                              title={latestExtraction.lastError ?? undefined}
                            >
                              {latestExtraction.lastError ||
                                "Extraction failed"}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {offer.premium ?? offer.premiumAmount ?? "—"}
                        </TableCell>
                        <TableCell>
                          {review?.stale ? (
                            <StatusTag tone="warning">Stale</StatusTag>
                          ) : conclusion ? (
                            <StatusTag
                              tone={
                                conclusion === "meets_requirements"
                                  ? "success"
                                  : "warning"
                              }
                            >
                              {REVIEW_CONCLUSION_LABELS[conclusion]}
                            </StatusTag>
                          ) : (
                            <span className="text-muted-foreground">
                              Not reviewed
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-muted-foreground">
                            {proposal.documents.length}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </OperationalPanel>
          ) : null}
        </div>
      ) : null}

      {view === "proposals" ? (
        details.outreaches.length === 0 ? (
          <EmptyStateCard
            title="No brokers contacted yet"
            description="Add a broker from the network directory and track each response independently."
          />
        ) : outreachesWithoutProposal.length ? (
          <OperationalPanel as="section">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Broker</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outreachesWithoutProposal.map((outreach) => (
                  <TableRow
                    key={outreach._id}
                    tabIndex={0}
                    onClick={() => openOutreachEditor(outreach)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openOutreachEditor(outreach);
                      }
                    }}
                    className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <TableCell className="min-w-52 whitespace-normal">
                      <p
                        className={`text-foreground ${typeStyle("body.medium")}`}
                      >
                        {outreach.brokerName}
                      </p>
                      <p
                        className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
                      >
                        {[outreach.contactName, outreach.contactEmail]
                          .filter(Boolean)
                          .join(" · ") || "No contact saved"}
                      </p>
                    </TableCell>
                    <TableCell>
                      <OutreachStatusTag status={outreach.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDisplayDate(outreach.updatedAt, "—")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </OperationalPanel>
        ) : null
      ) : null}

      {view === "files" ? (
        details.files.length === 0 ? (
          <EmptyStateCard
            title="No procurement files yet"
            description="Upload client material or add a request for a document that still needs to be collected."
          />
        ) : (
          <OperationalPanel as="section">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File or request</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Broker</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {details.files.map((item) => {
                  const file = item.clientFile;
                  const pdf = Boolean(
                    file &&
                    (file.contentType === "application/pdf" ||
                      /\.pdf$/i.test(file.name)),
                  );
                  const image = Boolean(
                    file &&
                    (file.contentType.startsWith("image/") ||
                      /\.(avif|gif|jpe?g|png|webp)$/i.test(file.name)),
                  );
                  return (
                    <TableRow
                      key={item._id}
                      tabIndex={0}
                      onClick={() => openFileEditor(item)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openFileEditor(item);
                        }
                      }}
                      className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      <TableCell className="min-w-64 whitespace-normal">
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">
                            {image ? (
                              <FileImage className="size-4" />
                            ) : pdf ? (
                              <FileText className="size-4" />
                            ) : (
                              <File className="size-4" />
                            )}
                          </span>
                          <div className="min-w-0">
                            <span
                              className={`text-foreground ${typeStyle("body.medium")}`}
                            >
                              {item.label}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {procurementFilePurposeLabel(item.purpose)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.outreachId
                          ? (outreachById.get(item.outreachId)?.brokerName ??
                            "Unknown")
                          : "General"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {procurementFileStatusLabel(item.status)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {[
                          item.clientVisible ? "Client" : null,
                          item.brokerRelease && item.brokerRelease !== "hidden"
                            ? "Broker"
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Private"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDisplayDate(item.updatedAt, "—")}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </OperationalPanel>
        )
      ) : null}

      {view === "email" ? (
        <div className="space-y-4">
          <OperationalLabelValueList>
            <OperationalLabelValueRow
              label="Forward email to"
              verticalAlign="center"
              value={
                <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span
                    className={`min-w-0 break-all ${typeStyle("technical.codeCompact")}`}
                  >
                    {details.request.forwardingAddress}
                  </span>
                  <PillButton
                    type="button"
                    variant="secondary"
                    onClick={() => void copyAddress()}
                  >
                    <Copy className="size-3.5" />
                    Copy address
                  </PillButton>
                </div>
              }
            />
          </OperationalLabelValueList>
          {details.emailThreads.length === 0 ? (
            <EmptyStateCard
              title="No email imported for this request"
              description="Forward a thread to this request’s address. Original forwarded participants drive automatic categorization."
              icon={<Mail className="size-6" />}
            />
          ) : (
            <OperationalPanel as="section">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead>Participant</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Last activity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {details.emailThreads.map((email) => (
                    <TableRow
                      key={email._id}
                      tabIndex={0}
                      className="cursor-pointer"
                      onClick={() => openEmail(email._id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openEmail(email._id);
                        }
                      }}
                    >
                      <TableCell className="min-w-64 whitespace-normal">
                        <p
                          className={`text-foreground ${typeStyle("body.medium")}`}
                        >
                          {email.subject}
                        </p>
                        <p
                          className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
                        >
                          {email.messageCount}{" "}
                          {email.messageCount === 1 ? "message" : "messages"}
                        </p>
                      </TableCell>
                      <TableCell className="max-w-64 truncate text-muted-foreground">
                        {email.participantEmails[0] ?? "Unknown"}
                      </TableCell>
                      <TableCell>
                        <EmailCategoryBadge category={email.category} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDisplayDateTime(email.latestMessageAt, "—")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </OperationalPanel>
          )}
        </div>
      ) : null}
    </div>
  );
}
