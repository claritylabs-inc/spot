"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { ClipboardList, FileText, Mail as MailIcon, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import type { ToolArtifactData } from "../types";
import { formatDisplayDateTime } from "@/lib/date-format";
import {
  formatAttachmentSize,
  isMailboxPdfAttachment,
  MailboxEmailReviewSidebar,
  normalizeLiveEmail,
  useMailboxImports,
  type LiveMailboxEmail,
} from "./mailbox-email-review-sidebar";
import { asNumber, asRecord, asRecords, asString } from "./normalize";
import { ActionPill, ArtifactSidebar, useBusyKey } from "./shell";
import { typeStyle } from "@/lib/typography";

export function normalizeMailboxTask(data: unknown) {
  const record = asRecord(data) ?? {};
  return {
    title: asString(record.title),
    status: asString(record.status),
    summary: asString(asRecord(record.plan)?.summary),
    searches: asRecords(record.searches).map((search) => ({
      accountEmail: asString(search.accountEmail),
      mailbox: asString(search.mailbox) ?? "INBOX",
      query: asString(search.query),
      dateFrom: asString(search.dateFrom),
      dateTo: asString(search.dateTo),
      resultCount: asNumber(search.resultCount) ?? 0,
      errorCount: asNumber(search.errorCount) ?? 0,
      identified: asRecords(search.identified).map((item) => ({
        subject: asString(item.subject) ?? "(no subject)",
        from: asString(item.from),
        date: asString(item.date),
        attachmentCount: asNumber(item.attachmentCount),
      })),
    })),
    emails: asRecords(asRecord(record.evidence)?.emails).map((email) => ({
      automationItemId: asString(email.automationItemId) as
        | Id<"connectedEmailAutomationItems">
        | undefined,
      emailRef: asString(email.emailRef),
      mailbox: asString(email.mailbox),
      accountEmail: asString(email.accountEmail),
      subject: asString(email.subject) ?? "(no subject)",
      from: asString(email.from),
      date: asString(email.date),
      reason: asString(email.reason),
      attachments: asRecords(email.attachments).map((attachment) => ({
        filename: asString(attachment.filename) ?? "Attachment",
        contentType: asString(attachment.contentType),
        size: asNumber(attachment.size),
        reason: asString(attachment.reason),
      })),
    })),
  };
}

export type NormalizedMailboxTask = ReturnType<typeof normalizeMailboxTask>;

/** An email row whose attachments may come from the live read instead. */
type MailboxTaskEmail = {
  emailRef?: string;
  attachments: LiveMailboxEmail["attachments"];
};

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

function MailboxSearchAudit({ searches }: { searches: NormalizedMailboxTask["searches"] }) {
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

function MailboxTaskDetail({
  task,
  orgId,
  threadId,
}: {
  task: NormalizedMailboxTask;
  orgId: Id<"organizations">;
  threadId: Id<"threads">;
}) {
  const { importPolicy, importRequirements } = useMailboxImports(orgId);
  const saveAttachmentsToThread = useAction(api.actions.connectedEmail.saveAttachmentsToThread);
  const readEmail = useAction(api.actions.connectedEmail.readEmail);
  const { busyKey, runBusy } = useBusyKey();
  const [readingKey, setReadingKey] = useState<string | null>(null);
  const [openEmailKey, setOpenEmailKey] = useState<string | null>(null);
  const [liveEmails, setLiveEmails] = useState<Record<string, LiveMailboxEmail>>({});

  if (!task.summary && task.searches.length === 0 && task.emails.length === 0) return null;
  const needsReview = task.status === "needs_review";

  function handlePolicyImport(email: MailboxTaskEmail, index: number) {
    if (!email.emailRef) return;
    const emailRef = email.emailRef;
    if (!email.attachments.some(isMailboxPdfAttachment)) {
      toast.error("No PDF attachments found");
      return;
    }
    void runBusy(`policy-${index}`, async () => {
      const result = await importPolicy(emailRef, email.attachments);
      if (result.status === "no_pdf_attachments") {
        toast.error("No PDF attachments found");
      } else {
        toast.success(result.started);
      }
    }, "Failed to import policy");
  }

  function handleSaveToThread(email: MailboxTaskEmail, index: number) {
    if (!email.emailRef) return;
    const emailRef = email.emailRef;
    const filenames = email.attachments.map((attachment) => attachment.filename);
    if (filenames.length === 0) {
      toast.error("No attachments found");
      return;
    }
    void runBusy(`save-${index}`, async () => {
      const result = await saveAttachmentsToThread({
        orgId,
        threadId,
        emailRef,
        filenames,
      }) as { status?: string; attachments?: unknown[]; skippedDuplicateFilenames?: string[] };
      if (result.status === "no_saveable_attachments") {
        toast.error("No saveable attachments found");
      } else if (result.status === "duplicate_attachments") {
        toast.info("Those documents are already saved to this thread");
      } else {
        toast.success(`Saved ${result.attachments?.length ?? filenames.length} document${filenames.length === 1 ? "" : "s"} to this thread`);
      }
    }, "Failed to save documents to thread");
  }

  function handleRequirementImport(
    email: MailboxTaskEmail,
    index: number,
    scope: "vendors" | "own_org",
  ) {
    if (!email.emailRef) return;
    const emailRef = email.emailRef;
    void runBusy(`${scope}-${index}`, async () => {
      const { status, createdCount } = await importRequirements(
        emailRef,
        email.attachments,
        scope,
      );
      if (status === "no_requirement_sources") {
        toast.error("No requirement source text found");
      } else {
        toast.success(
          createdCount > 0
            ? `Created ${createdCount} requirement${createdCount === 1 ? "" : "s"}`
            : "Requirement import finished",
        );
      }
    }, "Failed to create requirements");
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
      const normalized = normalizeLiveEmail(
        await readEmail({ orgId, emailRef: email.emailRef }),
      );
      setLiveEmails((current) => ({ ...current, [key]: normalized }));
      setOpenEmailKey(key);
    } catch {
      toast.error("Failed to open email");
    } finally {
      setReadingKey(null);
    }
  }

  return (
    <div className="space-y-4">
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
              const actionable = !needsReview || Boolean(liveEmail);
              const emailActions = [
                {
                  key: "save",
                  label: "Save to thread",
                  icon: Paperclip,
                  show: actionable && attachments.length > 0,
                  run: handleSaveToThread,
                },
                {
                  key: "policy",
                  label: "Import policy",
                  icon: FileText,
                  show: actionable && attachments.some(isMailboxPdfAttachment),
                  run: handlePolicyImport,
                },
                {
                  key: "vendors",
                  label: "Create vendor requirements",
                  icon: ClipboardList,
                  show: actionable,
                  run: (target: MailboxTaskEmail, at: number) =>
                    handleRequirementImport(target, at, "vendors"),
                },
                {
                  key: "own_org",
                  label: "Create internal requirements",
                  icon: ClipboardList,
                  show: actionable,
                  run: (target: MailboxTaskEmail, at: number) =>
                    handleRequirementImport(target, at, "own_org"),
                },
              ];
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
                      <ActionPill
                        size="compact"
                        variant="iconLabel"
                        label={isOpen ? "Hide email" : "Review email"}
                        disabled={readingKey !== null}
                        onClick={() => void handleReadEmail(email, index)}
                        busy={readingKey === emailKey}
                        icon={MailIcon}
                        iconClassName="h-3 w-3"
                      />
                      {emailActions
                        .filter(({ show }) => show)
                        .map(({ key, label, icon, run }) => (
                          <ActionPill
                            key={key}
                            size="compact"
                            variant="iconLabel"
                            label={label}
                            disabled={busyKey !== null}
                            onClick={() => run(emailWithAttachments, index)}
                            busy={busyKey === `${key}-${index}`}
                            icon={icon}
                            iconClassName="h-3 w-3"
                          />
                        ))}
                    </div>
                  ) : null}
                  {isOpen && liveEmail ? (
                    <div className="mt-2 border-t border-border pt-2">
                      <dl className={`space-y-1 text-muted-foreground/55 ${typeStyle("caption.default")}`}>
                        {[["To", liveEmail.to], ["Cc", liveEmail.cc]].map(([label, value]) =>
                          value ? (
                            <div key={label} className="flex gap-2">
                              <dt className="w-6 shrink-0 text-muted-foreground/35">{label}</dt>
                              <dd className="min-w-0 break-words">{value}</dd>
                            </div>
                          ) : null,
                        )}
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
  return (
    <ArtifactSidebar
      title={mailboxTaskDisplayName(task)}
      status={
        statusLabel ? (
          <StatusTag tone={isRunning ? "info" : "warning"} className="shrink-0">
            {statusLabel}
          </StatusTag>
        ) : null
      }
      closeLabel="Close mailbox search"
      onClose={onClose}
    >
      {artifact.type === "mailbox_task" ? (
        <MailboxTaskDetail task={task} orgId={orgId} threadId={threadId} />
      ) : null}
    </ArtifactSidebar>
  );
}
