"use client";

import { Avatar } from "@claritylabs-inc/ui/components/avatar";
import { operatorBatchApprovalDetails } from "@/lib/operator-batch-approval";
import { Fragment, useMemo, type ComponentProps, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { ChevronRight, RotateCcw } from "lucide-react";
import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import type { StatusPresentation } from "@claritylabs-inc/ui/components/status-tag";
import {
  ChatApprovalActions,
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
import { MessageContextTag } from "@/components/chat/message-context-tag";
import { ChatDisclosure } from "@/components/chat/disclosure";
import { hasAwaitingApprovalCall } from "@/components/chat/thinking-summary";
import { useChatAction } from "@/components/chat/use-chat-action";
import { AppShellPortal, useOptionalAppShellSlots } from "@/components/app-shell-slots";
import { AgentDockSuggestions } from "@/components/agent-dock/agent-dock-suggestions";
import { ProseMarkdown } from "@/components/prose-markdown";
import { PillButton } from "@/components/ui/pill-button";
import {
  operatorAgentApi,
  type OperatorAgentConfirmation,
  type OperatorAgentMessage,
  type OperatorAgentThreadDetail,
} from "@/lib/operator-agent-api";
import type { OperatorSuggestion } from "@/convex/lib/operatorSuggestionTypes";
import { useFollowedState } from "@/hooks/use-followed-state";
import { cn } from "@/lib/utils";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import type { OperatorEmailDraftView } from "@/lib/operator-email-draft";
import {
  OperatorEmailDraftCards,
  OperatorEmailDraftPanel,
  useOperatorEmailDrafts,
} from "./operator-email-drafts";
import { OperatorEmailMessage } from "./operator-email-message";
import { OperatorToolPreview } from "./operator-tool-preview";
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
  unavailable: {
    label: "No longer available",
    tone: "neutral",
    indicator: "inactive",
  },
};

function operatorConfirmationStatus(
  confirmation: OperatorAgentConfirmation,
): { label: string } & StatusPresentation {
  if (confirmation.state === "approved") {
    return {
      label:
        confirmation.approvalMode === "automatic"
          ? "Auto-approved"
          : "Approved",
      tone: "success",
    };
  }
  if (confirmation.state === "pending") {
    return {
      label: confirmation.actionable
        ? "Approval required"
        : "Awaiting approval",
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

type RenderConfirmation = (
  confirmation: OperatorAgentConfirmation,
) => ReactNode;

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
  const [expanded, setExpanded] = useFollowedState(
    `operator-conversation:${message.id}:approvals-expanded`,
    false,
  );
  const approved = confirmations.filter(isAutoApproved);
  const disabled = rerunAction.pending || activeRun;
  function rerun() {
    const target = message.rerun;
    if (!target || disabled) return;
    void rerunAction.run(
      () =>
        rerunTurn({
          runId: target.runId,
          includeErrorContext: target.withErrorContext,
        }),
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
            <PillButton
              variant="icon"
              size="small"
              iconOnly
              label="Retry"
              disabled={disabled}
              className={controlClass}
              onClick={rerun}
            >
              {rerunAction.pending ? (
                <Spinner className="size-3.5" />
              ) : (
                <RotateCcw className="size-3.5" />
              )}
            </PillButton>
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
  suggestions,
  launchingSuggestionKey,
  onSelect,
}: {
  suggestions: OperatorSuggestion[] | undefined;
  launchingSuggestionKey: string | null;
  onSelect: (suggestion: OperatorSuggestion) => void;
}) {
  if (suggestions === undefined) {
    return (
      <div className="mt-auto flex justify-center pb-4">
        <Spinner className="text-muted-foreground" />
      </div>
    );
  }
  return (
    <AgentDockSuggestions
      items={suggestions.map((suggestion) => ({
        id: suggestion.key,
        label: suggestion.label,
      }))}
      pendingId={launchingSuggestionKey}
      onSelect={(id) => {
        const suggestion = suggestions.find((item) => item.key === id);
        if (suggestion) onSelect(suggestion);
      }}
    />
  );
}

/** What an approval will do, under the waiting call's row. */
function ApprovalDetail({ title }: { title: string }) {
  const batch = operatorBatchApprovalDetails(title);
  if (!batch) return <p className="whitespace-pre-line">{title}</p>;
  return (
    <>
      <p>{batch.header}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {batch.items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </>
  );
}

function OperatorMessageRow({
  threadId,
  message,
  viewerUserId,
  working,
  turnActive,
  showSender,
  onFollowUp,
  presentationDisabled,
  emailDrafts,
  openEmailDraftId,
  onOpenEmailDraft,
  toolApproval,
  toolEntities,
}: {
  threadId: string;
  message: OperatorAgentMessage;
  viewerUserId: string | null;
  working: boolean;
  /** True while the turn runs, including pauses for approval. */
  turnActive: boolean;
  showSender: boolean;
  onFollowUp: (message: string) => Promise<void>;
  presentationDisabled: boolean;
  emailDrafts: OperatorEmailDraftView[];
  openEmailDraftId: string | null;
  onOpenEmailDraft: (draftId: string) => void;
  toolApproval?: ComponentProps<typeof ChatAssistantTurn>["toolApproval"];
  toolEntities?: ComponentProps<typeof ChatAssistantTurn>["toolEntities"];
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
    <ChatAttachmentList
      className="mt-2"
      size="compact"
      operatorThreadId={threadId}
      attachments={message.attachments}
    />
  ) : null;

  if (message.role === "assistant") {
    if (
      !working &&
      !toolApproval &&
      !content &&
      !attachments &&
      !message.presentation &&
      emailDrafts.length === 0
    )
      return null;
    return (
      <ChatAssistantTurn
        working={working}
        turnActive={turnActive}
        tools={message.usedTools}
        toolCalls={message.toolCalls}
        activity={message.activity}
        toolIntegrations={message.toolIntegrations}
        toolEntities={toolEntities}
        toolPreview={(toolCallId) => (
          <OperatorToolPreview messageId={message.id} toolCallId={toolCallId} />
        )}
        toolApproval={toolApproval}
        executionPlan={message.executionPlan}
        failure={message.failure}
        errorCode={message.errorCode}
        messageReference={message.id}
        routerRequestId={message.routerRequestId}
        audience="operator"
        content={content}
        channel={bubbleChannel}
        isError={message.status === "error"}
        presentation={message.status ? undefined : message.presentation}
        onFollowUp={onFollowUp}
        onOpenReference={(reference) => {
          if (reference.kind !== "email_draft") return false;
          onOpenEmailDraft(reference.recordId);
          return true;
        }}
        presentationDisabled={presentationDisabled}
        after={
          <OperatorEmailDraftCards
            drafts={emailDrafts}
            threadId={threadId}
            openDraftId={openEmailDraftId}
            onOpen={(draft) => onOpenEmailDraft(draft.id)}
          />
        }
      >
        {attachments}
      </ChatAssistantTurn>
    );
  }

  const emailBody = message.channel === "email" && Boolean(content);
  const senderName =
    message.sender?.name ?? (message.userName?.trim() || "Operator");
  return (
    <ChatUserTurn
      own={!message.sender || message.sender.userId === viewerUserId}
      showSender={showSender}
      name={senderName}
      avatar={
        <Avatar
          name={senderName}
          title={senderName}
          imageUrl={message.sender?.avatarUrl}
        />
      }
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
      body={
        emailBody ? (
          <OperatorEmailMessage message={message} attachments={attachments} />
        ) : !content ? null : message.channel === "slack" ? (
          <ProseMarkdown sourceFormat="slack-mrkdwn" gfm breaks>
            {content}
          </ProseMarkdown>
        ) : (
          <p className="whitespace-pre-wrap wrap-anywhere">
            <MessageContextTag context={message.pageContext} />
            {content}
          </p>
        )
      }
      attachments={emailBody ? null : attachments}
    />
  );
}

/** Drafts attached to a direct tool request or its response, each once. */
function directToolDrafts(
  draftsByMessage: ReturnType<typeof useOperatorEmailDrafts>,
  request: OperatorAgentMessage,
  response: OperatorAgentMessage | undefined,
) {
  const seen = new Set<string>();
  return [request, ...(response ? [response] : [])].flatMap((item) =>
    (draftsByMessage?.[item.id] ?? []).filter((draft) => {
      if (seen.has(draft.id)) return false;
      seen.add(draft.id);
      return true;
    }),
  );
}

export function OperatorConversation({
  activeThreadId,
  loading,
  detail,
  suggestions,
  launchingSuggestionKey,
  confirmationBusyId,
  onSelectSuggestion,
  onDecision,
  composer,
  onFollowUp,
  presentationDisabled,
}: {
  activeThreadId: string | null;
  loading: boolean;
  detail: OperatorAgentThreadDetail;
  suggestions: OperatorSuggestion[] | undefined;
  launchingSuggestionKey: string | null;
  confirmationBusyId: string | null;
  onSelectSuggestion: (suggestion: OperatorSuggestion) => void;
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
  const emailDraftsByMessage = useOperatorEmailDrafts(detail.messages);
  const [openEmailDraftId, setOpenEmailDraftId] = useFollowedState<
    string | null
  >(`operator-conversation:${threadId}:email-draft`, null);
  const hasAppShell = useOptionalAppShellSlots();
  const openEmailDraft = useMemo(
    () =>
      openEmailDraftId
        ? (Object.values(emailDraftsByMessage ?? {})
            .flat()
            .find((draft) => draft.id === openEmailDraftId) ?? null)
        : null,
    [emailDraftsByMessage, openEmailDraftId],
  );
  const hasMessages = detail.messages.length > 0;
  const senderKeys = new Set(
    detail.messages
      .filter((message) => message.role === "user")
      .map(
        (message) =>
          message.sender?.userId ?? (message.userName?.trim() || "Operator"),
      ),
  );
  // Name senders once anyone besides the viewer has written here.
  const multipleSenders =
    senderKeys.size > 1 ||
    [...senderKeys].some(
      (key) => detail.viewerUserId !== null && key !== detail.viewerUserId,
    );
  const hasPendingConfirmation = detail.confirmations.some(
    (confirmation) => confirmation.state === "pending",
  );
  const confirmationCard = (confirmation: OperatorAgentConfirmation) => (
    <ChatApprovalCard
      key={confirmation.id}
      status={operatorConfirmationStatus(confirmation)}
      title={confirmation.title}
      items={operatorBatchApprovalDetails(confirmation.title)?.items}
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
      {hasAppShell ? (
        <AppShellPortal slot="artifactPanel" active={openEmailDraft !== null}>
          {openEmailDraft ? (
            <OperatorEmailDraftPanel
              draft={openEmailDraft}
              threadId={threadId}
              onClose={() => setOpenEmailDraftId(null)}
            />
          ) : null}
        </AppShellPortal>
      ) : null}
      {loading ? (
        <div className="flex min-h-40 items-center justify-center">
          <Spinner className="text-muted-foreground" />
        </div>
      ) : !hasMessages ? (
        <EmptyThread
          suggestions={suggestions}
          launchingSuggestionKey={launchingSuggestionKey}
          onSelect={onSelectSuggestion}
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
          // A pending approval for a call shown in this turn's tool card is
          // decided on that call's row; ChatAssistantTurn falls back to the
          // card when the row is not visible.
          const rowConfirmation = message.isDirectToolRequest
            ? undefined
            : confirmations.find(
                (confirmation) =>
                  confirmation.state === "pending" &&
                  !isAutoApproved(confirmation) &&
                  hasAwaitingApprovalCall(
                    message.activity,
                    confirmation.toolName,
                  ),
              );
          const rowApproval = rowConfirmation
            ? {
                toolName: rowConfirmation.toolName,
                detail: (
                  <ApprovalDetail title={rowConfirmation.title} />
                ),
                actions:
                  rowConfirmation.actionable ? (
                    <ChatApprovalActions
                      destructive={rowConfirmation.destructive}
                      busy={confirmationBusyId === rowConfirmation.id}
                      onDecision={(decision) =>
                        onDecision(rowConfirmation, decision)
                      }
                    />
                  ) : null,
                fallback: confirmationCard(rowConfirmation),
              }
            : undefined;
          const renderConfirmation = (
            confirmation: OperatorAgentConfirmation,
          ) => (
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
                      <ChatAttachmentList
                        className="mt-2"
                        size="compact"
                        key={item.id}
                        operatorThreadId={threadId}
                        attachments={item.attachments}
                      />
                    ) : null,
                  )}
                  <OperatorEmailDraftCards
                    drafts={directToolDrafts(
                      emailDraftsByMessage,
                      message,
                      response,
                    )}
                    threadId={threadId}
                    openDraftId={openEmailDraftId}
                    onOpen={(draft) => setOpenEmailDraftId(draft.id)}
                  />
                </>
              ) : (
                <OperatorMessageRow
                  threadId={threadId}
                  message={message}
                  viewerUserId={detail.viewerUserId}
                  showSender={multipleSenders}
                  onFollowUp={onFollowUp}
                  emailDrafts={emailDraftsByMessage?.[message.id] ?? []}
                  openEmailDraftId={openEmailDraftId}
                  onOpenEmailDraft={setOpenEmailDraftId}
                  toolApproval={rowApproval}
                  toolEntities={detail.entities}
                  presentationDisabled={
                    presentationDisabled || hasPendingConfirmation
                  }
                  working={
                    message.status === "processing" && !hasPendingConfirmation
                  }
                  turnActive={message.status === "processing"}
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
                confirmations.filter(
                  (confirmation) =>
                    confirmation !== rowConfirmation &&
                    !(settledAnswer && isAutoApproved(confirmation)),
                ),
              ).map((group) =>
                isAutoApproved(group[0]) ? (
                  <ChatDisclosure
                    key={group[0].id}
                    summaryClassName="text-muted-foreground hover:text-foreground"
                    summary={
                      <span>
                        {group.length} {group.length === 1 ? "task" : "tasks"}{" "}
                        auto-approved
                      </span>
                    }
                  >
                    <div className="space-y-2">
                      {group.map(renderConfirmation)}
                    </div>
                  </ChatDisclosure>
                ) : (
                  <Fragment key={group[0].id}>
                    {renderConfirmation(group[0])}
                  </Fragment>
                ),
              )}
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
