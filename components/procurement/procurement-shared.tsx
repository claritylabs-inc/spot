"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Download, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { Badge } from "@/components/ui/badge";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusTag } from "@/components/ui/status-tag";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDisplayDateTime } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { useCachedOperatorBrokers } from "@/lib/sync/operator-cached-queries";

export const REQUEST_STATUS_OPTIONS = [
  { value: "draft", label: "Draft", tone: "neutral" },
  { value: "submitted", label: "Submitted", tone: "neutral" },
  {
    value: "gathering_information",
    label: "Gathering information",
    tone: "info",
  },
  { value: "marketing", label: "Marketing", tone: "info" },
  { value: "proposal_review", label: "Proposal review", tone: "info" },
  { value: "binding", label: "Binding", tone: "info" },
  { value: "completed", label: "Completed", tone: "success" },
  { value: "cancelled", label: "Cancelled", tone: "danger" },
] as const;

const RETIRED_REQUEST_STATUS_OPTIONS = [
  { value: "quote_review", label: "Quote review", tone: "info" },
  { value: "client_decision", label: "Client decision", tone: "warning" },
  { value: "accepted", label: "Accepted", tone: "success" },
  { value: "closed", label: "Closed", tone: "neutral" },
] as const;

export type ProcurementRequestStatus =
  (typeof REQUEST_STATUS_OPTIONS)[number]["value"];

export type StoredProcurementRequestStatus =
  | ProcurementRequestStatus
  | (typeof RETIRED_REQUEST_STATUS_OPTIONS)[number]["value"];

export function writableProcurementRequestStatus(
  status: StoredProcurementRequestStatus,
): ProcurementRequestStatus {
  if (status === "quote_review" || status === "client_decision")
    return "proposal_review";
  if (status === "accepted") return "binding";
  if (status === "closed") return "completed";
  return status;
}

export const OUTREACH_STATUS_OPTIONS = [
  { value: "request_sent", label: "Request sent", tone: "info" },
  { value: "can_handle", label: "Can handle", tone: "success" },
  { value: "cannot_handle", label: "Can’t handle", tone: "danger" },
  { value: "quote_received", label: "Quote received", tone: "info" },
  { value: "quote_accepted", label: "Accepted by client", tone: "success" },
  { value: "quote_rejected", label: "Rejected by client", tone: "danger" },
] as const;

export type ProcurementOutreachStatus =
  (typeof OUTREACH_STATUS_OPTIONS)[number]["value"];

export const FILE_PURPOSE_OPTIONS = [
  { value: "requirements", label: "Requirements" },
  { value: "application", label: "Application" },
  { value: "requested_document", label: "Broker-requested document" },
  { value: "quote", label: "Quote" },
  { value: "correspondence", label: "Email correspondence" },
  { value: "other", label: "Other" },
] as const;

export type ProcurementFilePurpose =
  (typeof FILE_PURPOSE_OPTIONS)[number]["value"];

export const FILE_STATUS_OPTIONS = [
  { value: "requested", label: "Requested" },
  { value: "available", label: "Available" },
  { value: "sent", label: "Sent" },
  { value: "received", label: "Received" },
] as const;

export type ProcurementFileStatus =
  (typeof FILE_STATUS_OPTIONS)[number]["value"];

export const EMAIL_CATEGORY_OPTIONS = [
  { value: "broker", label: "Broker" },
  { value: "client", label: "Client" },
  { value: "internal", label: "Internal" },
  { value: "mixed", label: "Mixed" },
  { value: "other", label: "Other" },
] as const;

export type ProcurementEmailCategory =
  (typeof EMAIL_CATEGORY_OPTIONS)[number]["value"];

function optionForValue<T extends readonly { value: string; label: string }[]>(
  options: T,
  value: string,
): T[number] | undefined {
  return options.find((option) => option.value === value) as
    | T[number]
    | undefined;
}

export function RequestStatusTag({
  status,
}: {
  status: StoredProcurementRequestStatus;
}) {
  const option =
    optionForValue(REQUEST_STATUS_OPTIONS, status) ??
    optionForValue(RETIRED_REQUEST_STATUS_OPTIONS, status);
  return (
    <StatusTag tone={option?.tone ?? "neutral"}>
      {procurementRequestStatusLabel(status)}
    </StatusTag>
  );
}

export function OutreachStatusTag({
  status,
}: {
  status: ProcurementOutreachStatus;
}) {
  const option = optionForValue(OUTREACH_STATUS_OPTIONS, status);
  return (
    <StatusTag tone={option?.tone ?? "neutral"}>
      {procurementOutreachStatusLabel(status)}
    </StatusTag>
  );
}

export function EmailCategoryBadge({
  category,
}: {
  category: ProcurementEmailCategory;
}) {
  return (
    <Badge variant="outline">{procurementEmailCategoryLabel(category)}</Badge>
  );
}

export function procurementRequestStatusLabel(value: string) {
  return (
    optionForValue(REQUEST_STATUS_OPTIONS, value)?.label ??
    optionForValue(RETIRED_REQUEST_STATUS_OPTIONS, value)?.label ??
    value
  );
}

export function procurementOutreachStatusLabel(value: string) {
  return optionForValue(OUTREACH_STATUS_OPTIONS, value)?.label ?? value;
}

export function procurementEmailCategoryLabel(value: string) {
  return optionForValue(EMAIL_CATEGORY_OPTIONS, value)?.label ?? value;
}

export function procurementFilePurposeLabel(value: string) {
  return optionForValue(FILE_PURPOSE_OPTIONS, value)?.label ?? value;
}

export function procurementFileStatusLabel(value: string) {
  return optionForValue(FILE_STATUS_OPTIONS, value)?.label ?? value;
}

type ProcurementRequestOption = {
  _id: Id<"procurementRequests">;
  title: string;
};

type ForwardedMailbox = { name?: string; address?: string };
type ForwardedEmail = {
  email?: {
    from?: ForwardedMailbox;
    to?: ForwardedMailbox[];
    cc?: ForwardedMailbox[];
    subject?: string;
    date?: string;
    body?: string;
  };
};

function mailboxLabel(mailbox: ForwardedMailbox | undefined) {
  if (!mailbox) return null;
  return mailbox.name && mailbox.address
    ? `${mailbox.name} <${mailbox.address}>`
    : (mailbox.address ?? mailbox.name ?? null);
}

function mailboxList(mailboxes: ForwardedMailbox[] | undefined) {
  return (mailboxes ?? [])
    .map(mailboxLabel)
    .filter((value): value is string => Boolean(value))
    .join(", ");
}

export function ProcurementEmailDrawer({
  emailThreadId,
  requests,
  readOnly,
  onClose,
}: {
  emailThreadId: Id<"procurementEmailThreads">;
  requests: ProcurementRequestOption[];
  readOnly: boolean;
  onClose: () => void;
}) {
  const brokers = useCachedOperatorBrokers();
  const result = useQuery(api.procurementRequests.getEmailThread, {
    emailThreadId,
  });
  const inference = useQuery(
    api.procurementRequests.previewEmailReconciliation,
    { emailThreadId },
  );
  const updateThread = useMutation(api.procurementRequests.updateEmailThread);
  const fileEmailQuote = useMutation(api.procurementProposals.fileEmailQuote);
  const [draft, setDraft] = useState<{
    emailThreadId: Id<"procurementEmailThreads">;
    category: ProcurementEmailCategory;
    requestId: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [filing, setFiling] = useState(false);
  const [outreachSelection, setOutreachSelection] = useState<{
    emailThreadId: Id<"procurementEmailThreads">;
    outreachId: string;
  } | null>(null);
  // Attachments the operator excluded from filing, so signature images and
  // logos do not become proposal documents. Everything else files by default.
  const [excludedFileIds, setExcludedFileIds] = useState<string[]>([]);
  const activeDraft = draft?.emailThreadId === emailThreadId ? draft : null;
  const category = activeDraft?.category ?? result?.thread.category ?? "";
  const requestId = activeDraft?.requestId ?? result?.thread.requestId ?? "";

  const changed = Boolean(
    result &&
    (category !== result.thread.category ||
      requestId !== result.thread.requestId),
  );
  const requestOptions = useMemo(
    () =>
      requests.map((request) => ({ value: request._id, label: request.title })),
    [requests],
  );
  // Outreaches follow the thread's current request. Reading them from the
  // preview keeps the picker correct after the thread moves to another request.
  const outreachOptions = useMemo(
    () =>
      (inference?.outreaches ?? []).map((outreach) => ({
        value: String(outreach.outreachId),
        label: outreach.contactName
          ? `${outreach.brokerName} · ${outreach.contactName}`
          : outreach.brokerName,
        icon: (
          <OrgBrandIcon
            name={outreach.brokerName}
            {...brokers?.find((broker) => broker._id === outreach.brokerOrgId)}
            size="xs"
          />
        ),
      })),
    [brokers, inference],
  );
  const inferredOutreachId =
    inference?.outreachInference.status === "exact"
      ? inference.outreachInference.candidates[0]?.outreachId
      : undefined;
  const pendingOutreachId =
    outreachSelection?.emailThreadId === emailThreadId
      ? outreachSelection.outreachId
      : (inferredOutreachId ?? "");
  // A selection made before the thread moved names an outreach on the old
  // request; sending it back would make the preview query throw during render.
  const selectedOutreachId = outreachOptions.some(
    (option) => option.value === pendingOutreachId,
  )
    ? pendingOutreachId
    : "";
  const reconciliation = useQuery(
    api.procurementRequests.previewEmailReconciliation,
    selectedOutreachId
      ? {
          emailThreadId,
          outreachId: selectedOutreachId as Id<"procurementBrokerOutreaches">,
        }
      : { emailThreadId },
  );
  const selectedFiles = (reconciliation?.unfiledFiles ?? []).filter(
    (file) => !excludedFileIds.includes(String(file.clientFileId)),
  );

  async function save() {
    if (!result || !category || !requestId || !changed) return;
    setSaving(true);
    try {
      await updateThread({
        emailThreadId,
        category: category === result.thread.category ? undefined : category,
        requestId:
          requestId === result.thread.requestId
            ? undefined
            : (requestId as Id<"procurementRequests">),
      });
      toast.success("Email classification updated");
      onClose();
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Failed to update email thread"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function fileQuote() {
    if (!selectedOutreachId || !selectedFiles.length) return;
    setFiling(true);
    try {
      const filed = await fileEmailQuote({
        emailThreadId,
        outreachId: selectedOutreachId as Id<"procurementBrokerOutreaches">,
        clientFileIds: selectedFiles.map((file) => file.clientFileId),
      });
      toast.success(
        filed.status === "already_filed"
          ? "Email attachments were already filed"
          : "Email quote filed and extraction queued",
      );
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Failed to file email quote"),
      );
    } finally {
      setFiling(false);
    }
  }

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
      title={result?.thread.subject ?? "Imported email"}
      footer={
        readOnly ? null : (
          <>
            <PillButton type="button" variant="secondary" onClick={onClose}>
              Cancel
            </PillButton>
            <PillButton
              type="button"
              onClick={save}
              disabled={!changed || saving}
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Save
            </PillButton>
          </>
        )
      }
    >
      {result === undefined ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : result === null ? (
        <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
          This imported email is no longer available.
        </p>
      ) : (
        <div className="space-y-5">
          <OperationalPanel as="div">
            <OperationalPanelHeader
              title="Classification"
              description={
                result.thread.categorySource === "operator"
                  ? "Set manually by an operator"
                  : result.thread.categoryReason
              }
            />
            <OperationalPanelBody className="space-y-4">
              <label className="block space-y-1.5">
                <span
                  className={`text-muted-foreground ${typeStyle("caption.default")}`}
                >
                  Participant category
                </span>
                <Select
                  value={category}
                  onValueChange={(value) =>
                    value &&
                    setDraft({
                      emailThreadId,
                      category: value as ProcurementEmailCategory,
                      requestId,
                    })
                  }
                  disabled={readOnly}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {category
                        ? procurementEmailCategoryLabel(category)
                        : "Choose category"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {EMAIL_CATEGORY_OPTIONS.map((option) => (
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
                  Assigned request
                </span>
                <SearchableSelect
                  value={requestId}
                  options={requestOptions}
                  onChange={(value) =>
                    setDraft({
                      emailThreadId,
                      category: category || result.thread.category,
                      requestId: value,
                    })
                  }
                  disabled={readOnly}
                  placeholder="Choose request"
                />
              </label>
              <div className="border-t border-border pt-3">
                <p
                  className={`text-muted-foreground ${typeStyle("caption.default")}`}
                >
                  Originally addressed to
                </p>
                <p
                  className={`mt-1 text-foreground ${typeStyle("body.default")}`}
                >
                  {result.addressedRequest.title}
                </p>
                <p
                  className={`mt-0.5 break-all text-muted-foreground ${typeStyle("caption.default")}`}
                >
                  {result.addressedRequest.forwardingAddress}
                </p>
              </div>
            </OperationalPanelBody>
          </OperationalPanel>

          <OperationalPanel as="div">
            <OperationalPanelHeader
              title="Quote reconciliation"
              description={
                reconciliation === undefined
                  ? "Checking attachments and outreach contacts"
                  : !reconciliation.filable
                    ? "This email is archived; restore it to file a quote"
                    : reconciliation.files.length === 0
                      ? "This email has no active attachments"
                      : reconciliation.unfiledFiles.length === 0
                        ? "Every active attachment is already filed in a proposal"
                        : inference?.outreachInference.status === "exact"
                          ? "Matched from an exact outreach contact email"
                          : "Choose the outreach that sent these attachments"
              }
            />
            <OperationalPanelBody className="space-y-4">
              {reconciliation === undefined ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <>
                  <div>
                    <p
                      className={`text-muted-foreground ${typeStyle("caption.default")}`}
                    >
                      Unfiled attachments
                    </p>
                    {reconciliation.unfiledFiles.length ? (
                      <div className="mt-1.5 space-y-1.5">
                        {reconciliation.unfiledFiles.map((file) => (
                          <label
                            key={String(file.clientFileId)}
                            className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
                          >
                            <input
                              type="checkbox"
                              className="size-4"
                              checked={
                                !excludedFileIds.includes(
                                  String(file.clientFileId),
                                )
                              }
                              disabled={readOnly || filing}
                              onChange={(event) =>
                                setExcludedFileIds((current) =>
                                  event.target.checked
                                    ? current.filter(
                                        (id) =>
                                          id !== String(file.clientFileId),
                                      )
                                    : [...current, String(file.clientFileId)],
                                )
                              }
                            />
                            <span
                              className={`min-w-0 truncate text-foreground ${typeStyle("body.default")}`}
                            >
                              {file.name}
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p
                        className={`mt-1 text-foreground ${typeStyle("body.default")}`}
                      >
                        None
                      </p>
                    )}
                  </div>
                  {reconciliation.filable &&
                  reconciliation.unfiledFiles.length > 0 ? (
                    <>
                      <label className="block space-y-1.5">
                        <span
                          className={`text-muted-foreground ${typeStyle("caption.default")}`}
                        >
                          Broker outreach
                        </span>
                        <SearchableSelect
                          value={selectedOutreachId}
                          options={outreachOptions}
                          onChange={(value) =>
                            setOutreachSelection({
                              emailThreadId,
                              outreachId: value,
                            })
                          }
                          disabled={readOnly || filing}
                          placeholder="Choose outreach"
                        />
                      </label>
                      <PillButton
                        type="button"
                        onClick={fileQuote}
                        disabled={
                          readOnly ||
                          filing ||
                          !selectedOutreachId ||
                          !selectedFiles.length
                        }
                      >
                        {filing ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : null}
                        File quote
                      </PillButton>
                    </>
                  ) : null}
                </>
              )}
            </OperationalPanelBody>
          </OperationalPanel>

          <div className="space-y-3">
            {result.messages.map((message) => {
              const forwarded = message.forwarded as ForwardedEmail | undefined;
              const forwardedEmail = forwarded?.email;
              return (
                <OperationalPanel key={message._id} as="div">
                  <OperationalPanelHeader
                    title={message.fromName ?? message.fromEmail}
                    description={formatDisplayDateTime(message.receivedAt, "—")}
                    action={<Mail className="size-4 text-muted-foreground" />}
                  />
                  <OperationalPanelBody className="space-y-4">
                    <div
                      className={`space-y-1 text-muted-foreground ${typeStyle("caption.default")}`}
                    >
                      <p>
                        <span className="text-foreground">From:</span>{" "}
                        {message.fromEmail}
                      </p>
                      <p>
                        <span className="text-foreground">To:</span>{" "}
                        {message.toAddresses.join(", ") || "—"}
                      </p>
                      {message.ccAddresses.length > 0 ? (
                        <p>
                          <span className="text-foreground">Cc:</span>{" "}
                          {message.ccAddresses.join(", ")}
                        </p>
                      ) : null}
                    </div>

                    {forwardedEmail ? (
                      <div className="space-y-1 border-y border-border py-3">
                        <p
                          className={`text-foreground ${typeStyle("body.medium")}`}
                        >
                          Forwarded conversation
                        </p>
                        <div
                          className={`space-y-1 text-muted-foreground ${typeStyle("caption.default")}`}
                        >
                          {mailboxLabel(forwardedEmail.from) ? (
                            <p>From: {mailboxLabel(forwardedEmail.from)}</p>
                          ) : null}
                          {mailboxList(forwardedEmail.to) ? (
                            <p>To: {mailboxList(forwardedEmail.to)}</p>
                          ) : null}
                          {mailboxList(forwardedEmail.cc) ? (
                            <p>Cc: {mailboxList(forwardedEmail.cc)}</p>
                          ) : null}
                          {forwardedEmail.subject ? (
                            <p>Subject: {forwardedEmail.subject}</p>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    <p
                      className={`whitespace-pre-wrap break-words text-foreground ${typeStyle("body.default")}`}
                    >
                      {message.currentText || "(No forwarder note)"}
                    </p>

                    {forwardedEmail?.body ? (
                      <div className="border-t border-border pt-3">
                        <p
                          className={`mb-2 text-muted-foreground ${typeStyle("caption.default")}`}
                        >
                          Forwarded message
                        </p>
                        <p
                          className={`whitespace-pre-wrap break-words text-foreground ${typeStyle("body.default")}`}
                        >
                          {forwardedEmail.body}
                        </p>
                      </div>
                    ) : null}

                    {message.files.filter(Boolean).length > 0 ? (
                      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                        {message.files.flatMap((file) =>
                          file?.url ? (
                            <PillButton
                              key={file.clientFileId}
                              href={file.url}
                              download={file.name}
                              target="_blank"
                              rel="noreferrer"
                              variant="secondary"
                            >
                              <Download className="size-3.5" />
                              {file.name}
                            </PillButton>
                          ) : (
                            []
                          ),
                        )}
                      </div>
                    ) : null}
                  </OperationalPanelBody>
                </OperationalPanel>
              );
            })}
          </div>
        </div>
      )}
    </SettingsDrawer>
  );
}
