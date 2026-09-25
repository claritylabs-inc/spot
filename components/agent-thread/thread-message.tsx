"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import dayjs from "dayjs";
import { toast } from "sonner";
import {
  Check,
  CheckCheck,
  FileText,
  Mail as MailIcon,
  MessageCircle,
  Paperclip,
  RotateCcw,
} from "lucide-react";
import { SiSlack } from "react-icons/si";
import { MessageMetaTag } from "@claritylabs-inc/ui/components/message-meta-tag";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { PresentationFollowUp } from "@/components/chat-presentation/context";
import { ChatAttachmentGrid } from "@/components/chat/attachment-grid";
import {
  ChatAssistantTurn,
  ChatAvatar,
  ChatCopyButton,
  ChatErrorNotice,
  ChatUserTurn,
} from "@/components/chat/chat-message";
import { useChatAction } from "@/components/chat/use-chat-action";
import {
  ContextReferenceCard,
  PolicyReferenceCard,
  PolicySourcePill,
} from "@/components/context-reference-card";
import {
  PromptReferenceText,
  type PromptReference,
  type PromptReferenceTagKind,
} from "@/components/prompt-reference-tag";
import { ProseMarkdown } from "@/components/prose-markdown";
import { LogoIcon } from "@/components/ui/logo-icon";
import { PillButton } from "@/components/ui/pill-button";
import { stripConfidenceMarkers } from "@/lib/confidence";
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";
import { useCachedAgentTargets } from "@/lib/sync/spot-cached-queries";
import { typeStyle } from "@/lib/typography";
import {
  CertificateHoldArtifacts,
  EmailStackCard,
  EmailSummaryCard,
  VendorComplianceArtifacts,
  mailboxTaskDisplayName,
  normalizeMailboxTask,
} from "./artifacts";
import { ChatAttachmentChip } from "@/components/chat/attachment-chip";
import {
  isMessageFromViewer,
  messageSenderName,
  type WebMessageReceiptStatus,
} from "./thread-messages";
import type {
  MailboxArtifactRef,
  ThreadAttachment,
  ThreadMessage,
  ToolArtifactData,
  VendorComplianceArtifactRef,
} from "./types";

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

function ThreadAttachmentGrid({
  attachments,
  threadId,
  className,
}: {
  attachments: ThreadAttachment[];
  threadId: Id<"threads">;
  className?: string;
}) {
  const fileIds = attachments.flatMap((attachment) =>
    attachment.fileId ? [attachment.fileId] : [],
  );
  const urls = useCachedQuery(
    "threads.getAttachmentUrls.message",
    api.threads.getAttachmentUrls,
    fileIds.length > 1 ? { threadId, fileIds } : "skip",
  );
  return (
    <ChatAttachmentGrid
      className={className}
      files={urls?.map((entry) => ({
        url: entry.url,
        filename:
          attachments.find((attachment) => attachment.fileId === entry.fileId)
            ?.filename ?? "attachment",
      }))}
    >
      {attachments.map((attachment, index) => (
        <span
          key={`${attachment.fileId ?? attachment.filename}-${index}`}
          className="min-w-0"
        >
          <ChatAttachmentChip
            attachment={attachment}
            threadId={threadId}
            className="w-fit"
          />
        </span>
      ))}
    </ChatAttachmentGrid>
  );
}

function ThreadAttachmentList({
  attachments,
  threadId,
}: {
  attachments: ThreadAttachment[];
  threadId: Id<"threads">;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  if (attachments.length === 1) {
    return (
      <ChatAttachmentChip
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
        <ThreadAttachmentGrid
          attachments={attachments}
          threadId={threadId}
          className="basis-full"
        />
      ) : null}
    </>
  );
}

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
}) {
  const [isMailboxExpanded, setIsMailboxExpanded] = useState(false);
  const [isSourcesExpanded, setIsSourcesExpanded] = useState(true);
  const [isAttachmentExpanded, setIsAttachmentExpanded] = useState(false);
  const attachmentList = attachments ?? [];
  const hasAttachments = attachmentList.length > 0;
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
        className={`max-w-64 ${
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
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
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
            <ChatAttachmentChip
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
                icon={<LogoIcon size={12} className="h-3 w-3" />}
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
          {retryMessageId ? (
            <TryAgainMessageButton messageId={retryMessageId} />
          ) : null}
          {copyContent ? (
            <ChatCopyButton content={copyContent} iconClassName="h-3 w-3" />
          ) : null}
        </div>
      </div>
      {attachmentList.length > 1 && isAttachmentExpanded ? (
        <ThreadAttachmentGrid
          attachments={attachmentList}
          threadId={threadId}
          className="mt-1.5 w-full"
        />
      ) : null}
    </div>
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

const EMPTY_RELATED_EMAIL_MESSAGES: ThreadMessage[] = [];

/* ── Unified message bubble ── */
export const UnifiedMessageBubble = memo(function UnifiedMessageBubble({
  msg,
  relatedEmailMessages = EMPTY_RELATED_EMAIL_MESSAGES,
  viewerId,
  viewerEmail,
  receiptStatus,
  mirroredToImessage,
  threadContext,
  collapseEmailMessages,
  onOpenEmail,
  openEmailMessageId,
  onOpenVendorCompliance,
  openVendorComplianceArtifactRef,
  onOpenMailboxArtifact,
  openMailboxArtifactRef,
  onPresentationFollowUp,
  presentationDisabled = true,
}: {
  onPresentationFollowUp?: PresentationFollowUp;
  presentationDisabled?: boolean;
  msg: ThreadMessage;
  relatedEmailMessages?: ThreadMessage[];
  viewerId?: string;
  viewerEmail?: string;
  receiptStatus?: WebMessageReceiptStatus;
  mirroredToImessage?: boolean;
  threadContext?: { pageType: string; entityId?: string; summary?: string };
  collapseEmailMessages?: boolean;
  onOpenEmail?: (message: ThreadMessage) => void;
  openEmailMessageId?: Id<"threadMessages"> | null;
  onOpenVendorCompliance?: (ref: VendorComplianceArtifactRef) => void;
  openVendorComplianceArtifactRef?: VendorComplianceArtifactRef | null;
  onOpenMailboxArtifact?: (ref: MailboxArtifactRef) => void;
  openMailboxArtifactRef?: MailboxArtifactRef | null;
}) {
  const agentTargets = useCachedAgentTargets(msg.orgId);
  const promptReferences = useMemo(
    () => messagePromptReferences(msg, agentTargets, threadContext),
    [agentTargets, msg, threadContext],
  );

  const working = msg.role === "agent" && msg.status === "processing";

  if (msg.messageKind === "workflow_status" && !working) {
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

  if (msg.status === "error" && msg.role !== "agent") {
    return (
      <ChatErrorNotice className="p-3">
        <p className={`text-destructive ${typeStyle("caption.default")}`}>
          {msg.error ?? "An error occurred processing this message."}
        </p>
        <RetryButton messageId={msg._id} />
      </ChatErrorNotice>
    );
  }

  if (msg.role === "agent") {
    const isError = msg.status === "error";
    const displayContent = stripConfidenceMarkers(
      msg.content?.trim()
        ? msg.content
        : isError
          ? (msg.error ?? "An error occurred processing this message.")
          : msg.content,
    );
    const artifacts = (
      <>
        <VendorComplianceArtifacts
          messageId={msg._id}
          artifacts={msg.toolArtifacts}
          openArtifactRef={openVendorComplianceArtifactRef}
          onOpenArtifact={onOpenVendorCompliance}
        />
        <CertificateHoldArtifacts artifacts={msg.toolArtifacts} />
        {relatedEmailMessages.length > 0 ? (
          <div className={working ? "mt-3" : "mt-4"}>
            <EmailStackCard
              messages={relatedEmailMessages}
              onOpen={onOpenEmail}
              isOpenMessageId={openEmailMessageId}
            />
          </div>
        ) : null}
      </>
    );

    // Policy references are intentional presentation selections, not retrieval evidence.
    const refs = [...new Set(msg.referencedPolicyIds ?? [])].map((id) => ({
      type: "policy" as const,
      id: id as string,
    }));
    return (
      <ChatAssistantTurn
        working={working}
        hasText={working ? Boolean(msg.content) : true}
        tools={msg.usedTools}
        aside={working ? <CancelButton messageId={msg._id} /> : undefined}
        after={
          working ? artifacts : msg.status === "pending_send" && msg.pendingEmailId ? (
            <PendingSendCountdown pendingEmailId={msg.pendingEmailId} />
          ) : null
        }
        content={displayContent}
        channel={msg.channel}
        isError={isError}
        markdownClassName={markdownStylesForChannel(msg.channel)}
        markdownComponents={markdownComponents}
        organizationId={msg.orgId}
        presentation={working ? undefined : msg.presentation}
        structuredReferences
        onFollowUp={onPresentationFollowUp}
        presentationDisabled={presentationDisabled}
        body={!working && collapseEmailMessages && msg.channel === "email" ? (
          <EmailSummaryCard
            message={msg}
            onOpen={onOpenEmail}
            isOpen={openEmailMessageId === msg._id}
          />
        ) : undefined}
        belowAnswer={!working && !(collapseEmailMessages && msg.channel === "email") ? (
          <>
            {msg.channel === "slack" &&
            msg.slackDeliveryStatus !== undefined &&
            msg.slackDeliveryStatus !== "sent" ? (
              <StatusTag
                tone={msg.slackDeliveryStatus === "failed" ? "danger" : "info"}
                className="mt-2"
              >
                {msg.slackDeliveryStatus === "failed"
                  ? "Not delivered to Slack"
                  : "Delivering to Slack"}
              </StatusTag>
            ) : null}
            <MessageFooterActions
              refs={refs}
              citedSections={msg.citedSections}
              citedCoverageNames={msg.citedCoverageNames}
              citedSourceSpanIds={msg.citedSourceSpanIds}
              attachments={msg.attachments}
              threadId={msg.threadId}
              mailboxArtifacts={msg.toolArtifacts?.filter(
                (artifact) => artifact.type === "mailbox_task",
              )}
              messageId={msg._id}
              onOpenMailboxArtifact={onOpenMailboxArtifact}
              openMailboxArtifactRef={openMailboxArtifactRef}
              copyContent={displayContent}
              retryMessageId={
                msg.channel === "chat" || msg.channel === "imessage"
                  ? msg._id
                  : undefined
              }
            />
            {artifacts}
          </>
        ) : undefined}
      />
    );
  }

  const isOwnMessage = isMessageFromViewer(msg, viewerId, viewerEmail);
  const displayName = messageSenderName(msg);
  const isEmail = msg.channel === "email";
  const quoted = isEmail ? (msg.emailContent?.quotedText ?? null) : null;
  const channelIconClass = "h-3 w-3 text-muted-foreground/45";

  return (
    <ChatUserTurn
      own={isOwnMessage}
      name={displayName}
      nameTitle={
        msg.operatorInitiated?.operatorEmail
          ? `${displayName} (${msg.operatorInitiated.operatorEmail})`
          : undefined
      }
      avatar={
        msg.operatorInitiated ? (
          <ChatAvatar
            name={displayName}
            title="Clarity Labs"
            className="border border-border-emphasized bg-background"
          >
            <LogoIcon size={15} className="h-[15px] w-[15px]" />
          </ChatAvatar>
        ) : undefined
      }
      meta={
        isEmail && !collapseEmailMessages ? (
          <EmailRecipientMeta
            toAddresses={msg.toAddresses}
            ccAddresses={msg.ccAddresses}
          />
        ) : null
      }
      channelIcon={
        isEmail ? (
          <MailIcon className={channelIconClass} />
        ) : msg.channel === "imessage" || mirroredToImessage ? (
          <MessageCircle className={channelIconClass} />
        ) : msg.channel === "slack" ? (
          <SiSlack className={channelIconClass} />
        ) : null
      }
      createdAt={msg._creationTime}
      channel={msg.channel}
      customBody={collapseEmailMessages && isEmail}
      body={collapseEmailMessages && isEmail ? (
        <EmailSummaryCard
          message={msg}
          onOpen={onOpenEmail}
          isOpen={openEmailMessageId === msg._id}
        />
      ) : (
        msg.channel === "slack" ? (
          <ProseMarkdown
            sourceFormat="slack-mrkdwn"
            gfm
            breaks
            className={MARKDOWN_STYLES}
            components={markdownComponents}
          >
            {msg.content}
          </ProseMarkdown>
        ) : (
          <PromptReferenceText
            content={msg.content}
            references={promptReferences}
            className="block"
          />
        )
      )}
      quotedText={quoted}
      attachments={msg.attachments?.length ? (
        <div className="mt-2">
          <ThreadAttachmentList
            attachments={msg.attachments}
            threadId={msg.threadId}
          />
        </div>
      ) : null}
      after={isOwnMessage && receiptStatus ? (
        <WebMessageReceipt status={receiptStatus} />
      ) : null}
    />
  );
});

/* ── Cancel button for stuck processing messages ── */
function CancelButton({ messageId }: { messageId: Id<"threadMessages"> }) {
  const cancel = useMutation(api.threads.cancelProcessing);
  const { pending, run } = useChatAction();
  return (
    <PillButton
      type="button"
      disabled={pending}
      onClick={() =>
        void run(async () => {
          try {
            await cancel({ messageId });
          } catch {
            toast.error("Failed to cancel");
          }
        })
      }
      variant="ghost"
      size="compact"
    >
      {pending ? "Cancelling..." : "Cancel"}
    </PillButton>
  );
}

function useRetryAgentResponse(messageId: Id<"threadMessages">) {
  const retry = useMutation(api.threads.retryAgentResponse);
  const { pending, run } = useChatAction();
  return {
    retrying: pending,
    retry: () =>
      void run(async () => {
        try {
          await retry({ messageId });
        } catch {
          toast.error("Failed to retry");
        }
      }),
  };
}

function TryAgainMessageButton({
  messageId,
}: {
  messageId: Id<"threadMessages">;
}) {
  const { retrying, retry } = useRetryAgentResponse(messageId);
  return (
    <PillButton
      type="button"
      disabled={retrying}
      onClick={retry}
      variant="icon"
      size="compact"
      label="Try again"
    >
      <RotateCcw className={`h-3 w-3 ${retrying ? "animate-spin" : ""}`} />
    </PillButton>
  );
}

/* ── Retry button for failed/blank agent messages ── */
function RetryButton({ messageId }: { messageId: Id<"threadMessages"> }) {
  const { retrying, retry } = useRetryAgentResponse(messageId);
  return (
    <PillButton
      type="button"
      disabled={retrying}
      onClick={retry}
      variant="ghost"
      size="compact"
      className="mt-2 ml-9.5"
    >
      <RotateCcw className={`w-3 h-3 ${retrying ? "animate-spin" : ""}`} />
      {retrying ? "Retrying..." : "Retry response"}
    </PillButton>
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
