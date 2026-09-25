"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { ChevronRight, RotateCcw } from "lucide-react";
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
import { ChatAttachmentList } from "@/components/chat/attachment-chip";
import {
  ChatAssistantTurn,
  ChatCopyButton,
  ChatUserTurn,
} from "@/components/chat/chat-message";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { ChatDisclosure } from "@/components/chat/disclosure";
import { useChatAction } from "@/components/chat/use-chat-action";
import { AgentDockSuggestions } from "@/components/agent-dock/agent-dock-suggestions";
import { ProseMarkdown } from "@/components/prose-markdown";
import { PillButton } from "@/components/ui/pill-button";
import {
  operatorAgentApi,
  type OperatorAgentConfirmation,
  type OperatorAgentIntent,
  type OperatorAgentMessage,
  type OperatorAgentThreadDetail,
} from "@/lib/operator-agent-api";
import { cn } from "@/lib/utils";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { OperatorEmailMessage } from "./operator-email-message";
import { OperatorThreadChannelIcon } from "./operator-thread-channel";
import {
  operatorConversationEntries,
  OperatorToolActivity,
  OperatorToolActivityGroup,
} from "./operator-tool-activity";

const SETTLED_CONFIRMATION_STATUS: Record<
  Exclude<OperatorAgentConfirmation["state"], "approved" | "pending">,
  { label: string } & StatusPresentation
> = {
  cancelled: { label: "Cancelled", tone: "neutral", indicator: "cancelled" },
  expired: { label: "Expired", tone: "warning" },
  superseded: { label: "Superseded", tone: "neutral", indicator: "inactive" },
  unavailable: { label: "No longer available", tone: "neutral", indicator: "inactive" },
};

function operatorConfirmationStatus(
  confirmation: OperatorAgentConfirmation,
): { label: string } & StatusPresentation {
  if (confirmation.state === "approved") {
    return {
      label: confirmation.approvalMode === "automatic" ? "Auto-approved" : "Approved",
      tone: "success",
    };
  }
  if (confirmation.state === "pending") {
    return {
      label: confirmation.actionable ? "Approval required" : "Awaiting approval",
      tone: "warning",
      indicator: "waiting",
    };
  }
  return SETTLED_CONFIRMATION_STATUS[confirmation.state];
}

function isAutoApproved(confirmation: OperatorAgentConfirmation) {
  return (
    confirmation.state === "approved" &&
    confirmation.approvalMode === "automatic"
  );
}

/** Consecutive auto-approved confirmations collapse into one disclosure. */
function groupOperatorConfirmations(
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

type RenderConfirmation = (confirmation: OperatorAgentConfirmation) => ReactNode;

function OperatorMessageFooter({
  message,
  confirmations,
  activeRun,
  renderConfirmation,
}: {
  message: OperatorAgentMessage;
  confirmations: OperatorAgentConfirmation[];
  activeRun: boolean;
  renderConfirmation: RenderConfirmation;
}) {
  const rerunTurn = useMutation(operatorAgentApi.rerunTurn);
  const rerunAction = useChatAction();
  const [expanded, setExpanded] = useState(false);
  const approved = confirmations.filter(isAutoApproved);
  const disabled = rerunAction.pending || activeRun;
  function rerun(includeErrorContext: boolean) {
    const target = message.rerun;
    if (!target || activeRun) return;
    void rerunAction.run(
      () => rerunTurn({ runId: target.runId, includeErrorContext }),
      (error) => getUserFacingErrorMessage(error, "Could not rerun the turn"),
    );
  }
  const controlClass = "text-muted-foreground/50 hover:text-muted-foreground";
  return (
    <div className="-mt-2 space-y-2">
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
  prompts,
  launchingIntentId,
  onSelect,
  onSelectPrompt,
}: {
  intents: OperatorAgentIntent[] | undefined;
  prompts: Array<{ label: string; prompt: string }>;
  launchingIntentId: string | null;
  onSelect: (intentId: string) => void;
  onSelectPrompt: (prompt: string) => void;
}) {
  if (intents === undefined) {
    return (
      <div className="mt-auto flex justify-center pb-4">
        <Spinner className="text-muted-foreground" />
      </div>
    );
  }
  return (
    <AgentDockSuggestions
      items={[
        ...intents,
        ...prompts
          .filter((prompt) => !intents.some((intent) => intent.label === prompt.label))
          .map((prompt) => ({ id: `prompt:${prompt.label}`, label: prompt.label })),
      ].slice(0, 5)}
      pendingId={launchingIntentId}
      onSelect={(id) => {
        const prompt = prompts.find((item) => `prompt:${item.label}` === id);
        if (prompt) onSelectPrompt(prompt.prompt);
        else onSelect(id);
      }}
    />
  );
}

function OperatorMessageRow({
  threadId,
  message,
  working,
  showSender,
  onFollowUp,
  presentationDisabled,
}: {
  threadId: string;
  message: OperatorAgentMessage;
  working: boolean;
  showSender: boolean;
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
    <ChatAttachmentList className="mt-2" size="compact"
      operatorThreadId={threadId}
      attachments={message.attachments}
    />
  ) : null;

  if (message.role === "assistant") {
    if (!working && !content && !attachments && !message.presentation)
      return null;
    return (
      <ChatAssistantTurn
        working={working}
        tools={message.usedTools}
        toolCalls={message.toolCalls}
        audience="operator"
        content={content}
        channel={bubbleChannel}
        isError={message.status === "error"}
        presentation={message.status ? undefined : message.presentation}
        onFollowUp={onFollowUp}
        presentationDisabled={presentationDisabled}
      >
        {attachments}
      </ChatAssistantTurn>
    );
  }

  const emailBody = message.channel === "email" && Boolean(content);
  return (
    <ChatUserTurn
      own
      showSender={showSender}
      name={message.userName?.trim() || "Operator"}
      createdAt={message.createdAt}
      channel={bubbleChannel}
      isError={message.status === "error"}
      customBody={emailBody}
      channelIcon={
        <OperatorThreadChannelIcon
          channel={message.channel}
          className="size-3 shrink-0 text-muted-foreground/45"
        />
      }
      body={emailBody ? (
        <OperatorEmailMessage message={message} attachments={attachments} />
      ) : !content ? null : message.channel === "slack" ? (
        <ProseMarkdown sourceFormat="slack-mrkdwn" gfm breaks>
          {content}
        </ProseMarkdown>
      ) : (
        <p className="whitespace-pre-wrap wrap-anywhere">{content}</p>
      )}
      attachments={emailBody ? null : attachments}
    />
  );
}

export function OperatorConversation({
  activeThreadId,
  loading,
  detail,
  intents,
  prompts,
  launchingIntentId,
  confirmationBusyId,
  onSelectIntent,
  onSelectPrompt,
  onDecision,
  composer,
  onFollowUp,
  presentationDisabled,
}: {
  activeThreadId: string | null;
  loading: boolean;
  detail: OperatorAgentThreadDetail;
  intents: OperatorAgentIntent[] | undefined;
  prompts: Array<{ label: string; prompt: string }>;
  launchingIntentId: string | null;
  confirmationBusyId: string | null;
  onSelectIntent: (intentId: string) => void;
  onSelectPrompt: (prompt: string) => void;
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
  const multipleSenders =
    new Set(
      detail.messages
        .filter((message) => message.role === "user")
        .map((message) => message.userName?.trim() || "Operator"),
    ).size > 1;
  const hasPendingConfirmation = detail.confirmations.some(
    (confirmation) => confirmation.state === "pending",
  );
  const confirmationCard = (confirmation: OperatorAgentConfirmation) => (
    <ChatApprovalCard
      key={confirmation.id}
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
      composer={composer}
    >
      {loading ? (
        <div className="flex min-h-40 items-center justify-center">
          <Spinner className="text-muted-foreground" />
        </div>
      ) : !hasMessages ? (
        <EmptyThread
          intents={intents}
          prompts={prompts}
          launchingIntentId={launchingIntentId}
          onSelect={onSelectIntent}
          onSelectPrompt={onSelectPrompt}
        />
      ) : (
        entries.map((entry) => {
          if (entry.kind === "tool_calls") {
            return <OperatorToolActivityGroup key={entry.activities[0].request.id} activities={entry.activities} />;
          }
          const { request: message, response, confirmations } = entry.activity;
          const settledAnswer =
            message.role === "assistant" &&
            message.status !== "processing" &&
            !message.isDirectToolRequest;
          const renderConfirmation = (confirmation: OperatorAgentConfirmation) => (
            <div key={confirmation.id} className="w-full">
              {confirmationCard(confirmation)}
              {message.isDirectToolRequest && !isAutoApproved(confirmation) ? (
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
          );
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
                      <ChatAttachmentList className="mt-2" size="compact"
                        key={item.id}
                        operatorThreadId={threadId}
                        attachments={item.attachments}
                      />
                    ) : null,
                  )}
                </>
              ) : (
                <OperatorMessageRow
                  threadId={threadId}
                  message={message}
                  showSender={multipleSenders}
                  onFollowUp={onFollowUp}
                  presentationDisabled={presentationDisabled || hasPendingConfirmation}
                  working={message.status === "processing" && !hasPendingConfirmation}
                />
              )}
              {settledAnswer ? (
                <OperatorMessageFooter
                  message={message}
                  confirmations={confirmations}
                  activeRun={detail.activeRun}
                  renderConfirmation={confirmationCard}
                />
              ) : null}
              {groupOperatorConfirmations(
                settledAnswer
                  ? confirmations.filter((confirmation) => !isAutoApproved(confirmation))
                  : confirmations,
              ).map((group) =>
                isAutoApproved(group[0]) ? (
                  <ChatDisclosure
                    key={group[0].id}
                    summaryClassName="text-muted-foreground hover:text-foreground"
                    summary={
                      <span>
                        {group.length} {group.length === 1 ? "task" : "tasks"} auto-approved
                      </span>
                    }
                  >
                    <div className="space-y-2">{group.map(renderConfirmation)}</div>
                  </ChatDisclosure>
                ) : (
                  <Fragment key={group[0].id}>{renderConfirmation(group[0])}</Fragment>
                ),
              )}
              {message.isDirectToolRequest && confirmations.some(isAutoApproved) ? (
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
