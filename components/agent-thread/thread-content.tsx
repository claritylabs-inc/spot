"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { stableHash } from "@claritylabs/cl-sync";
import { useStickToBottom } from "use-stick-to-bottom";
import dayjs from "dayjs";
import JSZip from "jszip";
import { toast } from "sonner";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  Archive,
  ArchiveRestore,
  Check,
  CheckCheck,
  FileText,
  ExternalLink,
  LockKeyhole,
  Mail as MailIcon,
  MessageCircle,
  Copy,
  RotateCcw,
  X,
  Clock,
  Download,
  Paperclip,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { SiSlack } from "react-icons/si";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";
import { createClientMutationId } from "@/lib/sync/client-mutation-id";
import { useMediaQuery } from "@/components/app-sidebar/utils";
import { stripConfidenceMarkers } from "@/lib/confidence";
import {
  useArchivedThreadCacheActions,
  useCachedAgentTargets,
  useThreadCacheActions,
} from "@/lib/sync/spot-cached-queries";
import { Button } from "@/components/ui/button";
import { MessageMetaTag } from "@/components/ui/message-meta-tag";
import { PillButton } from "@/components/ui/pill-button";
import { StatusTag } from "@/components/ui/status-tag";
import { QuotedContent } from "@/components/conversation-message";
import { EditableBreadcrumbTitle } from "@/components/editable-breadcrumb-title";
import {
  ContextReferenceCard,
  PolicyReferenceCard,
  PolicySourcePill,
} from "@/components/context-reference-card";
import {
  ChatInputOverlay,
  SpotPromptInput,
  type SpotPromptInputHandle,
} from "@/components/spot-prompt-input";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { ProseMarkdown } from "@/components/prose-markdown";
import { NewChatEmptyState } from "@/components/new-chat-empty-state";
import { LogoIcon } from "@/components/ui/logo-icon";
import {
  PromptReferenceText,
  type PromptReference,
  type PromptReferenceTagKind,
} from "@/components/prompt-reference-tag";
import { ThreadAttachmentChip } from "@/components/agent-thread/thread-attachment-chip";
import { usePdf } from "@/components/pdf-context";
import { ThreadMessageBubble } from "@/components/agent-thread/message-bubble";
import { AgentThinkingBubble } from "@/components/agent-thread/agent-thinking-bubble";
import { formatDisplayDateTime } from "@/lib/date-format";
import {
  optimisticPromptAttachments,
  promptReferenceIds,
  uploadPromptFiles,
} from "@/lib/thread-prompt";
import { getThreadDisplayLabel } from "@/lib/thread-display";
import type {
  MailboxArtifactRef,
  ThreadAttachment,
  ThreadMessage,
  ToolArtifactData,
  VendorComplianceArtifactRef,
} from "@/components/agent-thread/types";
import {
  CertificateHoldArtifacts,
  EmailStackCard,
  EmailSummaryCard,
  EmailThreadSidebar,
  MailboxTaskSidebar,
  VendorComplianceArtifacts,
  VendorComplianceSidebar,
  mailboxTaskDisplayName,
  normalizeMailboxTask,
} from "@/components/agent-thread/artifacts";
import { typeStyle } from "@/lib/typography";

/* ═══════════════════════════════════════════════════
   Unified Thread View (new threads table)
   ═══════════════════════════════════════════════════ */

export type AssistantPdfAttachment = {
  key: string;
  messageId: Id<"threadMessages">;
  fileId: Id<"_storage">;
};

// This cache only interns immutable query records; it never drives rendering.
/* eslint-disable react-hooks/refs */
function useStableMessages(messages: ThreadMessage[] | undefined) {
  const cacheRef = useRef(
    new Map<string, { hash: string; message: ThreadMessage }>(),
  );
  const stableMessagesRef = useRef<ThreadMessage[] | undefined>(undefined);

  return useMemo(() => {
    if (!messages) {
      cacheRef.current = new Map();
      stableMessagesRef.current = undefined;
      return undefined;
    }

    const previousMessages = stableMessagesRef.current;
    const nextCache = new Map<
      string,
      { hash: string; message: ThreadMessage }
    >();
    let changed = previousMessages?.length !== messages.length;
    const nextMessages = messages.map((message, index) => {
      const hash = stableHash(message);
      const cached = cacheRef.current.get(message._id);
      const stableMessage = cached?.hash === hash ? cached.message : message;
      nextCache.set(message._id, { hash, message: stableMessage });
      if (previousMessages?.[index] !== stableMessage) changed = true;
      return stableMessage;
    });

    cacheRef.current = nextCache;
    if (!changed && previousMessages) return previousMessages;
    stableMessagesRef.current = nextMessages;
    return nextMessages;
  }, [messages]);
}
/* eslint-enable react-hooks/refs */

export function assistantPdfAttachments(
  messages: ThreadMessage[] | undefined,
): AssistantPdfAttachment[] {
  return (messages ?? []).flatMap((message) => {
    if (message.role !== "agent" || message.channel === "email") return [];
    return (message.attachments ?? []).flatMap((attachment) =>
      attachment.fileId && attachment.contentType === "application/pdf"
        ? [{
            key: `${message._id}:${attachment.fileId}`,
            messageId: message._id,
            fileId: attachment.fileId,
          }]
        : [],
    );
  });
}

function uniqueZipFilename(filename: string, usedNames: Set<string>) {
  const trimmed = filename.trim() || "attachment";
  if (!usedNames.has(trimmed)) {
    usedNames.add(trimmed);
    return trimmed;
  }

  const dotIndex = trimmed.lastIndexOf(".");
  const hasExtension = dotIndex > 0;
  const basename = hasExtension ? trimmed.slice(0, dotIndex) : trimmed;
  const extension = hasExtension ? trimmed.slice(dotIndex) : "";
  let index = 2;
  let candidate = `${basename} (${index})${extension}`;
  while (usedNames.has(candidate)) {
    index += 1;
    candidate = `${basename} (${index})${extension}`;
  }
  usedNames.add(candidate);
  return candidate;
}

function messageSenderName(message: ThreadMessage) {
  if (message.operatorInitiated) {
    return message.operatorInitiated.displayLabel;
  }
  if (message.channel === "imessage") {
    return (
      message.imessageParticipantLabel ??
      message.userName ??
      message.imessageSenderAddress ??
      "iMessage participant"
    );
  }
  return message.userName ?? message.fromName ?? message.fromEmail ?? "User";
}

type AgentTargets = NonNullable<ReturnType<typeof useCachedAgentTargets>>;

function targetLabel(
  targets: AgentTargets | undefined,
  kind: PromptReferenceTagKind,
  id: string,
) {
  if (!targets) return undefined;
  if (kind === "policy") {
    return targets.policies.find((target) => target.id === id)?.label;
  }
  if (kind === "requirement") {
    return targets.requirements.find((target) => target.id === id)?.label;
  }
  return targets.mailboxes.find((target) => target.id === id)?.label;
}

function threadContextReferenceLabel(
  context: { pageType: string; entityId?: string; summary?: string } | undefined,
  kind: PromptReferenceTagKind,
  id: string,
) {
  if (!context?.entityId || context.entityId !== id) return undefined;
  if (kind === "policy" && context.pageType === "policy") {
    return context.summary ?? "Current policy";
  }
  if (kind === "requirement" && context.pageType === "requirement") {
    return context.summary ?? "Current requirement";
  }
  return undefined;
}

function messagePromptReferences(
  message: ThreadMessage,
  targets: AgentTargets | undefined,
  context?: { pageType: string; entityId?: string; summary?: string },
) {
  const references: PromptReference[] = [];
  const seen = new Set<string>();
  const add = (kind: PromptReferenceTagKind, ids?: string[]) => {
    ids?.forEach((id) => {
      const key = `${kind}:${id}`;
      if (seen.has(key)) return;
      const label =
        threadContextReferenceLabel(context, kind, id) ??
        targetLabel(targets, kind, id);
      if (!label) return;
      seen.add(key);
      references.push({ kind, id, label });
    });
  };

  add("policy", message.referencedPolicyIds);
  add("requirement", message.referencedRequirementIds);
  add("mailbox", message.referencedMailboxIds);

  return references;
}

function ThreadAttachmentList({
  attachments,
  threadId,
  rightAligned,
}: {
  attachments: ThreadAttachment[];
  threadId: Id<"threads">;
  rightAligned?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const fileIds = useMemo(
    () =>
      attachments
        .map((attachment) => attachment.fileId)
        .filter((fileId): fileId is Id<"_storage"> => Boolean(fileId)),
    [attachments],
  );
  const urls = useCachedQuery(
    "threads.getAttachmentUrls.list",
    api.threads.getAttachmentUrls,
    fileIds.length > 1 ? { threadId, fileIds } : "skip",
  );

  const handleDownloadAll = useCallback(async () => {
    if (!urls?.length) return;
    setIsDownloadingAll(true);
    try {
      const zip = new JSZip();
      const usedNames = new Set<string>();
      for (const entry of urls) {
        const attachment = attachments.find(
          (att) => att.fileId === entry.fileId,
        );
        const filename = uniqueZipFilename(
          attachment?.filename ?? "attachment",
          usedNames,
        );
        const response = await fetch(entry.url);
        if (!response.ok) {
          throw new Error(
            `Failed to download ${attachment?.filename ?? entry.fileId}`,
          );
        }
        zip.file(filename, await response.blob());
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "thread-attachments.zip";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      toast.error("Failed to download attachments");
    } finally {
      setIsDownloadingAll(false);
    }
  }, [attachments, urls]);

  if (attachments.length === 0) return null;

  if (attachments.length === 1) {
    return (
      <ThreadAttachmentChip
        attachment={attachments[0]}
        threadId={threadId}
        className="w-fit"
      />
    );
  }

  return (
    <>
      <MessageMetaTag
        icon={<Paperclip />}
        label="Files"
        count={attachments.length}
        isActive={isExpanded}
        onClick={() => setIsExpanded((value) => !value)}
      />
      {isExpanded ? (
        <div
          className={`flex min-w-0 basis-full flex-wrap items-start gap-1.5 ${
            rightAligned ? "justify-end" : ""
          }`}
        >
          {attachments.map((att, i) => (
            <span
              key={`${att.fileId ?? att.filename}-${i}`}
              className="min-w-0"
            >
              <ThreadAttachmentChip
                attachment={att}
                threadId={threadId}
                className="w-fit"
              />
            </span>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDownloadAll}
            disabled={!urls?.length || isDownloadingAll}
            className={`h-6 shrink-0 gap-1.5 rounded-full px-2 text-muted-foreground/60 hover:bg-foreground/3 hover:text-foreground ${typeStyle("label.tag")}`}
          >
            <Download className="h-3.5 w-3.5" />
            {isDownloadingAll ? "Preparing..." : "Download all"}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function findRelatedEmailMessages(
  messages: ThreadMessage[],
  message: ThreadMessage,
  attachedEmailMessageIds: Set<string>,
) {
  if (
    message.role !== "agent" ||
    message.pendingEmailId === undefined ||
    message.messageKind === "channel_sync"
  ) {
    return [];
  }

  const linked = messages.find(
    (candidate) =>
      candidate.channel === "email" &&
      candidate.role === "agent" &&
      candidate.pendingEmailId === message.pendingEmailId &&
      candidate._id !== message._id,
  );
  return linked && !attachedEmailMessageIds.has(linked._id) ? [linked] : [];
}

type ThreadMessageRenderPlan = {
  attachedEmailMessageIds: Set<string>;
  firstUserMessageId?: string;
  hiddenStatusMessageIds: Set<string>;
  relatedEmailsByMessageId: Map<string, ThreadMessage[]>;
};

type WebMessageReceiptStatus = "delivered" | "read";

function isMessageFromViewer(
  message: ThreadMessage,
  viewerId?: string,
  viewerEmail?: string,
) {
  return Boolean(
    (viewerId && message.userId === viewerId) ||
      (viewerEmail &&
        message.fromEmail?.toLowerCase() === viewerEmail.toLowerCase()),
  );
}

export function latestOwnWebMessageReceipt(
  messages: ThreadMessage[],
  viewerId?: string,
  viewerEmail?: string,
): { messageId: Id<"threadMessages">; status: WebMessageReceiptStatus } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role !== "user" ||
      message.channel !== "chat" ||
      !isMessageFromViewer(message, viewerId, viewerEmail)
    ) {
      continue;
    }

    const reply = messages.find(
      (candidate) => candidate.replyToMessageId === message._id,
    );
    const isOptimistic = String(message._id).includes(":local:");
    if (isOptimistic) return null;

    const status: WebMessageReceiptStatus =
      reply?.agentRunStartedAt != null ||
      (reply != null && reply.status !== "processing")
        ? "read"
        : "delivered";
    return { messageId: message._id, status };
  }
  return null;
}

function buildThreadMessageRenderPlan(
  messages: ThreadMessage[],
): ThreadMessageRenderPlan {
  const attachedEmailMessageIds = new Set<string>();
  const hiddenStatusMessageIds = new Set<string>();
  const relatedEmailsByMessageId = new Map<string, ThreadMessage[]>();

  messages.forEach((message) => {
    if (message.status === "processing") return;
    // Email cards already own review and send; keep their confirmation cue persisted without duplicating it in the thread.
    if (
      message.messageKind === "channel_sync" ||
      (message.messageKind === "workflow_status" && message.pendingEmailId)
    ) {
      hiddenStatusMessageIds.add(message._id);
      return;
    }

    const relatedEmailMessages = findRelatedEmailMessages(
      messages,
      message,
      attachedEmailMessageIds,
    );
    if (relatedEmailMessages.length === 0) return;
    relatedEmailsByMessageId.set(message._id, relatedEmailMessages);
    relatedEmailMessages.forEach((emailMessage) =>
      attachedEmailMessageIds.add(emailMessage._id),
    );
  });

  return {
    attachedEmailMessageIds,
    firstUserMessageId: messages.find((message) => message.role === "user")
      ?._id,
    hiddenStatusMessageIds,
    relatedEmailsByMessageId,
  };
}

export function threadMessageGroupingFingerprint(
  threadId: Id<"threads">,
  messages: ThreadMessage[],
) {
  return `${threadId}:${messages
    .map((message) => {
      if (message.status === "processing") {
        return `${message._id}:processing`;
      }
      if (message.channel === "email") {
        return `${message._id}:${stableHash(message)}`;
      }
      return `${message._id}:${stableHash({
        channel: message.channel,
        content: message.content,
        creationTime: message._creationTime,
        pendingEmailId: message.pendingEmailId,
        role: message.role,
        status: message.status,
        toAddresses: message.toAddresses,
      })}`;
    })
    .join("|")}`;
}

const EMPTY_RELATED_EMAIL_MESSAGES: ThreadMessage[] = [];

function EmailRecipientMeta({
  toAddresses,
  ccAddresses,
}: {
  toAddresses?: string[];
  ccAddresses?: string[];
}) {
  if (!toAddresses?.length) return null;
  const ccCount = ccAddresses?.length ?? 0;

  return (
    <span className={`min-w-0 truncate text-muted-foreground/30 ${typeStyle("caption.default")}`}>
      <span className="text-muted-foreground/22">to</span>{" "}
      <span className="text-muted-foreground/38">{toAddresses.join(", ")}</span>
      {ccCount > 0 ? (
        <span className="text-muted-foreground/28"> +{ccCount} cc</span>
      ) : null}
    </span>
  );
}

function MessageFooterActions({
  refs,
  citedSections,
  citedCoverageNames,
  citedSourceSpanIds,
  attachments,
  threadId,
  mailboxArtifacts,
  messageId,
  onOpenMailboxArtifact,
  openMailboxArtifactRef,
  copyContent,
  retryMessageId,
  rightAligned,
}: {
  refs: { type: "policy"; id: string; page?: number }[];
  citedSections?: string[];
  citedCoverageNames?: string[];
  citedSourceSpanIds?: string[];
  attachments?: ThreadAttachment[];
  threadId: Id<"threads">;
  mailboxArtifacts?: ToolArtifactData[];
  messageId?: Id<"threadMessages">;
  onOpenMailboxArtifact?: (ref: MailboxArtifactRef) => void;
  openMailboxArtifactRef?: MailboxArtifactRef | null;
  copyContent?: string;
  retryMessageId?: Id<"threadMessages">;
  rightAligned?: boolean;
}) {
  const [isMailboxExpanded, setIsMailboxExpanded] = useState(false);
  const [isSourcesExpanded, setIsSourcesExpanded] = useState(true);
  const [isAttachmentExpanded, setIsAttachmentExpanded] = useState(false);
  const [isDownloadingAttachments, setIsDownloadingAttachments] =
    useState(false);
  const attachmentList = useMemo(() => attachments ?? [], [attachments]);
  const hasAttachments = attachmentList.length > 0;
  const attachmentFileIds = useMemo(
    () =>
      attachmentList
        .map((attachment) => attachment.fileId)
        .filter((fileId): fileId is Id<"_storage"> => Boolean(fileId)),
    [attachmentList],
  );
  const attachmentUrls = useCachedQuery(
    "threads.getAttachmentUrls.message",
    api.threads.getAttachmentUrls,
    attachmentFileIds.length > 1
      ? { threadId, fileIds: attachmentFileIds }
      : "skip",
  );
  const mailboxTasks =
    mailboxArtifacts?.filter((artifact) => artifact.type === "mailbox_task") ??
    [];
  const mailboxTaskEntries = mailboxTasks.map((artifact, index) => ({
    artifact,
    index,
    task: normalizeMailboxTask(artifact.data),
  }));
  const mailboxReviewEmails = mailboxTaskEntries.flatMap(({ index, task }) =>
    task.status === "needs_review"
      ? task.emails.map((email, emailIndex) => ({ index, emailIndex, email }))
      : [],
  );
  const backgroundMailboxIndexes = mailboxTaskEntries
    .filter(({ task }) => task.status !== "needs_review")
    .map(({ index }) => index);
  const hasMailboxTasks = mailboxTasks.length > 0;
  const selectedMailboxIndex =
    openMailboxArtifactRef?.messageId === messageId
      ? (openMailboxArtifactRef?.index ?? null)
      : null;
  const selectedMailboxEmailIndex =
    openMailboxArtifactRef?.messageId === messageId
      ? (openMailboxArtifactRef?.emailIndex ?? null)
      : null;
  if (
    refs.length === 0 &&
    !hasAttachments &&
    !hasMailboxTasks &&
    !copyContent?.trim() &&
    !retryMessageId &&
    !messageId
  )
    return null;

  const handleDownloadAttachments = async () => {
    if (!attachmentUrls?.length) return;
    setIsDownloadingAttachments(true);
    try {
      const zip = new JSZip();
      const usedNames = new Set<string>();
      for (const entry of attachmentUrls) {
        const attachment = attachmentList.find(
          (att) => att.fileId === entry.fileId,
        );
        const filename = uniqueZipFilename(
          attachment?.filename ?? "attachment",
          usedNames,
        );
        const response = await fetch(entry.url);
        if (!response.ok) {
          throw new Error(
            `Failed to download ${attachment?.filename ?? entry.fileId}`,
          );
        }
        zip.file(filename, await response.blob());
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "thread-attachments.zip";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      toast.error("Failed to download attachments");
    } finally {
      setIsDownloadingAttachments(false);
    }
  };

  const renderMailboxAgentPill = (index: number) => {
    const label = mailboxTaskDisplayName(
      normalizeMailboxTask(mailboxTasks[index].data),
    );
    const isSelected = selectedMailboxIndex === index;
    return (
      <button
        type="button"
        onClick={() => {
          if (!messageId) return;
          onOpenMailboxArtifact?.({ messageId, index });
        }}
        className={`inline-flex h-6 max-w-52 items-center justify-center gap-1.5 rounded-full border bg-transparent px-2 transition-colors ${typeStyle("label.tag")} ${
          isSelected
            ? "border-border-focus bg-foreground/[0.04] text-foreground/75"
            : "border-input text-muted-foreground/60 hover:border-border-emphasized hover:bg-foreground/3 hover:text-foreground/75"
        }`}
      >
        <span className="text-muted-foreground/35">{index + 1}</span>
        <span className="truncate">{label}</span>
      </button>
    );
  };

  const renderMailboxReviewPill = ({
    index,
    emailIndex,
    email,
  }: (typeof mailboxReviewEmails)[number]) => {
    const isSelected =
      selectedMailboxIndex === index && selectedMailboxEmailIndex === emailIndex;
    return (
      <PillButton
        size="compact"
        variant="secondary"
        label={`Review ${email.subject}`}
        title={email.subject}
        onClick={() => {
          if (!messageId) return;
          onOpenMailboxArtifact?.({ messageId, index, emailIndex });
        }}
        className={`h-6 max-w-64 px-2 ${
          isSelected
            ? "border-border-focus bg-foreground/[0.04] text-foreground/75"
            : "text-muted-foreground/60"
        }`}
      >
        <MailIcon className="h-3 w-3" />
        <span className="truncate">{email.subject}</span>
      </PillButton>
    );
  };

  return (
    <div className="mt-1.5 min-w-0">
      <div className="flex items-start gap-2">
        <div
          className={`flex min-w-0 flex-1 flex-wrap items-center gap-1.5 ${rightAligned ? "justify-end" : ""}`}
        >
          {refs.length > 0 && (
            <>
              <MessageMetaTag
                icon={<FileText />}
                label={refs.length === 1 ? "Source" : "Sources"}
                count={refs.length}
                isActive={isSourcesExpanded}
                onClick={() => setIsSourcesExpanded((value) => !value)}
              />
              {isSourcesExpanded
                ? refs.map((ref) => (
                    <span key={`${ref.type}:${ref.id}`}>
                      <PolicySourcePill
                        id={ref.id}
                        page={ref.page}
                        citedSections={citedSections}
                        citedCoverageNames={citedCoverageNames}
                        citedSourceSpanIds={citedSourceSpanIds}
                      />
                    </span>
                  ))
                : null}
            </>
          )}
          {attachmentList.length === 1 ? (
            <ThreadAttachmentChip
              attachment={attachmentList[0]}
              threadId={threadId}
              className="w-fit"
            />
          ) : attachmentList.length > 1 ? (
            <MessageMetaTag
              icon={<Paperclip />}
              label="Files"
              count={attachmentList.length}
              isActive={isAttachmentExpanded}
              onClick={() => setIsAttachmentExpanded((value) => !value)}
            />
          ) : null}
          {mailboxReviewEmails.map((entry) => (
            <span key={`mailbox-review-${entry.index}-${entry.emailIndex}`}>
              {renderMailboxReviewPill(entry)}
            </span>
          ))}
          {backgroundMailboxIndexes.length === 1 ? (
            renderMailboxAgentPill(backgroundMailboxIndexes[0])
          ) : backgroundMailboxIndexes.length > 1 ? (
            <>
              <MessageMetaTag
                icon={<LogoIcon size={12} static className="h-3 w-3" />}
                label="Mailbox tasks"
                count={backgroundMailboxIndexes.length}
                isActive={isMailboxExpanded}
                onClick={() => setIsMailboxExpanded((value) => !value)}
              />
              {isMailboxExpanded ? (
                <div className="flex flex-wrap items-start gap-1.5">
                  {backgroundMailboxIndexes.map((index) => {
                    return (
                      <span key={`mailbox-footer-${index}`}>
                        {renderMailboxAgentPill(index)}
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {messageId ? <ResponseRatingButtons messageId={messageId} /> : null}
          {retryMessageId ? (
            <TryAgainMessageButton messageId={retryMessageId} />
          ) : null}
          {copyContent?.trim() ? (
            <CopyMessageButton content={copyContent} />
          ) : null}
        </div>
      </div>
      {attachmentList.length > 1 && isAttachmentExpanded ? (
        <div
          className={`mt-1.5 flex w-full min-w-0 flex-wrap items-start gap-1.5 ${
            rightAligned ? "justify-end" : ""
          }`}
        >
          {attachmentList.map((att, i) => (
            <span
              key={`${att.fileId ?? att.filename}-${i}`}
              className="min-w-0"
            >
              <ThreadAttachmentChip
                attachment={att}
                threadId={threadId}
                className="w-fit"
              />
            </span>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDownloadAttachments}
            disabled={!attachmentUrls?.length || isDownloadingAttachments}
            className={`h-6 shrink-0 gap-1.5 rounded-full px-2 text-muted-foreground/60 hover:bg-foreground/3 hover:text-foreground ${typeStyle("label.tag")}`}
          >
            <Download className="h-3.5 w-3.5" />
            {isDownloadingAttachments ? "Preparing..." : "Download all"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ResponseRatingButtons({
  messageId,
}: {
  messageId: Id<"threadMessages">;
}) {
  const submitFeedback = useAction(
    api.actions.agentResponseFeedback.submit,
  );
  const existingFeedback = useQuery(
    api.agentResponseFeedback.getForMessage,
    { messageId },
  ) as { rating: "positive" | "negative" } | null | undefined;
  const [rating, setRating] = useState<"positive" | "negative" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const effectiveRating = rating ?? existingFeedback?.rating ?? null;

  const submit = async (nextRating: "positive" | "negative") => {
    if (effectiveRating || submitting) return;
    setSubmitting(true);
    try {
      const result = await submitFeedback({ messageId, rating: nextRating });
      setRating(result.rating);
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Feedback could not be saved"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex items-center gap-0.5" aria-label="Rate this response">
      <PillButton
        type="button"
        variant="icon"
        size="compact"
        iconOnly
        label="Good response"
        disabled={submitting || existingFeedback === undefined || effectiveRating !== null}
        aria-pressed={effectiveRating === "positive"}
        className={effectiveRating === "positive" ? "bg-foreground/[0.06] text-foreground" : undefined}
        onClick={() => submit("positive")}
      >
        <ThumbsUp className="size-3.5" />
      </PillButton>
      <PillButton
        type="button"
        variant="icon"
        size="compact"
        iconOnly
        label="Poor response"
        disabled={submitting || existingFeedback === undefined || effectiveRating !== null}
        aria-pressed={effectiveRating === "negative"}
        className={effectiveRating === "negative" ? "bg-foreground/[0.06] text-foreground" : undefined}
        onClick={() => submit("negative")}
      >
        <ThumbsDown className="size-3.5" />
      </PillButton>
    </div>
  );
}

/* ── Unified thread actions ── */
function UnifiedThreadActions({
  threadId,
  thread,
  messages,
}: {
  threadId: Id<"threads">;
  thread: {
    title: string;
    archivedAt?: number;
    originChannel?: "chat" | "email" | "imessage" | "slack";
    threadEmail?: string;
  };
  messages?: ThreadMessage[];
}) {
  const archiveThread = useMutation(api.threads.archive);
  const unarchiveThread = useMutation(api.threads.unarchive);
  const { archiveThreadLocally, unarchiveThreadLocally } =
    useArchivedThreadCacheActions();
  const isArchived = !!thread.archivedAt;
  async function handleArchiveToggle() {
    try {
      if (isArchived) {
        await unarchiveThreadLocally(threadId);
        await unarchiveThread({ id: threadId });
        toast.success("Unarchived");
      } else {
        await archiveThreadLocally(threadId);
        await archiveThread({ id: threadId });
        toast.success("Archived");
      }
    } catch {
      toast.error("Failed to update");
    }
  }

  function handleCopyThread() {
    if (!messages || messages.length === 0) {
      toast.error("No messages to copy");
      return;
    }
    const lines: string[] = [];
    lines.push(`Thread: ${thread.title}`);
    lines.push(`Messages: ${messages.length}`);
    lines.push("─".repeat(50));
    for (const msg of messages) {
      if (msg.status === "processing") continue;
      const time = formatDisplayDateTime(msg._creationTime);
      const sender = msg.role === "agent" ? "Spot" : messageSenderName(msg);
      const channel =
        msg.channel === "email"
          ? " [Email]"
          : msg.channel === "imessage"
            ? " [iMessage]"
            : msg.channel === "slack"
              ? " [Slack]"
              : " [Chat]";
      lines.push("");
      lines.push(`${sender}${channel} — ${time}`);
      if (msg.operatorInitiated?.operatorEmail) {
        lines.push(`Operator: ${msg.operatorInitiated.operatorEmail}`);
      }
      if (msg.fromEmail) lines.push(`From: ${msg.fromEmail}`);
      if (msg.toAddresses?.length)
        lines.push(`To: ${msg.toAddresses.join(", ")}`);
      if (msg.ccAddresses?.length)
        lines.push(`CC: ${msg.ccAddresses.join(", ")}`);
      lines.push("");
      lines.push(stripConfidenceMarkers(msg.content));
      if (msg.attachments?.length) {
        lines.push(
          `Attachments: ${msg.attachments.map((a) => a.filename).join(", ")}`,
        );
      }
      lines.push("─".repeat(50));
    }
    navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Thread copied to clipboard");
  }

  return (
    <>
      <PillButton
        size="compact"
        variant="secondary"
        onClick={handleCopyThread}
        label="Copy thread"
        expandLabel
      >
        <Copy className="w-3.5 h-3.5" />
      </PillButton>
      <PillButton
        size="compact"
        variant={isArchived ? "secondary" : "destructive"}
        onClick={handleArchiveToggle}
        label={isArchived ? "Unarchive" : "Archive"}
        iconOnly
      >
        {isArchived ? (
          <ArchiveRestore className="w-4 h-4" />
        ) : (
          <Archive className="w-4 h-4" />
        )}
      </PillButton>
    </>
  );
}

/* ── Shared markdown container styles ── */
const MARKDOWN_STYLES = "[&_a]:text-primary-light [&_a]:underline";
const IMESSAGE_MARKDOWN_STYLES =
  `${MARKDOWN_STYLES} ${typeStyle("body.large")} ` +
  "[&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_ul]:pl-4 [&_ol]:pl-4 " +
  `[&_li]:my-0.5 ${typeStyle("prose.default")} ` +
  `${typeStyle("prose.default")}`;

function markdownStylesForChannel(channel?: ThreadMessage["channel"]) {
  return channel === "imessage" ? IMESSAGE_MARKDOWN_STYLES : MARKDOWN_STYLES;
}

function slackConversationUrl(thread: {
  slackChannelId?: string;
  slackThreadTs?: string;
  slackConversationKind?: "channel" | "direct_message";
}) {
  if (!thread.slackChannelId) return undefined;
  if (
    thread.slackConversationKind === "direct_message" ||
    !thread.slackThreadTs
  ) {
    return `https://slack.com/app_redirect?channel=${encodeURIComponent(thread.slackChannelId)}`;
  }
  return `https://slack.com/archives/${encodeURIComponent(thread.slackChannelId)}/p${thread.slackThreadTs.replace(".", "")}`;
}

const markdownComponents = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    if (href?.startsWith("/policies/")) {
      return (
        <ContextReferenceCard href={href}>{children}</ContextReferenceCard>
      );
    }
    return (
      <a
        href={href}
        className="text-primary-light underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  },
};

/* ── Pending email countdown + cancel ── */
function PendingSendCountdown({
  pendingEmailId,
}: {
  pendingEmailId: Id<"pendingEmails">;
}) {
  const pendingEmail = useCachedQuery(
    "pendingEmails.get.countdown",
    api.pendingEmails.get,
    { id: pendingEmailId },
  );
  const updatePendingEmail = useUpdateCachedQuery<
    typeof pendingEmail,
    { id: Id<"pendingEmails"> }
  >("pendingEmails.get.countdown");
  const cancelMutation = useMutation(api.pendingEmails.cancel);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!pendingEmail || pendingEmail.status !== "pending") {
      return;
    }
    function tick() {
      const left = Math.max(
        0,
        Math.ceil((pendingEmail!.scheduledSendTime - dayjs().valueOf()) / 1000),
      );
      setRemaining(left);
    }
    tick();
    const interval = setInterval(tick, 200);
    return () => {
      clearInterval(interval);
      setRemaining(null);
    };
  }, [pendingEmail]);

  if (
    !pendingEmail ||
    pendingEmail.status !== "pending" ||
    remaining === null
  ) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 mt-1.5">
      <span className={`text-muted-foreground/50 ${typeStyle("caption.default")}`}>
        Sending in {remaining}s...
      </span>
      <PillButton
        type="button"
        variant="destructive"
        size="compact"
        onClick={async () => {
          try {
            await cancelMutation({ id: pendingEmailId });
            await updatePendingEmail({ id: pendingEmailId }, (current) =>
              current ? { ...current, status: "cancelled" } : current,
            );
            toast.success("Email cancelled");
          } catch {
            toast.error("Failed to cancel");
          }
        }}
      >
        Cancel
      </PillButton>
    </div>
  );
}

export function WebMessageReceipt({
  status,
}: {
  status: WebMessageReceiptStatus;
}) {
  const isRead = status === "read";
  return (
    <div
      className={`mt-1 flex items-center justify-end gap-1 text-muted-foreground/45 ${typeStyle("caption.default")}`}
      aria-label={isRead ? "Read by Spot" : "Delivered to Spot"}
    >
      {isRead ? (
        <CheckCheck className="h-3 w-3" aria-hidden="true" />
      ) : (
        <Check className="h-3 w-3" aria-hidden="true" />
      )}
      <span>{isRead ? "Read" : "Delivered"}</span>
    </div>
  );
}

/* ── Unified message bubble ── */
export const UnifiedMessageBubble = memo(function UnifiedMessageBubble({
  msg,
  relatedEmailMessages = EMPTY_RELATED_EMAIL_MESSAGES,
  viewerId,
  viewerEmail,
  receiptStatus,
  mirroredToImessage,
  threadContext,
  brokerPerspective,
  collapseEmailMessages,
  onOpenEmail,
  openEmailMessageId,
  onOpenVendorCompliance,
  openVendorComplianceArtifactRef,
  onOpenMailboxArtifact,
  openMailboxArtifactRef,
}: {
  msg: ThreadMessage;
  relatedEmailMessages?: ThreadMessage[];
  viewerId?: string;
  viewerEmail?: string;
  receiptStatus?: WebMessageReceiptStatus;
  mirroredToImessage?: boolean;
  threadContext?: { pageType: string; entityId?: string; summary?: string };
  /** When true, render agent messages as if sent "by the broker" — right-aligned. */
  brokerPerspective?: boolean;
  collapseEmailMessages?: boolean;
  onOpenEmail?: (message: ThreadMessage) => void;
  openEmailMessageId?: Id<"threadMessages"> | null;
  onOpenVendorCompliance?: (ref: VendorComplianceArtifactRef) => void;
  openVendorComplianceArtifactRef?: VendorComplianceArtifactRef | null;
  onOpenMailboxArtifact?: (ref: MailboxArtifactRef) => void;
  openMailboxArtifactRef?: MailboxArtifactRef | null;
}) {
  const [showQuoted, setShowQuoted] = useState(false);
  const time = dayjs(msg._creationTime);
  const channelIcon =
    msg.channel === "email" ? (
      <MailIcon className="h-3 w-3 text-muted-foreground/45" />
    ) : msg.channel === "imessage" || mirroredToImessage ? (
      <MessageCircle className="h-3 w-3 text-muted-foreground/45" />
    ) : msg.channel === "slack" ? (
      <SiSlack className="h-3 w-3 text-muted-foreground/45" />
    ) : null;
  const agentTargets = useCachedAgentTargets(msg.orgId);
  const promptReferences = useMemo(
    () => messagePromptReferences(msg, agentTargets, threadContext),
    [agentTargets, msg, threadContext],
  );

  // Processing stays intentionally opaque: Spot reads the message, thinks,
  // then publishes one complete response like the other conversation channels.
  if (msg.role === "agent" && msg.status === "processing") {
    return (
      <div className="w-full">
        <div className="flex items-center gap-2">
          <AgentThinkingBubble />
          <CancelButton messageId={msg._id} show />
        </div>
        {relatedEmailMessages.length > 0 ? (
          <div className="mt-3">
            <EmailStackCard
              messages={relatedEmailMessages}
              onOpen={onOpenEmail}
              isOpenMessageId={openEmailMessageId}
            />
          </div>
        ) : null}
      </div>
    );
  }

  if (msg.messageKind === "workflow_status") {
    return (
      <div
        role="status"
        className="w-full rounded-lg border border-border/50 bg-muted/25 px-3 py-2"
      >
        <p className={`min-w-0 text-muted-foreground ${typeStyle("body.default")}`}>
          {msg.content}
        </p>
      </div>
    );
  }

  // Error state
  if (msg.status === "error" && msg.role !== "agent") {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
        <p className={`text-destructive ${typeStyle("caption.default")}`}>
          {msg.error ?? "An error occurred processing this message."}
        </p>
        <RetryButton messageId={msg._id} />
      </div>
    );
  }

  // Agent message
  if (msg.role === "agent") {
    const isError = msg.status === "error";
    const storedContent = msg.content?.trim()
      ? msg.content
      : isError
        ? (msg.error ?? "An error occurred processing this message.")
        : msg.content;
    const displayContent = stripConfidenceMarkers(storedContent);

    // Cited sections from tool results (stored on message by processThreadChat)
    const citedSections = msg.citedSections;
    const citedCoverageNames = msg.citedCoverageNames;
    const citedSourceSpanIds = msg.citedSourceSpanIds;
    const mailboxArtifacts =
      msg.toolArtifacts?.filter(
        (artifact) => artifact.type === "mailbox_task",
      ) ?? [];

    // Policy references are intentional presentation selections, not retrieval evidence.
    const allRefs: { type: "policy"; id: string; page?: number }[] = [];
    const referencedPolicyIds = msg.referencedPolicyIds ?? [];
    const seenRefKeys = new Set<string>();
    for (const pid of referencedPolicyIds) {
      const key = `policy:${pid}`;
      if (!seenRefKeys.has(key)) {
        seenRefKeys.add(key);
        allRefs.push({ type: "policy", id: pid as string });
      }
    }
    return (
      <div className={brokerPerspective ? "ml-auto w-full max-w-lg" : "w-full"}>
        {collapseEmailMessages && msg.channel === "email" ? (
          <EmailSummaryCard
            message={msg}
            onOpen={onOpenEmail}
            isOpen={openEmailMessageId === msg._id}
          />
        ) : (
          <>
            <ThreadMessageBubble
              role="agent"
              channel={msg.channel}
              isError={isError}
            >
              <ProseMarkdown
                gfm
                breaks
                compact={msg.channel === "imessage"}
                className={markdownStylesForChannel(msg.channel)}
                components={markdownComponents}
              >
                {displayContent}
              </ProseMarkdown>
            </ThreadMessageBubble>
            {msg.channel === "slack" &&
            msg.slackDeliveryStatus !== undefined &&
            msg.slackDeliveryStatus !== "sent" ? (
              <StatusTag
                tone={
                  msg.slackDeliveryStatus === "failed" ? "danger" : "info"
                }
                className="mt-2"
              >
                {msg.slackDeliveryStatus === "failed"
                  ? "Not delivered to Slack"
                  : "Delivering to Slack"}
              </StatusTag>
            ) : null}
            <MessageFooterActions
              refs={allRefs}
              citedSections={citedSections}
              citedCoverageNames={citedCoverageNames}
              citedSourceSpanIds={citedSourceSpanIds}
              attachments={msg.attachments}
              threadId={msg.threadId}
              mailboxArtifacts={mailboxArtifacts}
              messageId={msg._id}
              onOpenMailboxArtifact={onOpenMailboxArtifact}
              openMailboxArtifactRef={openMailboxArtifactRef}
              copyContent={stripConfidenceMarkers(displayContent)}
              retryMessageId={
                msg.channel === "chat" || msg.channel === "imessage"
                  ? msg._id
                  : undefined
              }
              rightAligned={brokerPerspective}
            />
            <VendorComplianceArtifacts
              messageId={msg._id}
              artifacts={msg.toolArtifacts}
              openArtifactRef={openVendorComplianceArtifactRef}
              onOpenArtifact={onOpenVendorCompliance}
            />
            <CertificateHoldArtifacts artifacts={msg.toolArtifacts} />
            {relatedEmailMessages.length > 0 ? (
              <div className="mt-4">
                <EmailStackCard
                  messages={relatedEmailMessages}
                  onOpen={onOpenEmail}
                  isOpenMessageId={openEmailMessageId}
                />
              </div>
            ) : null}
          </>
        )}
        {msg.status === "pending_send" && msg.pendingEmailId && (
          <PendingSendCountdown pendingEmailId={msg.pendingEmailId} />
        )}
      </div>
    );
  }

  // User message
  const isOwnMessage = isMessageFromViewer(msg, viewerId, viewerEmail);

  const displayName = messageSenderName(msg);
  const isOperatorInitiated = Boolean(msg.operatorInitiated);

  const isEmail = msg.channel === "email";
  const cleanContent = msg.content;
  const quoted = isEmail ? (msg.emailContent?.quotedText ?? null) : null;

  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div
      className={`flex items-start gap-2.5 max-w-[min(32rem,100%)] w-fit ${isOwnMessage ? "ml-auto flex-row-reverse" : ""}`}
    >
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
          isOperatorInitiated
            ? "border border-border-emphasized bg-background"
            : "bg-foreground/8"
        }`}
        title={isOperatorInitiated ? "Clarity Labs" : undefined}
      >
        {isOperatorInitiated ? (
          <LogoIcon
            size={15}
            static
            className="h-[15px] w-[15px]"
          />
        ) : (
          <span className={`text-foreground/60 ${typeStyle("caption.medium")}`}>
            {initials}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className={`flex items-center gap-2 mb-1 ${isOwnMessage ? "justify-end" : ""}`}
        >
          <p
            className={`min-w-0 max-w-[min(24rem,70vw)] truncate text-muted-foreground/50 ${typeStyle("caption.medium")}`}
            title={
              msg.operatorInitiated?.operatorEmail
                ? `${displayName} (${msg.operatorInitiated.operatorEmail})`
                : displayName
            }
          >
            {displayName}
          </p>
          {isEmail && !collapseEmailMessages ? (
            <EmailRecipientMeta
              toAddresses={msg.toAddresses}
              ccAddresses={msg.ccAddresses}
            />
          ) : null}
          {channelIcon}
          <span className="text-muted-foreground/30">·</span>
          <span className={`text-muted-foreground/45 ${typeStyle("caption.default")}`}>
            {formatDisplayDateTime(time)}
          </span>
        </div>
        {collapseEmailMessages && isEmail ? (
          <EmailSummaryCard
            message={msg}
            onOpen={onOpenEmail}
            isOpen={openEmailMessageId === msg._id}
          />
        ) : (
          <ThreadMessageBubble
            role="user"
            channel={msg.channel}
            isOwnMessage={Boolean(isOwnMessage)}
          >
            {msg.channel === "slack" ? (
              <ProseMarkdown
                sourceFormat="slack-mrkdwn"
                gfm
                breaks
                className={MARKDOWN_STYLES}
                components={markdownComponents}
              >
                {cleanContent}
              </ProseMarkdown>
            ) : (
              <PromptReferenceText
                content={cleanContent}
                references={promptReferences}
                className="block"
              />
            )}
            {quoted && (
              <>
                <button
                  type="button"
                  onClick={() => setShowQuoted(!showQuoted)}
                  className={`mt-1.5 text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors ${typeStyle("control.buttonCompact")}`}
                >
                  {showQuoted ? "Hide quoted text ▴" : "Show quoted text ▾"}
                </button>
                {showQuoted && <QuotedContent text={quoted} />}
              </>
            )}
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="mt-2">
                <ThreadAttachmentList
                  attachments={msg.attachments}
                  threadId={msg.threadId}
                />
              </div>
            )}
          </ThreadMessageBubble>
        )}
        {isOwnMessage && receiptStatus ? (
          <WebMessageReceipt status={receiptStatus} />
        ) : null}
      </div>
    </div>
  );
});

/* ── Cancel button for stuck processing messages ── */
function CancelButton({
  messageId,
  show,
}: {
  messageId: string;
  show: boolean;
}) {
  const cancel = useMutation(api.threads.cancelProcessing);
  const [cancelling, setCancelling] = useState(false);
  if (!show) return null;

  return (
    <button
      type="button"
      disabled={cancelling}
      onClick={async () => {
        setCancelling(true);
        try {
          await cancel({ messageId: messageId as Id<"threadMessages"> });
        } catch {
          toast.error("Failed to cancel");
        } finally {
          setCancelling(false);
        }
      }}
      className={`inline-flex h-5 items-center gap-1.5 text-muted-foreground/35 transition-colors hover:text-muted-foreground/60 disabled:opacity-50 ${typeStyle("control.buttonCompact")}`}
    >
      {cancelling ? "Cancelling..." : "Cancel"}
    </button>
  );
}

/* ── Copy button for agent messages ── */
function CopyMessageButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  if (!content?.trim()) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-transparent text-muted-foreground/40 transition-colors hover:border-input hover:bg-foreground/[0.03] hover:text-foreground/70"
      title="Copy response"
    >
      {copied ? (
        <Check className="w-3 h-3 text-emerald-500" />
      ) : (
        <Copy className="w-3 h-3" />
      )}
    </button>
  );
}

function TryAgainMessageButton({
  messageId,
}: {
  messageId: Id<"threadMessages">;
}) {
  const retry = useMutation(api.threads.retryAgentResponse);
  const [retrying, setRetrying] = useState(false);

  return (
    <button
      type="button"
      disabled={retrying}
      onClick={async () => {
        setRetrying(true);
        try {
          await retry({ messageId });
        } catch {
          toast.error("Failed to retry");
        } finally {
          setRetrying(false);
        }
      }}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-transparent text-muted-foreground/40 transition-colors hover:border-input hover:bg-foreground/[0.03] hover:text-foreground/70 disabled:opacity-50"
      title="Try again"
    >
      <RotateCcw className={`h-3 w-3 ${retrying ? "animate-spin" : ""}`} />
    </button>
  );
}

/* ── Retry button for failed/blank agent messages ── */
function RetryButton({ messageId }: { messageId: string }) {
  const retry = useMutation(api.threads.retryAgentResponse);
  const [retrying, setRetrying] = useState(false);

  return (
    <button
      type="button"
      disabled={retrying}
      onClick={async () => {
        setRetrying(true);
        try {
          await retry({ messageId: messageId as Id<"threadMessages"> });
        } catch {
          toast.error("Failed to retry");
        } finally {
          setRetrying(false);
        }
      }}
      className={`inline-flex items-center gap-1.5 mt-2 ml-9.5 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors disabled:opacity-50 ${typeStyle("control.buttonCompact")}`}
    >
      <RotateCcw className={`w-3 h-3 ${retrying ? "animate-spin" : ""}`} />
      {retrying ? "Retrying..." : "Retry response"}
    </button>
  );
}

/* ── Initial context link (shows which entity the chat was started from) ── */
export function ThreadContextLink({
  context,
}: {
  context: { pageType: string; entityId?: string; summary?: string };
}) {
  if (!context.entityId) return null;

  // Policy: delegate to the unified PolicyReferenceCard (opens preview side panel).
  if (context.pageType === "policy") {
    return <PolicyReferenceCard id={context.entityId} />;
  }

  return null;
}

function QueuedThreadMessage({
  message,
  sending,
  onSendNow,
  onCancel,
}: {
  message: PromptInputMessage;
  sending: boolean;
  onSendNow: () => void;
  onCancel: () => void;
}) {
  const preview =
    message.text.trim() ||
    (message.files.length > 0
      ? `${message.files.length} attachment${message.files.length === 1 ? "" : "s"}`
      : "Message");
  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg border border-input bg-card px-2.5 py-2">
      <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/35" />
      <p className={`min-w-0 flex-1 truncate text-muted-foreground/55 ${typeStyle("caption.default")}`}>
        Queued:{" "}
        <PromptReferenceText
          content={preview}
          references={message.references ?? []}
          className="text-foreground/75"
        />
      </p>
      <PillButton
        type="button"
        size="compact"
        onClick={onSendNow}
        disabled={sending}
      >
        {sending ? "Sending" : "Send now"}
      </PillButton>
      <button
        type="button"
        onClick={onCancel}
        disabled={sending}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground/35 transition-colors hover:bg-foreground/[0.04] hover:text-foreground/65 disabled:opacity-50"
        aria-label="Remove queued message"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ── Unified thread content ── */
export function UnifiedThreadContent({
  threadId,
  onMeta,
  onRightPanel,
  viewerId,
  viewerEmail,
}: {
  threadId: Id<"threads">;
  onMeta?: (meta: {
    detail: React.ReactNode;
    actions: React.ReactNode;
  }) => void;
  onRightPanel?: (panel: React.ReactNode | null) => void;
  viewerId?: string;
  viewerEmail?: string;
}) {
  const thread = useCachedQuery("threads.get.current", api.threads.get, {
    id: threadId,
  });
  const rawMessages = useCachedQuery(
    "threads.messages.current",
    api.threads.messages,
    { threadId },
  ) as ThreadMessage[] | undefined;
  const messages = useStableMessages(rawMessages);
  const mailboxReview = useCachedQuery(
    "connectedEmailAutomation.reviewForThread.current",
    api.connectedEmailAutomation.reviewForThread,
    { threadId },
  );
  const mailboxReviewArtifact = useMemo<ToolArtifactData | null>(
    () => mailboxReview ? { type: "mailbox_task", data: mailboxReview } : null,
    [mailboxReview],
  );
  const mailboxReviewMessageId = useMemo(
    () =>
      mailboxReviewArtifact
        ? messages?.find((message) => message.role === "agent")?._id
        : undefined,
    [mailboxReviewArtifact, messages],
  );
  const messageGroupingFingerprint = threadMessageGroupingFingerprint(
    threadId,
    messages ?? [],
  );
  const messageRenderPlan = useMemo(
    () => buildThreadMessageRenderPlan(messages ?? []),
    // Grouping inputs are immutable after settlement; processing content is
    // excluded so token updates do not rerun the grouping and dedupe pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messageGroupingFingerprint],
  );
  const visibleMessages = useMemo(
    () =>
      (messages ?? []).filter(
        (message) =>
          !messageRenderPlan.hiddenStatusMessageIds.has(message._id) &&
          !messageRenderPlan.attachedEmailMessageIds.has(message._id),
      ),
    [messageRenderPlan, messages],
  );
  const latestOwnReceipt = useMemo(
    () => latestOwnWebMessageReceipt(messages ?? [], viewerId, viewerEmail),
    [messages, viewerEmail, viewerId],
  );
  const mailboxReviewSourceMessage = mailboxReviewArtifact
    ? messages?.find((message) => message._id === mailboxReviewMessageId)
    : undefined;
  const mailboxReviewRenderedMessage = useMemo(
    () =>
      mailboxReviewArtifact && mailboxReviewSourceMessage
        ? {
            ...mailboxReviewSourceMessage,
            toolArtifacts: [
              ...(mailboxReviewSourceMessage.toolArtifacts ?? []),
              mailboxReviewArtifact,
            ],
          }
        : mailboxReviewSourceMessage,
    [mailboxReviewArtifact, mailboxReviewSourceMessage],
  );
  const pdf = usePdf();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const sendMessage = useMutation(api.threads.sendMessage);
  const { appendOptimisticSend, markOptimisticSendFailed } =
    useThreadCacheActions();
  const updateTitle = useMutation(api.threads.updateTitle);
  const generateUploadUrl = useMutation(api.threads.generateUploadUrl);
  const { contentRef, scrollRef, scrollToBottom } = useStickToBottom({
    initial: "instant",
    resize: "instant",
  });
  const chatInputRef = useRef<SpotPromptInputHandle>(null);
  const lastAutoOpenedEmailId = useRef<string | null>(null);
  const autoOpenPdfThreadId = useRef<string | null>(null);
  const seenAssistantPdfKeys = useRef<Set<string>>(new Set());
  const openedAssistantPdfKey = useRef<string | null>(null);
  const [autoOpenPdfAttachment, setAutoOpenPdfAttachment] = useState<
    AssistantPdfAttachment | null
  >(null);
  const autoOpenPdfUrl = useCachedQuery(
    "threads.getAttachmentUrl.auto-open",
    api.threads.getAttachmentUrl,
    autoOpenPdfAttachment
      ? { threadId, fileId: autoOpenPdfAttachment.fileId }
      : "skip",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [queuedMessage, setQueuedMessage] = useState<PromptInputMessage | null>(
    null,
  );
  const [sendingQueuedNow, setSendingQueuedNow] = useState(false);
  const [openEmailMessageId, setOpenEmailMessageId] =
    useState<Id<"threadMessages"> | null>(null);
  const [openVendorComplianceArtifactRef, setOpenVendorComplianceArtifactRef] =
    useState<VendorComplianceArtifactRef | null>(null);
  const [openMailboxArtifactRef, setOpenMailboxArtifactRef] =
    useState<MailboxArtifactRef | null>(null);
  const handleOpenEmail = useCallback((message: ThreadMessage) => {
    setOpenVendorComplianceArtifactRef(null);
    setOpenMailboxArtifactRef(null);
    setOpenEmailMessageId(message._id);
  }, []);
  const handleOpenVendorCompliance = useCallback(
    (ref: VendorComplianceArtifactRef) => {
      setOpenEmailMessageId(null);
      setOpenMailboxArtifactRef(null);
      setOpenVendorComplianceArtifactRef(ref);
    },
    [],
  );
  const handleOpenMailboxArtifact = useCallback((ref: MailboxArtifactRef) => {
    setOpenEmailMessageId(null);
    setOpenVendorComplianceArtifactRef(null);
    setOpenMailboxArtifactRef(ref);
  }, []);
  const openEmailMessage = useMemo(
    () =>
      messages?.find((message) => message._id === openEmailMessageId) ?? null,
    [messages, openEmailMessageId],
  );
  const openVendorComplianceArtifact = useMemo(() => {
    if (!openVendorComplianceArtifactRef) return null;
    const message = messages?.find(
      (candidate) =>
        candidate._id === openVendorComplianceArtifactRef.messageId,
    );
    const artifacts =
      message?.toolArtifacts?.filter(
        (artifact) => artifact.type === "vendor_compliance",
      ) ?? [];
    return artifacts[openVendorComplianceArtifactRef.index] ?? null;
  }, [messages, openVendorComplianceArtifactRef]);
  const openMailboxArtifact = useMemo(() => {
    if (!openMailboxArtifactRef) return null;
    const message = messages?.find(
      (candidate) => candidate._id === openMailboxArtifactRef.messageId,
    );
    const storedArtifacts =
      message?.toolArtifacts?.filter(
        (artifact) => artifact.type === "mailbox_task",
      ) ?? [];
    const artifacts =
      mailboxReviewArtifact && message?._id === mailboxReviewMessageId
        ? [...storedArtifacts, mailboxReviewArtifact]
        : storedArtifacts;
    const artifact = artifacts[openMailboxArtifactRef.index];
    return artifact
      ? {
          artifact,
          orgId: message?.orgId,
          threadId: message?.threadId,
          emailIndex: openMailboxArtifactRef.emailIndex,
        }
      : null;
  }, [
    mailboxReviewArtifact,
    mailboxReviewMessageId,
    messages,
    openMailboxArtifactRef,
  ]);

  // Error state for chat — stored as { threadId, message } so switching threads auto-clears it
  const [chatErrorState, setChatErrorState] = useState<{
    threadId: string;
    message: string;
  } | null>(null);
  const chatError =
    chatErrorState?.threadId === threadId ? chatErrorState.message : null;
  const setChatError = useCallback(
    (msg: string | null) =>
      setChatErrorState(msg ? { threadId, message: msg } : null),
    [threadId],
  );

  // Push title + actions to parent for AppShell header
  useEffect(() => {
    if (!thread || !onMeta) return;
    onMeta({
      detail: (
        <span className="inline-flex min-w-0 items-center gap-2">
          {thread.originChannel === "slack" ? (
            <SiSlack
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground/45"
              aria-label="Slack thread"
            />
          ) : null}
          <EditableBreadcrumbTitle
            key={threadId}
            title={getThreadDisplayLabel(thread)}
            saveKey={threadId}
            onSave={async (next) => {
              await updateTitle({ id: threadId, title: next });
            }}
          />
          {thread.originChannel === "slack" &&
          thread.visibility === "user_private" ? (
            <span
              className={`inline-flex shrink-0 items-center gap-1 text-muted-foreground/45 ${typeStyle("caption.medium")}`}
              title="Only you can see this thread in Spot"
            >
              <LockKeyhole className="h-3 w-3" />
              Private
            </span>
          ) : null}
        </span>
      ),
      actions: (
        <UnifiedThreadActions
          threadId={threadId}
          thread={thread}
          messages={messages}
        />
      ),
    });
  }, [thread, threadId, onMeta, messages, updateTitle]);

  useEffect(() => {
    if (!onRightPanel) return;
    onRightPanel(
      openEmailMessage ? (
        <EmailThreadSidebar
          message={openEmailMessage}
          onClose={() => setOpenEmailMessageId(null)}
        />
      ) : openVendorComplianceArtifact ? (
        <VendorComplianceSidebar
          artifact={openVendorComplianceArtifact}
          onClose={() => setOpenVendorComplianceArtifactRef(null)}
        />
      ) : openMailboxArtifact?.artifact &&
        openMailboxArtifact.orgId &&
        openMailboxArtifact.threadId ? (
        <MailboxTaskSidebar
          key={`${openMailboxArtifactRef?.index ?? 0}:${openMailboxArtifact.emailIndex ?? "task"}`}
          artifact={openMailboxArtifact.artifact}
          orgId={openMailboxArtifact.orgId}
          threadId={openMailboxArtifact.threadId}
          emailIndex={openMailboxArtifact.emailIndex}
          onClose={() => setOpenMailboxArtifactRef(null)}
        />
      ) : null,
    );
    return () => onRightPanel(null);
  }, [
    onRightPanel,
    openEmailMessage,
    openVendorComplianceArtifact,
    openMailboxArtifact,
    openMailboxArtifactRef?.index,
  ]);

  // Reset thread-local panels and anchor the newly selected thread at bottom.
  useEffect(() => {
    lastAutoOpenedEmailId.current = null;
    const frame = window.requestAnimationFrame(() => {
      setOpenEmailMessageId(null);
      setOpenVendorComplianceArtifactRef(null);
      setOpenMailboxArtifactRef(null);
      void scrollToBottom({ animation: "instant" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scrollToBottom, threadId]);

  useEffect(() => {
    const latestDraftEmail = messages
      ?.filter(
        (message) =>
          message.channel === "email" &&
          message.role === "agent" &&
          message.status === "draft_email",
      )
      .at(-1);
    if (!latestDraftEmail) return;
    if (lastAutoOpenedEmailId.current === latestDraftEmail._id) return;
    lastAutoOpenedEmailId.current = latestDraftEmail._id;
    setOpenVendorComplianceArtifactRef(null);
    setOpenMailboxArtifactRef(null);
    setOpenEmailMessageId(latestDraftEmail._id);
  }, [messages]);

  useEffect(() => {
    if (!messages) return;
    const attachments = assistantPdfAttachments(messages);
    if (autoOpenPdfThreadId.current !== threadId) {
      autoOpenPdfThreadId.current = threadId;
      seenAssistantPdfKeys.current = new Set(
        attachments.map((attachment) => attachment.key),
      );
      setAutoOpenPdfAttachment(null);
      return;
    }

    const unseen = attachments.filter(
      (attachment) => !seenAssistantPdfKeys.current.has(attachment.key),
    );
    for (const attachment of unseen) {
      seenAssistantPdfKeys.current.add(attachment.key);
    }
    if (!isDesktop || unseen.length === 0) return;
    setAutoOpenPdfAttachment(unseen.at(-1) ?? null);
  }, [isDesktop, messages, threadId]);

  useEffect(() => {
    if (!autoOpenPdfAttachment || !autoOpenPdfUrl || !isDesktop) return;
    if (openedAssistantPdfKey.current === autoOpenPdfAttachment.key) return;
    openedAssistantPdfKey.current = autoOpenPdfAttachment.key;
    pdf.openWithUrl(autoOpenPdfUrl);
  }, [autoOpenPdfAttachment, autoOpenPdfUrl, isDesktop, pdf]);

  const isAgentProcessing = useMemo(
    () =>
      messages?.some((m) => m.role === "agent" && m.status === "processing") ??
      false,
    [messages],
  );
  const isAwaitingAgent = useMemo(() => {
    if (!messages || messages.length === 0) return false;
    const lastUserIndex = messages.reduce(
      (acc, m, i) => (m.role === "user" ? i : acc),
      -1,
    );
    const lastAgentIndex = messages.reduce(
      (acc, m, i) => (m.role === "agent" ? i : acc),
      -1,
    );
    return lastUserIndex > lastAgentIndex;
  }, [messages]);
  const isAgentActive = isAgentProcessing || isAwaitingAgent;
  const isInputBusy = isSubmitting || sendingQueuedNow;
  const inputBusyLabel = "Sending";

  const sendThreadMessage = useCallback(
    async (message: PromptInputMessage) => {
      const text = message.text.trim();
      if (!text && message.files.length === 0) return;
      if (!thread) return;
      setIsSubmitting(true);
      const content = text || "(attached files)";
      const clientMutationId = createClientMutationId("message");
      const referenceIds = promptReferenceIds(message.references);

      try {
        await appendOptimisticSend({
          threadId,
          orgId: thread.orgId,
          content,
          clientMutationId,
          userId: viewerId as Id<"users"> | undefined,
          userName: viewerEmail ?? "You",
          attachments: optimisticPromptAttachments(message.files),
          ...referenceIds,
        });
        setChatError(null);

        const attachments = await uploadPromptFiles(
          message.files,
          generateUploadUrl,
        );

        if (attachments.length > 0) {
          await sendMessage({
            threadId,
            content,
            attachments,
            ...referenceIds,
            clientMutationId,
          });
          return;
        }

        await sendMessage({
          threadId,
          content,
          ...referenceIds,
          clientMutationId,
        });
      } catch (error) {
        const message = getUserFacingErrorMessage(
          error,
          "Failed to send message",
        );
        await markOptimisticSendFailed({
          threadId,
          clientMutationId,
          error: message,
        });
        setChatError(message);
        toast.error("Failed to send message");
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      appendOptimisticSend,
      generateUploadUrl,
      markOptimisticSendFailed,
      sendMessage,
      setChatError,
      thread,
      threadId,
      viewerEmail,
      viewerId,
    ],
  );

  const handleSend = useCallback(
    (message: PromptInputMessage) => {
      if (isAgentActive) {
        setQueuedMessage(message);
        return;
      }
      if (isInputBusy) return;
      void sendThreadMessage(message);
    },
    [isAgentActive, isInputBusy, sendThreadMessage],
  );

  const sendQueuedNow = useCallback(async () => {
    if (!queuedMessage || sendingQueuedNow) return;
    setSendingQueuedNow(true);
    const message = queuedMessage;
    setQueuedMessage(null);
    try {
      await sendThreadMessage(message);
    } finally {
      setSendingQueuedNow(false);
    }
  }, [queuedMessage, sendThreadMessage, sendingQueuedNow]);

  useEffect(() => {
    if (!queuedMessage || isAgentActive || isSubmitting || sendingQueuedNow)
      return;
    const message = queuedMessage;
    const timeout = window.setTimeout(() => {
      setQueuedMessage(null);
      void sendThreadMessage(message);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [
    isAgentActive,
    isSubmitting,
    queuedMessage,
    sendThreadMessage,
    sendingQueuedNow,
  ]);

  const collapseEmailMessages = thread?.originChannel !== "email";

  if (!thread) {
    return <div className="h-full" />;
  }
  const slackUrl = slackConversationUrl(thread);

  return (
    <div className="relative h-full">
      {/* Messages — full height, content scrolls under the input overlay */}
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-auto scrollbar-hide p-4 pr-5"
      >
        <div ref={contentRef} className="mx-auto w-full max-w-3xl space-y-4">
          {messages && messages.length === 0 && (
            <NewChatEmptyState
              orgId={thread.orgId}
              onSelectPrompt={(prompt) =>
                chatInputRef.current?.setValueAndFocus(prompt)
              }
            />
          )}
          {visibleMessages.map((msg) => {
            const renderedMessage =
              msg._id === mailboxReviewMessageId
                ? (mailboxReviewRenderedMessage ?? msg)
                : msg;
            const isFirstUser =
              msg._id === messageRenderPlan.firstUserMessageId;
            const firstUserIsOwn =
              isFirstUser && isMessageFromViewer(msg, viewerId, viewerEmail);
            const relatedEmailMessages =
              messageRenderPlan.relatedEmailsByMessageId.get(msg._id);
            const receiptStatus =
              latestOwnReceipt?.messageId === msg._id
                ? latestOwnReceipt.status
                : null;

            return (
              <div key={msg._id}>
                <UnifiedMessageBubble
                  msg={renderedMessage}
                  relatedEmailMessages={relatedEmailMessages}
                  viewerId={viewerId}
                  viewerEmail={viewerEmail}
                  receiptStatus={receiptStatus ?? undefined}
                  mirroredToImessage={
                    thread.originChannel === "imessage" &&
                    msg.channel === "chat"
                  }
                  threadContext={
                    isFirstUser ? thread?.initialContext : undefined
                  }
                  collapseEmailMessages={collapseEmailMessages}
                  onOpenEmail={handleOpenEmail}
                  openEmailMessageId={openEmailMessageId}
                  onOpenVendorCompliance={handleOpenVendorCompliance}
                  openVendorComplianceArtifactRef={
                    openVendorComplianceArtifactRef
                  }
                  onOpenMailboxArtifact={handleOpenMailboxArtifact}
                  openMailboxArtifactRef={openMailboxArtifactRef}
                />
                {isFirstUser && thread?.initialContext && (
                  <div
                    className={`mt-2 flex ${firstUserIsOwn ? "justify-end mr-9.5" : "ml-9.5"}`}
                  >
                    <ThreadContextLink context={thread.initialContext} />
                  </div>
                )}
              </div>
            );
          })}
          {chatError && (
            <div className={`mx-4 mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-destructive ${typeStyle("body.default")}`}>
              {chatError}
            </div>
          )}
          {/* Padding so last message clears the input overlay */}
          {messages && messages.length > 0 ? (
            <div className={thread.originChannel === "slack" ? "h-24" : "h-40"} />
          ) : null}
        </div>
      </div>
      {/* Input — overlaid at bottom, content scrolls under it */}
      <ChatInputOverlay>
        {thread.originChannel === "slack" ? (
          <div className="flex flex-col items-stretch gap-3 rounded-xl border border-input bg-background px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
                Continue this conversation in Slack.
              </p>
              {thread.visibility !== "user_private" ? (
                <p className={`mt-0.5 text-muted-foreground/55 ${typeStyle("caption.default")}`}>
                  New Slack replies stay synced to this client record.
                </p>
              ) : null}
            </div>
            {slackUrl ? (
              <PillButton
                href={slackUrl}
                target="_blank"
                rel="noreferrer"
                size="compact"
                variant="secondary"
                className="self-start sm:self-auto"
              >
                <SiSlack className="h-3.5 w-3.5" />
                Open in Slack
                <ExternalLink className="h-3 w-3" />
              </PillButton>
            ) : null}
          </div>
        ) : (
          <>
            {queuedMessage ? (
              <QueuedThreadMessage
                message={queuedMessage}
                sending={sendingQueuedNow}
                onSendNow={sendQueuedNow}
                onCancel={() => setQueuedMessage(null)}
              />
            ) : null}
            <SpotPromptInput
              ref={chatInputRef}
              onSubmit={handleSend}
              placeholder="Reply to this thread..."
              showAttach
              disabled={isInputBusy}
              status={isInputBusy ? "submitted" : undefined}
              submittedLabel={inputBusyLabel}
              orgId={thread.orgId}
            />
          </>
        )}
      </ChatInputOverlay>
    </div>
  );
}
