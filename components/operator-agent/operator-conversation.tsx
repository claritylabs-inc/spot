"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { ChevronRight, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@claritylabs-inc/ui/components/dropdown-menu";
import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import type { StatusPresentation } from "@claritylabs-inc/ui/components/status-tag";
import {
  ChatApprovalCard,
  type ChatApprovalDecision,
} from "@/components/chat/approval-card";
import { ChatAttachmentChip } from "@/components/chat/attachment-chip";
import {
  ChatAnswer,
  ChatAssistantMessage,
  ChatCopyButton,
  ChatUserMessage,
} from "@/components/chat/chat-message";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { ChatMessageBubble } from "@/components/chat/message-bubble";
import { useChatAction } from "@/components/chat/use-chat-action";
import { ProseMarkdown } from "@/components/prose-markdown";
import { LogoIcon } from "@/components/ui/logo-icon";
import { PillButton } from "@/components/ui/pill-button";
import {
  operatorAgentApi,
  type OperatorAgentAttachment,
  type OperatorAgentConfirmation,
  type OperatorAgentIntent,
  type OperatorAgentMessage,
  type OperatorAgentThreadDetail,
} from "@/lib/operator-agent-api";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { cn } from "@/lib/utils";
import { OperatorEmailMessage } from "./operator-email-message";
import { OperatorThreadChannelIcon } from "./operator-thread-channel";
import {
  operatorConversationEntries,
  OperatorToolActivity,
  OperatorToolActivityGroup,
} from "./operator-tool-activity";

function OperatorMessageAttachments({
  threadId,
  attachments,
}: {
  threadId: string;
  attachments: OperatorAgentAttachment[];
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((attachment) => (
        <OperatorAttachmentChip
          key={attachment.fileId}
          threadId={threadId}
          attachment={attachment}
        />
      ))}
    </div>
  );
}

function OperatorAttachmentChip({
  threadId,
  attachment,
}: {
  threadId: string;
  attachment: OperatorAgentAttachment;
}) {
  const url = useQuery(operatorAgentApi.getAttachmentUrl, {
    threadId,
    fileId: attachment.fileId,
  });
  return (
    <ChatAttachmentChip
      attachment={attachment}
      url={url}
      isLoading={url === undefined}
      size="compact"
    />
  );
}

export function operatorConfirmationStatus(
  confirmation: OperatorAgentConfirmation,
): { label: string } & StatusPresentation {
  switch (confirmation.state) {
    case "approved":
      return {
        label:
          confirmation.approvalMode === "automatic" ? "Auto-approved" : "Approved",
        tone: "success",
      };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral", indicator: "cancelled" };
    case "expired":
      return { label: "Expired", tone: "warning" };
    case "superseded":
      return { label: "Superseded", tone: "neutral", indicator: "inactive" };
    case "unavailable":
      return { label: "No longer available", tone: "neutral", indicator: "inactive" };
    case "pending":
      return {
        label: confirmation.actionable ? "Approval required" : "Awaiting approval",
        tone: "warning",
        indicator: "waiting",
      };
  }
}

function isAutoApproved(confirmation: OperatorAgentConfirmation) {
  return (
    confirmation.state === "approved" &&
    confirmation.approvalMode === "automatic"
  );
}

/** Consecutive auto-approved confirmations collapse into one disclosure. */
export function groupOperatorConfirmations(
  confirmations: OperatorAgentConfirmation[],
) {
  const groups: OperatorAgentConfirmation[][] = [];
  for (const confirmation of confirmations) {
    const previous = groups.at(-1);
    if (
      isAutoApproved(confirmation) &&
      previous &&
      isAutoApproved(previous[0])
    ) {
      previous.push(confirmation);
    } else {
      groups.push([confirmation]);
    }
  }
  return groups;
}

function ConfirmationArtifacts({
  confirmations,
  renderConfirmation,
}: {
  confirmations: OperatorAgentConfirmation[];
  renderConfirmation: (confirmation: OperatorAgentConfirmation) => ReactNode;
}) {
  return groupOperatorConfirmations(confirmations).map((group) =>
    isAutoApproved(group[0]) ? (
      <details key={group[0].id} className="group/approvals min-w-0">
        <summary
          className={cn(
            "flex w-fit cursor-pointer list-none items-center gap-2 rounded-md py-2 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden",
            typeStyle("caption.default"),
          )}
        >
          <ChevronRight className="size-4 shrink-0 group-open/approvals:rotate-90" />
          <span>
            {group.length} {group.length === 1 ? "task" : "tasks"} auto-approved
          </span>
        </summary>
        <div className="space-y-2">{group.map(renderConfirmation)}</div>
      </details>
    ) : (
      <Fragment key={group[0].id}>{renderConfirmation(group[0])}</Fragment>
    ),
  );
}

function OperatorMessageFooter({
  message,
  confirmations,
  activeRun,
  renderConfirmation,
}: {
  message: OperatorAgentMessage;
  confirmations: OperatorAgentConfirmation[];
  activeRun: boolean;
  renderConfirmation: (confirmation: OperatorAgentConfirmation) => ReactNode;
}) {
  const rerunTurn = useMutation(operatorAgentApi.rerunTurn);
  const rerunAction = useChatAction();
  const [expanded, setExpanded] = useState(false);
  const approved = confirmations.filter(isAutoApproved);
  const disabled = rerunAction.pending || activeRun;
  function rerun(includeErrorContext: boolean) {
    const target = message.rerun;
    if (!target || activeRun) return;
    void rerunAction.run(async () => {
      try {
        await rerunTurn({ runId: target.runId, includeErrorContext });
      } catch (error) {
        toast.error(getUserFacingErrorMessage(error, "Could not rerun the turn"));
      }
    });
  }
  const controlClass = "text-muted-foreground/50 hover:text-muted-foreground";
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="-ml-2 flex items-center gap-1">
          <ChatCopyButton
            content={message.content}
            size="small"
            className={controlClass}
          />
          {message.rerun ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={disabled}
                render={
                  <PillButton
                    variant="icon"
                    size="small"
                    iconOnly
                    label="Rerun options"
                    disabled={disabled}
                    className={controlClass}
                  />
                }
              >
                {rerunAction.pending ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <RotateCcw className="size-3.5" />
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem disabled={disabled} onClick={() => rerun(false)}>
                  Rerun
                </DropdownMenuItem>
                {message.rerun.withErrorContext ? (
                  <DropdownMenuItem
                    disabled={disabled}
                    onClick={() => rerun(true)}
                  >
                    Rerun with error context
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {approved.length > 0 ? (
          <PillButton
            variant="ghost"
            size="small"
            className={cn("-mr-2", controlClass)}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {approved.length} auto-approved
            <ChevronRight className={cn("size-3", expanded && "rotate-90")} />
          </PillButton>
        ) : null}
      </div>
      {expanded ? (
        <div className="space-y-4">{approved.map(renderConfirmation)}</div>
      ) : null}
    </div>
  );
}

function EmptyThread({
  intents,
  launchingIntentId,
  onSelect,
}: {
  intents: OperatorAgentIntent[] | undefined;
  launchingIntentId: string | null;
  onSelect: (intentId: string) => void;
}) {
  return (
    <div className="flex min-h-full flex-col justify-center py-10">
      <LogoIcon className="mb-4 text-muted-foreground" size={24} />
      <h2 className={cn("text-foreground", typeStyle("body.medium"))}>
        What do you need?
      </h2>
      <p
        className={cn(
          "mt-1 text-muted-foreground",
          typeStyle("caption.default"),
        )}
      >
        Pick a task or describe what you need. Sensitive actions still require
        your approval.
      </p>
      <div className="mt-6 divide-y divide-border border-y border-border">
        {intents === undefined ? (
          <div className="flex h-20 items-center justify-center">
            <Spinner className="text-muted-foreground" />
          </div>
        ) : (
          intents.map((intent) => (
            <button
              key={intent.id}
              type="button"
              disabled={launchingIntentId !== null}
              onClick={() => onSelect(intent.id)}
              className={cn(
                "flex w-full items-center gap-2 py-3 text-left text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50",
                typeStyle("caption.medium"),
              )}
            >
              {launchingIntentId === intent.id ? (
                <Spinner className="size-3.5" />
              ) : null}
              {intent.label}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function OperatorMessageRow({
  threadId,
  message,
  working,
  onFollowUp,
  presentationDisabled,
}: {
  threadId: string;
  message: OperatorAgentMessage;
  working: boolean;
  onFollowUp: (message: string) => Promise<void>;
  presentationDisabled: boolean;
}) {
  const bubbleChannel = message.channel === "mcp" ? "chat" : message.channel;
  const content =
    message.content.trim() ||
    (message.status === "error"
      ? "The operator task failed."
      : message.status === "cancelled"
        ? "Task stopped."
        : "");
  const attachments = message.attachments?.length ? (
    <OperatorMessageAttachments
      threadId={threadId}
      attachments={message.attachments}
    />
  ) : null;

  if (message.role === "assistant") {
    if (!working && !content && !attachments && !message.presentation)
      return null;
    return (
      <ChatAssistantMessage
        working={working}
        hasText={Boolean(content)}
        tools={message.usedTools}
        toolCalls={message.toolCalls}
      >
        <ChatAnswer
          audience="operator"
          content={content}
          channel={bubbleChannel}
          isError={message.status === "error"}
          presentation={message.status ? undefined : message.presentation}
          onFollowUp={onFollowUp}
          presentationDisabled={presentationDisabled}
        >
          {attachments}
        </ChatAnswer>
      </ChatAssistantMessage>
    );
  }

  return (
    <ChatUserMessage
      own
      name={message.userName?.trim() || "Operator"}
      createdAt={message.createdAt}
      channelIcon={
        <OperatorThreadChannelIcon
          channel={message.channel}
          className="size-3 shrink-0 text-muted-foreground/45"
        />
      }
    >
      {message.channel === "email" && content ? (
        <OperatorEmailMessage message={message} attachments={attachments} />
      ) : (
        <ChatMessageBubble
          role="user"
          channel={bubbleChannel}
          isOwnMessage
          isError={message.status === "error"}
        >
          {content ? (
            message.channel === "slack" ? (
              <ProseMarkdown sourceFormat="slack-mrkdwn" gfm breaks>
                {content}
              </ProseMarkdown>
            ) : (
              <p className="whitespace-pre-wrap wrap-anywhere">{content}</p>
            )
          ) : null}
          {attachments}
        </ChatMessageBubble>
      )}
    </ChatUserMessage>
  );
}

export function OperatorConversation({
  variant,
  activeThreadId,
  loading,
  detail,
  intents,
  launchingIntentId,
  confirmationBusyId,
  onSelectIntent,
  onDecision,
  composer,
  onFollowUp,
  presentationDisabled,
}: {
  variant: "rail" | "page";
  activeThreadId: string | null;
  loading: boolean;
  detail: OperatorAgentThreadDetail;
  intents: OperatorAgentIntent[] | undefined;
  launchingIntentId: string | null;
  confirmationBusyId: string | null;
  onSelectIntent: (intentId: string) => void;
  onDecision: (
    confirmation: OperatorAgentConfirmation,
    decision: ChatApprovalDecision,
  ) => void;
  composer: ReactNode;
  onFollowUp: (message: string) => Promise<void>;
  presentationDisabled: boolean;
}) {
  const entries = useMemo(() => operatorConversationEntries(detail), [detail]);
  const threadId = activeThreadId ?? "";
  const hasMessages = detail.messages.length > 0;
  const hasPendingConfirmation = detail.confirmations.some(
    (confirmation) => confirmation.state === "pending",
  );
  const confirmationCard = (confirmation: OperatorAgentConfirmation) => (
    <ChatApprovalCard
      status={operatorConfirmationStatus(confirmation)}
      title={confirmation.title}
      actionable={confirmation.state === "pending" && confirmation.actionable}
      destructive={confirmation.destructive}
      busy={confirmationBusyId === confirmation.id}
      onDecision={(decision) => onDecision(confirmation, decision)}
    />
  );

  return (
    <ChatMessageList
      className="min-h-0 flex-1"
      anchorKey={
        hasMessages
          ? `${activeThreadId}:${detail.messages.length}:${detail.confirmations.length}`
          : null
      }
      clearanceClassName={hasMessages ? "h-40" : undefined}
      compactComposer={variant === "rail"}
      composer={composer}
    >
      {loading ? (
        <div className="flex min-h-40 items-center justify-center">
          <Spinner className="text-muted-foreground" />
        </div>
      ) : !hasMessages ? (
        <EmptyThread
          intents={intents}
          launchingIntentId={launchingIntentId}
          onSelect={onSelectIntent}
        />
      ) : (
        entries.map((entry) => {
          if (entry.kind === "tool_calls") {
            return (
              <OperatorToolActivityGroup
                key={entry.activities[0].request.id}
                activities={entry.activities}
              />
            );
          }
          const { request: message, response, confirmations } = entry.activity;
          const settledAnswer =
            message.role === "assistant" &&
            message.status !== "processing" &&
            !message.isDirectToolRequest;
          return (
            <Fragment key={message.id}>
              {message.isDirectToolRequest ? (
                <>
                  {confirmations.length === 0 ? (
                    <OperatorToolActivity
                      request={message}
                      response={response}
                      awaitingApproval={false}
                    />
                  ) : null}
                  {[message, ...(response ? [response] : [])].map((item) =>
                    item.attachments?.length ? (
                      <OperatorMessageAttachments
                        key={item.id}
                        threadId={threadId}
                        attachments={item.attachments}
                      />
                    ) : null,
                  )}
                </>
              ) : (
                <OperatorMessageRow
                  threadId={threadId}
                  message={message}
                  onFollowUp={onFollowUp}
                  presentationDisabled={
                    presentationDisabled || hasPendingConfirmation
                  }
                  working={
                    message.status === "processing" && !hasPendingConfirmation
                  }
                />
              )}
              {settledAnswer ? (
                <OperatorMessageFooter
                  message={message}
                  confirmations={confirmations}
                  activeRun={detail.activeRun}
                  renderConfirmation={(confirmation) => (
                    <Fragment key={confirmation.id}>
                      {confirmationCard(confirmation)}
                    </Fragment>
                  )}
                />
              ) : null}
              <ConfirmationArtifacts
                confirmations={
                  settledAnswer
                    ? confirmations.filter(
                        (confirmation) => !isAutoApproved(confirmation),
                      )
                    : confirmations
                }
                renderConfirmation={(confirmation) => (
                  <div key={confirmation.id} className="w-full">
                    {confirmationCard(confirmation)}
                    {message.isDirectToolRequest &&
                    !isAutoApproved(confirmation) ? (
                      <div className="mt-2">
                        <OperatorToolActivity
                          request={message}
                          response={response}
                          awaitingApproval={confirmation.state === "pending"}
                          detailsOnly
                        />
                      </div>
                    ) : null}
                  </div>
                )}
              />
              {message.isDirectToolRequest &&
              confirmations.some(isAutoApproved) ? (
                <OperatorToolActivity
                  request={message}
                  response={response}
                  awaitingApproval={false}
                  detailsOnly
                />
              ) : null}
            </Fragment>
          );
        })
      )}
    </ChatMessageList>
  );
}
