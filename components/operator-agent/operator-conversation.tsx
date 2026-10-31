"use client";

import { Avatar } from "@claritylabs-inc/ui/components/avatar";
import { operatorBatchApprovalDetails } from "@/lib/operator-batch-approval";
import { Fragment, useMemo, type ComponentProps, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { Link2, RotateCcw, Workflow } from "lucide-react";
import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import {
  StatusTag,
  type StatusPresentation,
} from "@claritylabs-inc/ui/components/status-tag";
import {
  EmailStackFrame,
  EmailStackRow,
} from "@/components/agent-thread/artifacts/email";
import {
  ChatApprovalActions,
  ChatApprovalCard,
  ChatApprovalEmailCard,
  ChatApprovalReceipt,
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
  type OperatorAgentSubtask,
  type OperatorAgentThreadDetail,
} from "@/lib/operator-agent-api";
import type { OperatorSuggestion } from "@/convex/lib/operatorSuggestionTypes";
import { useFollowedState } from "@/hooks/use-followed-state";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import type { OperatorEmailDraftView } from "@/lib/operator-email-draft";
import {
  OperatorEmailDraftCards,
  draftSendDetail,
  OperatorThreadReplyCards,
  threadReplyDrafts,
  OperatorEmailDraftPanel,
  useOperatorEmailDrafts,
} from "./operator-email-drafts";
import { OperatorEmailMessage } from "./operator-email-message";
import { OperatorToolPreview } from "./operator-tool-preview";
import { useAutoOpenOperatorPdfs } from "./operator-pdf-auto-open";
import { OperatorThreadChannelIcon } from "./operator-thread-channel";
import { OperatorSubtaskList } from "./operator-subtasks";
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

/** Consecutive decided confirmations share one stack of receipt lines. */
function groupOperatorConfirmations(
  confirmations: OperatorAgentConfirmation[],
) {
  const groups: OperatorAgentConfirmation[][] = [];
  for (const confirmation of confirmations) {
    const previous = groups.at(-1);
    if (
      confirmation.state !== "pending" &&
      previous &&
      previous[0].state !== "pending"
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
  threadUrl,
}: {
  message: OperatorAgentMessage;
  threadUrl: string;
  confirmations: OperatorAgentConfirmation[];
  activeRun: boolean;
  renderConfirmation: RenderConfirmation;
}) {
  const rerunTurn = useMutation(operatorAgentApi.rerunTurn);
  const rerunAction = useChatAction();
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
      {approved.length > 0 ? (
        <div>{approved.map(renderConfirmation)}</div>
      ) : null}
      <div className="-ml-2 flex items-center gap-1">
        <ChatCopyButton
          content={message.content}
          size="small"
          className={controlClass}
        />
        <ChatCopyButton
          content={threadUrl}
          size="small"
          className={controlClass}
          label="Copy thread link"
          icon={Link2}
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
function ApprovalDetail({
  title,
  drafts,
  onOpenDraft,
}: {
  title: string;
  /** The email drafts a send approval covers, shown instead of their full text. */
  drafts: OperatorEmailDraftView[];
  onOpenDraft: (draftId: string) => void;
}) {
  if (drafts.length)
    return (
      <ul className="space-y-1.5">
        {drafts.map((draft) => {
          const detail = draftSendDetail(draft);
          return (
            <li key={draft.id}>
              <p className="text-foreground/90">{draft.subject || "(no subject)"}</p>
              <p>
                To {draft.to.join(", ")}
                {detail ? ` · ${detail}` : ""}
              </p>
              <button
                type="button"
                onClick={() => onOpenDraft(draft.id)}
                className="text-foreground underline underline-offset-2"
              >
                Review email
              </button>
            </li>
          );
        })}
      </ul>
    );
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
  parent,
  onOpenThread,
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
  /** The conversation that started this one as a subtask. */
  parent: OperatorAgentThreadDetail["parent"];
  onOpenThread: (threadId: string) => void;
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
      emailDrafts.length === 0 &&
      threadReplyDrafts(message.toolCalls).length === 0
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
          <>
            <OperatorEmailDraftCards
              drafts={emailDrafts}
              threadId={threadId}
              openDraftId={openEmailDraftId}
              onOpen={(draft) => onOpenEmailDraft(draft.id)}
            />
            <OperatorThreadReplyCards
              drafts={threadReplyDrafts(message.toolCalls)}
            />
          </>
        }
      >
        {attachments}
      </ChatAssistantTurn>
    );
  }

  const emailBody = message.channel === "email" && Boolean(content);
  // A subtask's objective is Spot's instruction from the parent chat.
  if (message.fromParentTask)
    return (
      <ChatUserTurn
        own={false}
        showSender
        name="Spot"
        avatar={
          <span className="flex size-full items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Workflow aria-hidden className="size-3" />
          </span>
        }
        meta={
          parent ? (
            <button
              type="button"
              onClick={() => onOpenThread(parent.threadId)}
              className={cn(
                "min-w-0 truncate text-muted-foreground/50 hover:text-foreground",
                typeStyle("caption.medium"),
              )}
            >
              from {parent.title}
            </button>
          ) : null
        }
        createdAt={message.createdAt}
        channel={bubbleChannel}
        body={<p className="whitespace-pre-wrap wrap-anywhere">{content}</p>}
        attachments={attachments}
      />
    );
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
  onOpenThread,
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
  /** Opens another operator conversation in the dock, such as a subtask. */
  onOpenThread: (threadId: string) => void;
  presentationDisabled: boolean;
}) {
  const entries = useMemo(() => operatorConversationEntries(detail), [detail]);
  const subtasksByMessage = useMemo(() => {
    const byMessage = new Map<string, OperatorAgentSubtask[]>();
    // Started order under the reply that started them.
    for (const task of [...detail.subtasks].reverse()) {
      if (!task.messageId) continue;
      byMessage.set(task.messageId, [...(byMessage.get(task.messageId) ?? []), task]);
    }
    return byMessage;
  }, [detail.subtasks]);
  const threadId = activeThreadId ?? "";
  const threadUrl = activeThreadId
    ? `${window.location.origin}/operator/threads/${encodeURIComponent(activeThreadId)}`
    : "";
  useAutoOpenOperatorPdfs(threadId, detail.messages);
  const emailDraftsByMessage = useOperatorEmailDrafts(detail.messages);
  const [openEmailDraftId, setOpenEmailDraftId] = useFollowedState<
    string | null
  >(`operator-conversation:${threadId}:email-draft`, null);
  const draftsById = new Map(
    Object.values(emailDraftsByMessage ?? {})
      .flat()
      .map((draft) => [draft.id, draft]),
  );
  // A send approval shows its drafts, each opening editable in the composer.
  const approvalDrafts = (confirmation: OperatorAgentConfirmation) => {
    const drafts = (confirmation.emailDraftIds ?? []).map((id) => draftsById.get(id));
    return drafts.length && drafts.every((draft) => draft !== undefined)
      ? (drafts as OperatorEmailDraftView[])
      : [];
  };
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
  const confirmationCard = (confirmation: OperatorAgentConfirmation) => {
    const status = operatorConfirmationStatus(confirmation);
    const drafts = approvalDrafts(confirmation);
    const draft = drafts.length === 1 ? drafts[0] : undefined;
    if (confirmation.state !== "pending" && drafts.length > 1)
      return (
        <ChatApprovalReceipt
          key={confirmation.id}
          status={status}
          title={`Send ${drafts.length} emails`}
          items={drafts.map(
            (item) => `${item.subject || "(no subject)"} · ${item.to.join(", ")}`,
          )}
        />
      );
    if (confirmation.state !== "pending")
      return (
        <ChatApprovalReceipt
          key={confirmation.id}
          status={status}
          title={
            draft
              ? `Email ${draft.to.join(", ") || "recipients"}`
              : confirmation.title
          }
          context={draft?.subject}
          items={operatorBatchApprovalDetails(confirmation.title)?.items}
          onOpen={draft ? () => setOpenEmailDraftId(draft.id) : undefined}
          isOpen={draft ? openEmailDraftId === draft.id : false}
        />
      );
    if (draft)
      return (
        <ChatApprovalEmailCard
          key={confirmation.id}
          status={status}
          subject={draft.subject}
          recipients={draft.to.join(", ")}
          detail={draftSendDetail(draft)}
          actionable={confirmation.actionable}
          busy={confirmationBusyId === confirmation.id}
          isOpen={openEmailDraftId === draft.id}
          onOpen={() => setOpenEmailDraftId(draft.id)}
          onDecision={(decision) => onDecision(confirmation, decision)}
        />
      );
    if (drafts.length > 1)
      return (
        <EmailStackFrame
          key={confirmation.id}
          label={`${drafts.length} emails to send`}
          action={
            confirmation.actionable ? (
              <ChatApprovalActions
                busy={confirmationBusyId === confirmation.id}
                confirmLabel="Send all"
                onDecision={(decision) => onDecision(confirmation, decision)}
              />
            ) : (
              <StatusTag tone={status.tone} indicator={status.indicator}>
                {status.label}
              </StatusTag>
            )
          }
        >
          {drafts.map((item) => (
            <EmailStackRow
              key={item.id}
              subject={item.subject || "(no subject)"}
              recipients={[item.to.join(", "), draftSendDetail(item)]
                .filter(Boolean)
                .join(" · ")}
              attachmentCount={item.attachments.length}
              status={{ label: "Draft", tone: "warning", indicator: "draft" }}
              isOpen={openEmailDraftId === item.id}
              onOpen={() => setOpenEmailDraftId(item.id)}
            />
          ))}
        </EmailStackFrame>
      );
    return (
      <ChatApprovalCard
        key={confirmation.id}
        status={status}
        title={confirmation.title}
        items={operatorBatchApprovalDetails(confirmation.title)?.items}
        actionable={confirmation.actionable}
        destructive={confirmation.destructive}
        busy={confirmationBusyId === confirmation.id}
        onDecision={(decision) => onDecision(confirmation, decision)}
      />
    );
  };

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
                  <ApprovalDetail
                    title={rowConfirmation.title}
                    drafts={approvalDrafts(rowConfirmation)}
                    onOpenDraft={setOpenEmailDraftId}
                  />
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
                  emailDrafts={(emailDraftsByMessage?.[message.id] ?? []).filter(
                    // A draft whose send approval is in this turn shows as that approval.
                    (draft) =>
                      !confirmations.some((confirmation) =>
                        confirmation.emailDraftIds?.includes(draft.id),
                      ),
                  )}
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
                  parent={detail.parent}
                  onOpenThread={onOpenThread}
                />
              )}
              <OperatorSubtaskList
                subtasks={subtasksByMessage.get(message.id) ?? []}
                onOpen={onOpenThread}
              />
              {settledAnswer ? (
                <OperatorMessageFooter
                  message={message}
                  confirmations={confirmations}
                  activeRun={detail.activeRun}
                  renderConfirmation={confirmationCard}
                  threadUrl={threadUrl}
                />
              ) : null}
              {groupOperatorConfirmations(
                confirmations.filter(
                  (confirmation) =>
                    confirmation !== rowConfirmation &&
                    !(settledAnswer && isAutoApproved(confirmation)),
                ),
              ).map((group) =>
                group.length > 1 ? (
                  <div key={group[0].id}>{group.map(renderConfirmation)}</div>
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
