"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import dayjs from "dayjs";
import {
  FileText,
  Mail as MailIcon,
  RotateCcw,
} from "lucide-react";
import { MessageMetaTag } from "@claritylabs-inc/ui/components/message-meta-tag";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { PresentationFollowUp } from "@/components/chat-presentation/context";
import { useChatAttachments } from "@/components/chat/attachment-grid";
import { ChatChannelIcon } from "@/components/chat/channel-icon";
import {
  ChatAssistantTurn,
  ChatAvatar,
  ChatCopyButton,
  ChatErrorNotice,
  ChatUserTurn,
} from "@/components/chat/chat-message";
import { MessageContextTag } from "@/components/chat/message-context-tag";
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
import { useCachedAgentTargets } from "@/lib/sync/spot-cached-queries";
import { typeStyle } from "@/lib/typography";
import {
  CertificateHoldArtifacts,
  EmailStackCard,
  EmailSummaryCard,
  VendorComplianceArtifacts,
  mailboxTaskDisplayName,
  normalizeMailboxTask,
  usePendingEmailActions,
} from "./artifacts";
import {
  isMessageFromViewer,
  messageSenderName,
} from "./thread-messages";
import type {
  ThreadArtifactRef,
  ThreadMessage,
} from "./types";

type ThreadContext = { pageType: string; entityId?: string; summary?: string };

const TARGET_LISTS = {
  policy: "policies",
  requirement: "requirements",
  mailbox: "mailboxes",
} as const;

function messagePromptReferences(
  message: ThreadMessage,
  targets: ReturnType<typeof useCachedAgentTargets>,
  context?: ThreadContext,
) {
  const references: PromptReference[] = [];
  const seen = new Set<string>();
  const add = (kind: PromptReferenceTagKind, ids?: string[]) => {
    ids?.forEach((id) => {
      const key = `${kind}:${id}`;
      if (seen.has(key)) return;
      const label =
        (kind !== "mailbox" && context?.pageType === kind && context.entityId === id
          ? (context.summary ?? `Current ${kind}`)
          : undefined) ??
        targets?.[TARGET_LISTS[kind]].find((target) => target.id === id)?.label;
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

const SELECTED_PILL = "border-border-focus bg-foreground/[0.04] text-foreground/75";

/** Sources, files, mailbox-task pills, retry and copy under a settled answer. */
function AssistantMessageFooter({
  msg,
  content,
  openArtifact,
  onOpenArtifact,
}: {
  msg: ThreadMessage;
  content: string;
  openArtifact: ThreadArtifactRef | null;
  onOpenArtifact: (ref: ThreadArtifactRef) => void;
}) {
  const [isMailboxExpanded, setIsMailboxExpanded] = useState(false);
  const [isSourcesExpanded, setIsSourcesExpanded] = useState(true);
  // Policy references are intentional presentation selections, not retrieval evidence.
  const policyIds = [...new Set(msg.referencedPolicyIds ?? [])];
  const attachments = msg.attachments ?? [];
  const files = useChatAttachments(attachments, msg.threadId, "mt-1.5 w-full");
  const mailboxTasks = (msg.toolArtifacts ?? [])
    .filter((artifact) => artifact.type === "mailbox_task")
    .map((artifact, index) => ({ index, task: normalizeMailboxTask(artifact.data) }));
  const reviewEmails = mailboxTasks.flatMap(({ index, task }) =>
    task.status === "needs_review"
      ? task.emails.map((email, emailIndex) => ({ index, emailIndex, email }))
      : [],
  );
  const backgroundTasks = mailboxTasks.filter(
    ({ task }) => task.status !== "needs_review",
  );
  const selected =
    openArtifact?.kind === "mailbox_task" && openArtifact.messageId === msg._id
      ? openArtifact
      : null;
  const retryable = msg.channel === "chat" || msg.channel === "imessage";
  if (
    policyIds.length === 0 &&
    attachments.length === 0 &&
    mailboxTasks.length === 0 &&
    !content.trim() &&
    !retryable
  )
    return null;

  const openMailbox = (index: number, emailIndex?: number) =>
    onOpenArtifact({ kind: "mailbox_task", messageId: msg._id, index, emailIndex });
  const mailboxTaskPill = ({ index, task }: (typeof mailboxTasks)[number]) => (
    <button
      key={`mailbox-${index}`}
      type="button"
      onClick={() => openMailbox(index)}
      className={`inline-flex h-6 max-w-52 items-center justify-center gap-1.5 rounded-full border bg-transparent px-2 transition-colors ${typeStyle("label.tag")} ${
        selected?.index === index
          ? SELECTED_PILL
          : "border-input text-muted-foreground/60 hover:border-border-emphasized hover:bg-foreground/3 hover:text-foreground/75"
      }`}
    >
      <span className="text-muted-foreground/35">{index + 1}</span>
      <span className="truncate">{mailboxTaskDisplayName(task)}</span>
    </button>
  );

  return (
    <div className="mt-1.5 min-w-0">
      <div className="flex items-start gap-2">
        <div className="-ml-2 flex shrink-0 items-center gap-1">
          {retryable ? <RetryButton messageId={msg._id} iconOnly /> : null}
          <ChatCopyButton
            content={content}
            size="small"
            className={MESSAGE_ACTION_CLASS}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {policyIds.length > 0 && (
            <>
              <MessageMetaTag
                icon={<FileText />}
                label={policyIds.length === 1 ? "Source" : "Sources"}
                count={policyIds.length}
                isActive={isSourcesExpanded}
                onClick={() => setIsSourcesExpanded((value) => !value)}
              />
              {isSourcesExpanded
                ? policyIds.map((id) => (
                    <span key={id}>
                      <PolicySourcePill
                        id={id}
                        citedSections={msg.citedSections}
                        citedCoverageNames={msg.citedCoverageNames}
                        citedSourceSpanIds={msg.citedSourceSpanIds}
                      />
                    </span>
                  ))
                : null}
            </>
          )}
          {files.trigger}
          {reviewEmails.map(({ index, emailIndex, email }) => (
            <span key={`mailbox-review-${index}-${emailIndex}`}>
              <PillButton
                size="compact"
                variant="secondary"
                label={`Review ${email.subject}`}
                title={email.subject}
                onClick={() => openMailbox(index, emailIndex)}
                className={`max-w-64 ${
                  selected?.index === index && selected.emailIndex === emailIndex
                    ? SELECTED_PILL
                    : "text-muted-foreground/60"
                }`}
              >
                <MailIcon className="h-3 w-3" />
                <span className="truncate">{email.subject}</span>
              </PillButton>
            </span>
          ))}
          {backgroundTasks.length === 1 ? (
            mailboxTaskPill(backgroundTasks[0])
          ) : backgroundTasks.length > 1 ? (
            <>
              <MessageMetaTag
                icon={<LogoIcon size={12} className="h-3 w-3" />}
                label="Mailbox tasks"
                count={backgroundTasks.length}
                isActive={isMailboxExpanded}
                onClick={() => setIsMailboxExpanded((value) => !value)}
              />
              {isMailboxExpanded ? (
                <div className="flex flex-wrap items-start gap-1.5">
                  {backgroundTasks.map(mailboxTaskPill)}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      {files.grid}
    </div>
  );
}

const MARKDOWN_STYLES = "[&_a]:text-primary-light [&_a]:underline";
const IMESSAGE_MARKDOWN_STYLES =
  `${MARKDOWN_STYLES} ${typeStyle("body.large")} ` +
  "[&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_ul]:pl-4 [&_ol]:pl-4 " +
  `[&_li]:my-0.5 ${typeStyle("prose.default")}`;

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

/** Countdown before a scheduled email leaves, with a cancel control. */
function PendingSendCountdown({
  pendingEmailId,
}: {
  pendingEmailId: Id<"pendingEmails">;
}) {
  const { pendingEmail, run } = usePendingEmailActions("countdown", pendingEmailId);
  const scheduledAt =
    pendingEmail?.status === "pending" ? pendingEmail.scheduledSendTime : undefined;
  const [now, setNow] = useState(() => dayjs().valueOf());

  useEffect(() => {
    if (scheduledAt === undefined) return;
    const interval = setInterval(() => setNow(dayjs().valueOf()), 200);
    return () => clearInterval(interval);
  }, [scheduledAt]);

  if (scheduledAt === undefined) return null;
  const remaining = Math.max(0, Math.ceil((scheduledAt - now) / 1000));

  return (
    <div className="flex items-center gap-2 mt-1.5">
      <span className={`text-muted-foreground/50 ${typeStyle("caption.default")}`}>
        Sending in {remaining}s...
      </span>
      <PillButton
        type="button"
        variant="destructive"
        size="compact"
        onClick={() =>
          void run("cancel", {
            success: "Email cancelled",
            failure: "Failed to cancel",
          })
        }
      >
        Cancel
      </PillButton>
    </div>
  );
}

const EMPTY_RELATED_EMAIL_MESSAGES: ThreadMessage[] = [];

/** Tenant thread message rendered through the shared chat turns. */
export const UnifiedMessageBubble = memo(function UnifiedMessageBubble({
  msg,
  relatedEmailMessages = EMPTY_RELATED_EMAIL_MESSAGES,
  viewerId,
  viewerEmail,
  showSender = true,
  mirroredToImessage,
  threadContext,
  collapseEmailMessages,
  openArtifact,
  onOpenArtifact,
  onPresentationFollowUp,
  presentationDisabled = true,
}: {
  msg: ThreadMessage;
  relatedEmailMessages?: ThreadMessage[];
  viewerId?: string;
  viewerEmail?: string;
  /** Avatar, name and time; hidden while only one person is writing. */
  showSender?: boolean;
  mirroredToImessage?: boolean;
  threadContext?: ThreadContext;
  collapseEmailMessages?: boolean;
  openArtifact: ThreadArtifactRef | null;
  onOpenArtifact: (ref: ThreadArtifactRef) => void;
  onPresentationFollowUp?: PresentationFollowUp;
  presentationDisabled?: boolean;
}) {
  const userFiles = useChatAttachments(msg.role === "user" ? (msg.attachments ?? []) : [], msg.threadId);
  const agentTargets = useCachedAgentTargets(msg.orgId);
  const promptReferences = useMemo(
    () => messagePromptReferences(msg, agentTargets, threadContext),
    [agentTargets, msg, threadContext],
  );
  const openEmail = (message: ThreadMessage) =>
    onOpenArtifact({ kind: "email", messageId: message._id });
  const openEmailId =
    openArtifact?.kind === "email" ? openArtifact.messageId : null;
  const working = msg.role === "agent" && msg.status === "processing";
  const isEmail = msg.channel === "email";
  const emailCard = collapseEmailMessages && isEmail && !working;

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
          openArtifact={openArtifact}
          onOpenArtifact={onOpenArtifact}
        />
        <CertificateHoldArtifacts artifacts={msg.toolArtifacts} />
        {relatedEmailMessages.length > 0 ? (
          <div className={working ? "mt-3" : "mt-4"}>
            <EmailStackCard
              messages={relatedEmailMessages}
              onOpen={openEmail}
              isOpenMessageId={openEmailId}
            />
          </div>
        ) : null}
      </>
    );

    return (
      <ChatAssistantTurn
        working={working}
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
        markdownClassName={
          msg.channel === "imessage" ? IMESSAGE_MARKDOWN_STYLES : MARKDOWN_STYLES
        }
        markdownComponents={markdownComponents}
        organizationId={msg.orgId}
        presentation={working ? undefined : msg.presentation}
        structuredReferences
        onFollowUp={onPresentationFollowUp}
        presentationDisabled={presentationDisabled}
        body={emailCard ? (
          <EmailSummaryCard
            message={msg}
            onOpen={openEmail}
            isOpen={openEmailId === msg._id}
          />
        ) : undefined}
        belowAnswer={!working && !emailCard ? (
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
            <AssistantMessageFooter
              msg={msg}
              content={displayContent}
              openArtifact={openArtifact}
              onOpenArtifact={onOpenArtifact}
            />
            {artifacts}
          </>
        ) : undefined}
      />
    );
  }

  const isOwnMessage = isMessageFromViewer(msg, viewerId, viewerEmail);
  const displayName = messageSenderName(msg);

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
        <ChatChannelIcon
          channel={mirroredToImessage ? "imessage" : msg.channel}
          className="h-3 w-3 text-muted-foreground/45"
        />
      }
      createdAt={msg._creationTime}
      channel={msg.channel}
      customBody={emailCard}
      body={emailCard ? (
        <EmailSummaryCard
          message={msg}
          onOpen={openEmail}
          isOpen={openEmailId === msg._id}
        />
      ) : msg.channel === "slack" ? (
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
        <span className="block">
          <MessageContextTag context={msg.pageContext} />
          <PromptReferenceText
            content={msg.content}
            references={promptReferences}
          />
        </span>
      )}
      quotedText={isEmail ? (msg.emailContent?.quotedText ?? null) : null}
      attachments={msg.attachments?.length ? (
        <div className="mt-2">
          {userFiles.trigger}
          {userFiles.grid}
        </div>
      ) : null}
      showSender={showSender}
    />
  );
});

function CancelButton({ messageId }: { messageId: Id<"threadMessages"> }) {
  const cancel = useMutation(api.threads.cancelProcessing);
  const { pending, run } = useChatAction();
  return (
    <PillButton
      type="button"
      disabled={pending}
      onClick={() => void run(() => cancel({ messageId }), "Failed to cancel")}
      variant="ghost"
      size="compact"
    >
      {pending ? "Cancelling..." : "Cancel"}
    </PillButton>
  );
}

/** Retries a failed or blank agent response; `iconOnly` is the footer form. */
/** Matches the operator message footer's copy and rerun controls. */
const MESSAGE_ACTION_CLASS =
  "text-muted-foreground/50 hover:text-muted-foreground";

function RetryButton({
  messageId,
  iconOnly = false,
}: {
  messageId: Id<"threadMessages">;
  iconOnly?: boolean;
}) {
  const retry = useMutation(api.threads.retryAgentResponse);
  const { pending, run } = useChatAction();
  return (
    <PillButton
      type="button"
      disabled={pending}
      onClick={() => void run(() => retry({ messageId }), "Failed to retry")}
      variant={iconOnly ? "icon" : "ghost"}
      size={iconOnly ? "small" : "compact"}
      label={iconOnly ? "Try again" : undefined}
      className={iconOnly ? MESSAGE_ACTION_CLASS : "mt-2 ml-9.5"}
    >
      <RotateCcw
        className={`${iconOnly ? "size-3.5" : "h-3 w-3"} ${pending ? "animate-spin" : ""}`}
      />
      {iconOnly ? null : pending ? "Retrying..." : "Retry response"}
    </PillButton>
  );
}

/** Shows the policy a chat was started from beneath its first message. */
export function ThreadContextLink({ context }: { context: ThreadContext }) {
  return context.pageType === "policy" && context.entityId ? (
    <PolicyReferenceCard id={context.entityId} />
  ) : null;
}
