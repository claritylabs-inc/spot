"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { ClipboardList, FileText, Loader2, Mail as MailIcon, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { PillButton } from "@/components/ui/pill-button";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import type { ToolArtifactData } from "../types";
import { formatDisplayDateTime } from "@/lib/date-format";
import {
  formatAttachmentSize,
  isMailboxPdfAttachment,
  isMailboxRequirementAttachment,
  MailboxEmailReviewSidebar,
  totalCreatedRequirements,
  type LiveMailboxEmail,
} from "./mailbox-email-review-sidebar";
import { typeStyle } from "@/lib/typography";

export function normalizeMailboxTask(data: unknown): {
  title?: string;
  status?: string;
  summary?: string;
  searches: Array<{
    accountEmail?: string;
    mailbox: string;
    query?: string;
    dateFrom?: string;
    dateTo?: string;
    resultCount: number;
    errorCount: number;
    identified: Array<{
      subject: string;
      from?: string;
      date?: string;
      attachmentCount?: number;
    }>;
  }>;
  emails: Array<{
    automationItemId?: Id<"connectedEmailAutomationItems">;
    emailRef?: string;
    mailbox?: string;
    accountEmail?: string;
    subject: string;
    from?: string;
    date?: string;
    reason?: string;
    attachments: Array<{
      filename: string;
      contentType?: string;
      size?: number;
      reason?: string;
    }>;
  }>;
} {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { searches: [], emails: [] };
  }
  const record = data as Record<string, unknown>;
  const plan =
    record.plan && typeof record.plan === "object" && !Array.isArray(record.plan)
      ? (record.plan as Record<string, unknown>)
      : undefined;
  const searches = Array.isArray(record.searches)
    ? record.searches
        .filter((search): search is Record<string, unknown> => !!search && typeof search === "object" && !Array.isArray(search))
        .map((search) => ({
          accountEmail: typeof search.accountEmail === "string" ? search.accountEmail : undefined,
          mailbox: typeof search.mailbox === "string" ? search.mailbox : "INBOX",
          query: typeof search.query === "string" ? search.query : undefined,
          dateFrom: typeof search.dateFrom === "string" ? search.dateFrom : undefined,
          dateTo: typeof search.dateTo === "string" ? search.dateTo : undefined,
          resultCount: typeof search.resultCount === "number" ? search.resultCount : 0,
          errorCount: typeof search.errorCount === "number" ? search.errorCount : 0,
          identified: Array.isArray(search.identified)
            ? search.identified
                .filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
                .map((item) => ({
                  subject: typeof item.subject === "string" ? item.subject : "(no subject)",
                  from: typeof item.from === "string" ? item.from : undefined,
                  date: typeof item.date === "string" ? item.date : undefined,
                  attachmentCount: typeof item.attachmentCount === "number" ? item.attachmentCount : undefined,
                }))
            : [],
        }))
    : [];
  const evidence =
    record.evidence && typeof record.evidence === "object" && !Array.isArray(record.evidence)
      ? (record.evidence as Record<string, unknown>)
      : undefined;
  const emails = Array.isArray(evidence?.emails)
    ? evidence.emails
        .filter((email): email is Record<string, unknown> => !!email && typeof email === "object" && !Array.isArray(email))
        .map((email) => ({
          automationItemId: typeof email.automationItemId === "string"
            ? email.automationItemId as Id<"connectedEmailAutomationItems">
            : undefined,
          emailRef: typeof email.emailRef === "string" ? email.emailRef : undefined,
          mailbox: typeof email.mailbox === "string" ? email.mailbox : undefined,
          accountEmail: typeof email.accountEmail === "string" ? email.accountEmail : undefined,
          subject: typeof email.subject === "string" ? email.subject : "(no subject)",
          from: typeof email.from === "string" ? email.from : undefined,
          date: typeof email.date === "string" ? email.date : undefined,
          reason: typeof email.reason === "string" ? email.reason : undefined,
          attachments: Array.isArray(email.attachments)
            ? email.attachments
                .filter((attachment): attachment is Record<string, unknown> => !!attachment && typeof attachment === "object" && !Array.isArray(attachment))
                .map((attachment) => ({
                  filename: typeof attachment.filename === "string" ? attachment.filename : "Attachment",
                  contentType: typeof attachment.contentType === "string" ? attachment.contentType : undefined,
                  size: typeof attachment.size === "number" ? attachment.size : undefined,
                  reason: typeof attachment.reason === "string" ? attachment.reason : undefined,
                }))
            : [],
        }))
    : [];
  return {
    title: typeof record.title === "string" ? record.title : undefined,
    status: typeof record.status === "string" ? record.status : undefined,
    summary: typeof plan?.summary === "string" ? plan.summary : undefined,
    searches,
    emails,
  };
}

type MailboxTaskEmail = ReturnType<typeof normalizeMailboxTask>["emails"][number];
export type NormalizedMailboxTask = ReturnType<typeof normalizeMailboxTask>;

export function mailboxTaskDisplayName(task: NormalizedMailboxTask) {
  if (task.title?.trim()) return task.title.trim();
  const accountEmails = [
    ...task.searches.map((search) => search.accountEmail),
    ...task.emails.map((email) => email.accountEmail),
  ].filter((email): email is string => typeof email === "string" && email.trim().length > 0);
  const uniqueAccounts = Array.from(new Set(accountEmails));
  if (uniqueAccounts.length === 0) return "Mailbox search";
  if (uniqueAccounts.length === 1) return `Mailbox search - ${uniqueAccounts[0]}`;
  return `Mailbox search - ${uniqueAccounts[0]} + ${uniqueAccounts.length - 1}`;
}

function MailboxSearchAudit({ searches }: { searches: ReturnType<typeof normalizeMailboxTask>["searches"] }) {
  if (searches.length === 0) return null;
  const totalMatches = searches.reduce((total, search) => total + search.resultCount, 0);
  const totalErrors = searches.reduce((total, search) => total + search.errorCount, 0);

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <p className={`text-muted-foreground/35 ${typeStyle("label.eyebrow")}`}>
          Search audit
        </p>
        <span className={`text-muted-foreground/40 ${typeStyle("caption.default")}`}>
          {searches.length} search{searches.length === 1 ? "" : "es"} · {totalMatches} match{totalMatches === 1 ? "" : "es"}{totalErrors ? ` · ${totalErrors} error${totalErrors === 1 ? "" : "s"}` : ""}
        </span>
      </div>
      <div className="space-y-1.5">
        {searches.map((search, index) => {
          const windowText = [search.dateFrom, search.dateTo].filter(Boolean).join(" to ");
          return (
            <div key={`${search.accountEmail ?? "account"}-${search.mailbox}-${search.query ?? "all"}-${index}`} className="rounded-md border border-input bg-foreground/[0.035] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <div className={`flex flex-wrap items-center gap-1.5 text-muted-foreground/55 ${typeStyle("caption.default")}`}>
                <Badge variant="outline" className={`h-5 border-input px-1.5 text-muted-foreground/55 ${typeStyle("label.tag")}`}>
                  {search.accountEmail ?? "Mailbox"}
                </Badge>
                <span>{search.mailbox}</span>
                {windowText ? <span>· {windowText}</span> : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className={`min-w-0 truncate text-foreground/80 ${typeStyle("caption.medium")}`}>
                  {search.query ? `"${search.query}"` : "All recent mail"}
                </span>
                <span className={`shrink-0 text-muted-foreground/45 ${typeStyle("caption.default")}`}>
                  {search.resultCount} match{search.resultCount === 1 ? "" : "es"}
                </span>
              </div>
              {search.identified.length > 0 ? (
                <div className="mt-1.5 space-y-1">
                  {search.identified.map((item, itemIndex) => (
                    <div key={`${item.subject}-${itemIndex}`} className={`flex min-w-0 items-center gap-2 text-muted-foreground/55 ${typeStyle("caption.default")}`}>
                      <MailIcon className="h-3 w-3 shrink-0 text-muted-foreground/35" />
                      <span className="min-w-0 flex-1 truncate">{item.subject}</span>
                      {item.attachmentCount ? (
                        <span className="shrink-0 text-muted-foreground/35">{item.attachmentCount} att.</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MailboxTaskSummaryCard({
  artifact,
  orgId,
  threadId,
  displayName,
  mode = "summary",
  onOpen,
  isSelected = false,
  flat = false,
}: {
  artifact: ToolArtifactData;
  orgId: Id<"organizations">;
  threadId?: Id<"threads">;
  displayName: string;
  mode?: "summary" | "detail";
  onOpen?: () => void;
  isSelected?: boolean;
  flat?: boolean;
}) {
  const importPolicyAttachments = useAction(api.actions.connectedEmail.importPolicyAttachments);
  const importRequirementAttachments = useAction(api.actions.connectedEmail.importRequirementAttachments);
  const saveAttachmentsToThread = useAction(api.actions.connectedEmail.saveAttachmentsToThread);
  const readEmail = useAction(api.actions.connectedEmail.readEmail);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [readingKey, setReadingKey] = useState<string | null>(null);
  const [openEmailKey, setOpenEmailKey] = useState<string | null>(null);
  const [liveEmails, setLiveEmails] = useState<Record<string, LiveMailboxEmail>>({});

  if (artifact.type !== "mailbox_task") return null;
  const task = normalizeMailboxTask(artifact.data);
  if (!task.summary && task.searches.length === 0 && task.emails.length === 0) return null;
  const isRunning = task.status === "running";
  const needsReview = task.status === "needs_review";
  const statusLabel = isRunning
    ? "Running"
    : needsReview
      ? "Needs review"
      : undefined;

  async function handlePolicyImport(email: MailboxTaskEmail, index: number) {
    if (!email.emailRef) return;
    const filenames = email.attachments.filter(isMailboxPdfAttachment).map((attachment) => attachment.filename);
    if (filenames.length === 0) {
      toast.error("No PDF attachments found");
      return;
    }
    const key = `policy-${index}`;
    setBusyKey(key);
    try {
      const result = await importPolicyAttachments({
        orgId,
        emailRef: email.emailRef,
        filenames,
      }) as { status?: string; files?: unknown[] };
      if (result.status === "no_pdf_attachments") {
        toast.error("No PDF attachments found");
      } else {
        toast.success(`Started policy import for ${result.files?.length ?? filenames.length} file${filenames.length === 1 ? "" : "s"}`);
      }
    } catch {
      toast.error("Failed to import policy");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSaveToThread(email: MailboxTaskEmail, index: number) {
    if (!threadId || !email.emailRef) return;
    const filenames = email.attachments.map((attachment) => attachment.filename);
    if (filenames.length === 0) {
      toast.error("No attachments found");
      return;
    }
    const key = `save-${index}`;
    setBusyKey(key);
    try {
      const result = await saveAttachmentsToThread({
        orgId,
        threadId,
        emailRef: email.emailRef,
        filenames,
      }) as { status?: string; attachments?: unknown[]; skippedDuplicateFilenames?: string[] };
      if (result.status === "no_saveable_attachments") {
        toast.error("No saveable attachments found");
      } else if (result.status === "duplicate_attachments") {
        toast.info("Those documents are already saved to this thread");
      } else {
        toast.success(`Saved ${result.attachments?.length ?? filenames.length} document${filenames.length === 1 ? "" : "s"} to this thread`);
      }
    } catch {
      toast.error("Failed to save documents to thread");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRequirementImport(
    email: MailboxTaskEmail,
    index: number,
    scope: "vendors" | "own_org",
  ) {
    if (!email.emailRef) return;
    const filenames = email.attachments
      .filter(isMailboxRequirementAttachment)
      .map((attachment) => attachment.filename);
    const key = `${scope}-${index}`;
    setBusyKey(key);
    try {
      const result = await importRequirementAttachments({
        orgId,
        emailRef: email.emailRef,
        filenames: filenames.length > 0 ? filenames : undefined,
        includeEmailBody: true,
        sourceType: scope === "vendors" ? "vendor_requirements" : "other",
        scope,
      });
      const createdCount = totalCreatedRequirements(result);
      if ((result as { status?: string })?.status === "no_requirement_sources") {
        toast.error("No requirement source text found");
      } else {
        toast.success(
          createdCount > 0
            ? `Created ${createdCount} requirement${createdCount === 1 ? "" : "s"}`
            : "Requirement import finished",
        );
      }
    } catch {
      toast.error("Failed to create requirements");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleReadEmail(email: MailboxTaskEmail, index: number) {
    if (!email.emailRef) return;
    const key = email.emailRef || String(index);
    if (openEmailKey === key) {
      setOpenEmailKey(null);
      return;
    }
    if (liveEmails[key]) {
      setOpenEmailKey(key);
      return;
    }
    setReadingKey(key);
    try {
      const result = await readEmail({
        orgId,
        emailRef: email.emailRef,
      }) as Omit<LiveMailboxEmail, "attachments"> & {
        attachments?: Array<{
          filename?: string;
          contentType?: string;
          size?: number;
        }>;
      };
      const normalized: LiveMailboxEmail = {
        ...result,
        attachments: (result.attachments ?? []).map((attachment) => ({
          ...attachment,
          filename: attachment.filename?.trim() || "Attachment",
        })),
      };
      setLiveEmails((current) => ({ ...current, [key]: normalized }));
      setOpenEmailKey(key);
    } catch {
      toast.error("Failed to open email");
    } finally {
      setReadingKey(null);
    }
  }

  const totalMatches = task.searches.reduce((total, search) => total + search.resultCount, 0);
  const meta = [
    task.searches.length > 0 ? `${task.searches.length} searches` : undefined,
    task.searches.length > 0 ? `${totalMatches} matches` : undefined,
    task.emails.length > 0 ? `${task.emails.length} emails` : undefined,
  ].filter(Boolean).join(" · ");
  if (mode === "summary") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`inline-flex max-w-full items-center gap-1.5 rounded-full border bg-foreground/[0.025] px-2.5 py-1.5 text-muted-foreground/55 transition-colors ${typeStyle("label.tag")} ${
          isSelected ? "border-border-focus bg-foreground/[0.04]" : "border-input hover:border-border-hover hover:bg-foreground/[0.04]"
        }`}
      >
        {isRunning ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary-light/70" /> : <MailIcon className="h-3 w-3 shrink-0 text-muted-foreground/45" />}
        <span className="truncate">{displayName}</span>
      </button>
    );
  }

  return (
    <div className={flat ? "w-full" : "w-full overflow-hidden rounded-md border border-input bg-card"}>
      <div className={flat ? "hidden" : "flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2.5 text-left"}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-muted-foreground">
            {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MailIcon className="h-3.5 w-3.5" />}
          </span>
          <span className="min-w-0">
            <span className={`block truncate text-foreground/85 ${typeStyle("body.medium")}`}>
              {displayName}
            </span>
            {meta ? (
              <span className={`block truncate text-muted-foreground/40 ${typeStyle("caption.default")}`}>
                {meta}
              </span>
            ) : null}
          </span>
        </div>
        {statusLabel ? (
          <StatusTag tone={isRunning ? "info" : "warning"}>
            {statusLabel}
          </StatusTag>
        ) : null}
      </div>
      <div className={flat ? "space-y-4" : "space-y-3 px-3 py-3"}>
        {task.summary ? (
          <p className={`text-muted-foreground/75 ${typeStyle("caption.default")}`}>
            {task.summary}
          </p>
        ) : null}
        <MailboxSearchAudit searches={task.searches} />
        {task.emails.length > 0 ? (
          <div>
            <p className={`mb-1.5 text-muted-foreground/35 ${typeStyle("label.eyebrow")}`}>
              Email context
            </p>
            <div className="space-y-2">
              {task.emails.map((email, index) => {
                const emailKey = email.emailRef ?? String(index);
                const liveEmail = liveEmails[emailKey];
                const attachments = liveEmail?.attachments ?? email.attachments;
                const emailWithAttachments = { ...email, attachments };
                const isOpen = openEmailKey === emailKey;
                return (
                  <div key={`${email.emailRef ?? email.subject}-${index}`} className="rounded-md border border-border bg-background px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={`min-w-0 flex-1 truncate text-foreground/85 ${typeStyle("caption.medium")}`}>
                        {email.subject}
                      </span>
                      {email.accountEmail ? (
                        <Badge variant="outline" className={`h-5 border-input px-1.5 text-muted-foreground/50 ${typeStyle("label.tag")}`}>
                          {email.accountEmail}
                        </Badge>
                      ) : null}
                    </div>
                    <p className={`mt-1 truncate text-muted-foreground/45 ${typeStyle("caption.default")}`}>
                      {[
                        email.from,
                        email.mailbox,
                        email.date
                          ? formatDisplayDateTime(email.date, email.date)
                          : undefined,
                      ].filter(Boolean).join(" · ")}
                    </p>
                    {email.reason ? (
                      <p className={`mt-1 text-muted-foreground/65 ${typeStyle("caption.default")}`}>
                        {email.reason}
                      </p>
                    ) : null}
                    {attachments.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {attachments.map((attachment, attachmentIndex) => {
                          const size = formatAttachmentSize(attachment.size);
                          return (
                            <span
                              key={`${attachment.filename}-${attachmentIndex}`}
                              className={`inline-flex max-w-full items-center gap-1.5 rounded-full border border-input bg-foreground/[0.02] px-2 py-1 text-muted-foreground/65 ${typeStyle("label.tag")}`}
                            >
                              <Paperclip className="h-3 w-3 shrink-0" />
                              <span className="truncate">{attachment.filename}</span>
                              {size ? <span className="text-muted-foreground/35">{size}</span> : null}
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                    {email.emailRef ? (
                      <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border pt-2">
                        <PillButton
                          size="compact"
                          variant="iconLabel"
                          label={isOpen ? "Hide email" : "Review email"}
                          disabled={readingKey !== null}
                          onClick={() => void handleReadEmail(email, index)}
                        >
                          {readingKey === emailKey ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <MailIcon className="h-3 w-3" />
                          )}
                        </PillButton>
                        {(!needsReview || liveEmail) && threadId && attachments.length > 0 ? (
                          <PillButton
                            size="compact"
                            variant="iconLabel"
                            label="Save to thread"
                            disabled={busyKey !== null}
                            onClick={() => void handleSaveToThread(emailWithAttachments, index)}
                          >
                            {busyKey === `save-${index}` ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Paperclip className="h-3 w-3" />
                            )}
                          </PillButton>
                        ) : null}
                        {(!needsReview || liveEmail) && attachments.some(isMailboxPdfAttachment) ? (
                          <PillButton
                            size="compact"
                            variant="iconLabel"
                            label="Import policy"
                            disabled={busyKey !== null}
                            onClick={() => void handlePolicyImport(emailWithAttachments, index)}
                          >
                            {busyKey === `policy-${index}` ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <FileText className="h-3 w-3" />
                            )}
                          </PillButton>
                        ) : null}
                        {!needsReview || liveEmail ? (
                          <>
                            <PillButton
                              size="compact"
                              variant="iconLabel"
                              label="Create vendor requirements"
                              disabled={busyKey !== null}
                              onClick={() => void handleRequirementImport(emailWithAttachments, index, "vendors")}
                            >
                              {busyKey === `vendors-${index}` ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <ClipboardList className="h-3 w-3" />
                              )}
                            </PillButton>
                            <PillButton
                              size="compact"
                              variant="iconLabel"
                              label="Create internal requirements"
                              disabled={busyKey !== null}
                              onClick={() => void handleRequirementImport(emailWithAttachments, index, "own_org")}
                            >
                              {busyKey === `own_org-${index}` ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <ClipboardList className="h-3 w-3" />
                              )}
                            </PillButton>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    {isOpen && liveEmail ? (
                      <div className="mt-2 border-t border-border pt-2">
                        <dl className={`space-y-1 text-muted-foreground/55 ${typeStyle("caption.default")}`}>
                          {liveEmail.to ? (
                            <div className="flex gap-2">
                              <dt className="w-6 shrink-0 text-muted-foreground/35">To</dt>
                              <dd className="min-w-0 break-words">{liveEmail.to}</dd>
                            </div>
                          ) : null}
                          {liveEmail.cc ? (
                            <div className="flex gap-2">
                              <dt className="w-6 shrink-0 text-muted-foreground/35">Cc</dt>
                              <dd className="min-w-0 break-words">{liveEmail.cc}</dd>
                            </div>
                          ) : null}
                        </dl>
                        <div className="mt-2 max-h-72 overflow-y-auto rounded-md bg-foreground/[0.025] px-3 py-2.5">
                          <p className={`whitespace-pre-wrap text-foreground/75 ${typeStyle("caption.default")}`}>
                            {liveEmail.text?.trim() || "This email has no plain-text message body."}
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function MailboxTaskSidebar({
  artifact,
  orgId,
  threadId,
  emailIndex,
  onClose,
}: {
  artifact: ToolArtifactData;
  orgId: Id<"organizations">;
  threadId: Id<"threads">;
  emailIndex?: number;
  onClose: () => void;
}) {
  const task = normalizeMailboxTask(artifact.data);
  const selectedReviewEmail = task.status === "needs_review"
    ? task.emails[emailIndex ?? 0]
    : undefined;
  if (selectedReviewEmail) {
    return (
      <MailboxEmailReviewSidebar
        key={selectedReviewEmail.automationItemId ?? selectedReviewEmail.emailRef}
        email={selectedReviewEmail}
        orgId={orgId}
        threadId={threadId}
        onClose={onClose}
      />
    );
  }
  const isRunning = task.status === "running";
  const statusLabel = isRunning
    ? "Running"
    : task.status === "needs_review"
      ? "Needs review"
      : undefined;
  const displayName = mailboxTaskDisplayName(task);
  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-l border-input bg-background">
      <div className="flex h-12 items-center justify-between gap-3 border-b border-input px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className={`truncate text-foreground ${typeStyle("heading.micro")}`}>{displayName}</h2>
          {statusLabel ? (
            <StatusTag
              tone={isRunning ? "info" : "warning"}
              className="shrink-0"
            >
              {statusLabel}
            </StatusTag>
          ) : null}
        </div>
        <PillButton size="compact" variant="icon" onClick={onClose} label="Close mailbox search">
          <X className="h-4 w-4" />
        </PillButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <MailboxTaskSummaryCard
          artifact={artifact}
          orgId={orgId}
          threadId={threadId}
          displayName={displayName}
          mode="detail"
          flat
        />
      </div>
    </aside>
  );
}
