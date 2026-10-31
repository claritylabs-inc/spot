"use client";

import { Avatar } from "@claritylabs-inc/ui/components/avatar";
import { useState, type ComponentProps, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { ChatPresentationView } from "@/components/chat-presentation/chat-presentation-view";
import { QuotedContent } from "@/components/conversation-message";
import { useFollowedState } from "@/hooks/use-followed-state";
import { useChatDisplayPreferences } from "@/components/profile/streaming-preference";
import {
  ProseMarkdown,
  type ProseMarkdownProps,
} from "@/components/prose-markdown";
import { LogoIcon } from "@/components/ui/logo-icon";
import { PillButton, type PillButtonSize } from "@/components/ui/pill-button";
import { formatDisplayDateTime } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { ChatMessageBubble, type ChatChannel } from "./message-bubble";
import type { OperatorExecutionPlan } from "@/convex/lib/operatorRunPlan";
import { ChatErrorDetails } from "./error-details";
import type { RouterJobFailure } from "@/convex/lib/routerJobFailure";
import {
  hasAwaitingApprovalCall,
  ThinkingTrace,
  ToolActivityCard,
  type ChatActivity,
  type ToolApproval,
} from "./thinking-summary";

export { ChatErrorNotice } from "./message-bubble";

// Playful verbs for the working indicator; one is picked per turn so it
// never flickers between states.
const WORKING_VERBS = [
  "Working",
  "Thinking",
  "Pondering",
  "Digging in",
  "Cross-checking",
  "Connecting the dots",
  "Reading the fine print",
  "Crunching",
  "Mulling it over",
  "Getting it right",
];

function AgentThinkingBubble() {
  const [verb] = useState(
    () => WORKING_VERBS[Math.floor(Math.random() * WORKING_VERBS.length)],
  );
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex min-h-9 items-center gap-2 text-muted-foreground",
        typeStyle("caption.default"),
      )}
    >
      <LogoIcon
        size={14}
        className="shrink-0 animate-spin [animation-duration:2.5s] motion-reduce:animate-none"
      />
      <span className="text-shimmer">{verb}…</span>
    </div>
  );
}

/**
 * Assistant turn: optional tool-activity summary, then the Markdown answer
 * with any generated presentation. While `working`, the viewer's Stream
 * responses preference decides whether streamed text or the status indicator
 * shows, and Show thinking (visible unless explicitly off) adds the observed
 * tool status and activity summary. `body` replaces the answer bubble entirely.
 */
export function ChatAssistantTurn({
  working,
  turnActive = working,
  tools,
  toolCalls,
  activity,
  toolIntegrations,
  toolEntities,
  toolPreview,
  toolApproval,
  executionPlan,
  failure,
  routerRequestId,
  errorCode,
  messageReference,
  aside,
  afterActivity,
  after,
  body,
  belowAnswer,
  content,
  channel,
  isError,
  markdownClassName,
  markdownComponents,
  presentation,
  audience,
  organizationId,
  structuredReferences,
  onFollowUp,
  onOpenReference,
  presentationDisabled,
  children,
}: Omit<ComponentProps<typeof ChatPresentationView>, "answer" | "disabled"> & {
  working: boolean;
  /**
   * Whether the turn is still running, for the activity summary. Differs from
   * `working` when the thinking indicator pauses, e.g. awaiting approval.
   */
  turnActive?: boolean;
  tools?: string[];
  toolCalls?: { name: string; input?: string }[];
  /** Observed stages and tool status; retained as evidence once settled. */
  activity?: ChatActivity;
  toolIntegrations?: ComponentProps<typeof ToolActivityCard>["integrations"];
  toolEntities?: ComponentProps<typeof ToolActivityCard>["entities"];
  toolPreview?: ComponentProps<typeof ToolActivityCard>["renderPreview"];
  /**
   * Approval for a call in this turn. Decided on the call's row when the
   * tool card shows it; otherwise `fallback` renders after the answer.
   */
  toolApproval?: ToolApproval & { fallback: ReactNode };
  executionPlan?: OperatorExecutionPlan;
  /** Operator-only diagnostics for a failed turn; ignored for other audiences. */
  failure?: RouterJobFailure;
  routerRequestId?: string;
  errorCode?: string;
  messageReference?: string;
  /** Rendered beside the answer or thinking indicator, e.g. a stop control. */
  aside?: ReactNode;
  /** Rendered between the activity and the answer, e.g. guidance the run took. */
  afterActivity?: ReactNode;
  /** Rendered below the answer regardless of pending state. */
  after?: ReactNode;
  body?: ReactNode;
  belowAnswer?: ReactNode;
  content: string;
  channel?: ChatChannel;
  isError?: boolean;
  markdownClassName?: string;
  markdownComponents?: ProseMarkdownProps["components"];
  presentationDisabled?: boolean;
  children?: ReactNode;
}) {
  const { streamResponses, showThinking } = useChatDisplayPreferences();
  const inlineApproval =
    toolApproval &&
    showThinking &&
    hasAwaitingApprovalCall(activity, toolApproval.toolName)
      ? toolApproval
      : undefined;
  // The indicator stays up for the whole turn, below any streamed text.
  const showsAnswer = !working || (streamResponses && Boolean(content));
  const answer = (
    <div className="min-w-0">
      {showsAnswer ? (
        <div className="min-w-0 max-w-[min(max(32rem,80cqw),100%)]">
          {body ?? (
            <ChatMessageBubble role="agent" channel={channel} isError={isError}>
              <ChatPresentationView
                audience={audience}
                organizationId={organizationId}
                presentation={isError ? undefined : presentation}
                onFollowUp={onFollowUp}
                onOpenReference={onOpenReference}
                structuredReferences={structuredReferences}
                disabled={presentationDisabled}
                answer={
                  content ? (
                    <ProseMarkdown
                      gfm
                      breaks
                      compact={channel === "imessage"}
                      className={markdownClassName}
                      components={markdownComponents}
                    >
                      {content}
                    </ProseMarkdown>
                  ) : null
                }
              />
              {children}
            </ChatMessageBubble>
          )}
          {belowAnswer}
        </div>
      ) : null}
      {working ? <AgentThinkingBubble /> : null}
    </div>
  );
  return (
    <div className="w-full">
      {showThinking ? (
        <>
          <ThinkingTrace
            activity={activity}
            executionPlan={audience === "operator" ? executionPlan : undefined}
            working={turnActive}
          />
          <ToolActivityCard
            tools={tools}
            toolCalls={toolCalls}
            activity={activity}
            integrations={toolIntegrations}
            entities={toolEntities}
            renderPreview={toolPreview}
            approval={inlineApproval}
            working={turnActive}
          />
        </>
      ) : null}
      {afterActivity}
      {aside ? (
        <div className="flex items-start gap-2">
          {answer}
          {aside}
        </div>
      ) : (
        answer
      )}
      {isError && audience === "operator" ? (
        <ChatErrorDetails
          failure={failure}
          requestReference={routerRequestId}
          errorCode={errorCode}
          messageReference={messageReference}
          activity={activity}
        />
      ) : null}
      {toolApproval && !inlineApproval ? toolApproval.fallback : null}
      {after}
    </div>
  );
}

function QuotedToggle({ id, text }: { id: string; text: string }) {
  const [showQuoted, setShowQuoted] = useFollowedState(
    `chat:${id}:quoted`,
    false,
  );
  return (
    <>
      <button
        type="button"
        onClick={() => setShowQuoted(!showQuoted)}
        className={cn(
          "mt-1.5 text-muted-foreground/40 transition-colors hover:text-muted-foreground/60",
          typeStyle("control.buttonCompact"),
        )}
      >
        {showQuoted ? "Hide quoted text ▴" : "Show quoted text ▾"}
      </button>
      {showQuoted ? <QuotedContent text={text} /> : null}
    </>
  );
}

/** A person's turn: avatar, sender line, then the bubble or a custom body. */
export function ChatUserTurn({
  own,
  name,
  nameTitle,
  avatar,
  meta,
  channelIcon,
  createdAt,
  channel,
  isError,
  body,
  attachments,
  quoted,
  customBody = false,
  showSender = true,
  after,
}: {
  own: boolean;
  name: string;
  nameTitle?: string;
  avatar?: ReactNode;
  /** Extra sender details between the name and the channel icon. */
  meta?: ReactNode;
  channelIcon?: ReactNode;
  createdAt: number;
  channel?: ChatChannel;
  isError?: boolean;
  body: ReactNode;
  attachments?: ReactNode;
  quoted?: { id: string; text: string } | null;
  customBody?: boolean;
  /** Avatar, name and time; threads with a single sender leave them out. */
  showSender?: boolean;
  after?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "w-fit max-w-[min(max(32rem,66.667cqw),100%)]",
        own && "ml-auto",
      )}
    >
      <div className="min-w-0">
        {showSender ? (
          <div
            className={cn(
              "mb-1 flex min-w-0 items-center gap-2",
              own && "justify-end",
            )}
          >
            {/* You know who you are: your own turns show only channel and time. */}
            {own ? null : (
              <>
                <span className="flex shrink-0 [&>*]:size-5">
                  {avatar ?? <Avatar name={name} />}
                </span>
                <p
                  className={cn(
                    "min-w-0 max-w-[min(24rem,70cqw)] truncate text-muted-foreground/50",
                    typeStyle("caption.medium"),
                  )}
                  title={nameTitle ?? name}
                >
                  {name}
                </p>
              </>
            )}
            {meta}
            {channelIcon}
            {own ? null : <span className="text-muted-foreground/30">·</span>}
            <span
              className={cn(
                "shrink-0 text-muted-foreground/45",
                typeStyle("caption.default"),
              )}
            >
              {formatDisplayDateTime(createdAt)}
            </span>
          </div>
        ) : null}
        {customBody ? (
          body
        ) : (
          <ChatMessageBubble
            role="user"
            channel={channel}
            isOwnMessage={own}
            isError={isError}
          >
            {body}
            {quoted ? <QuotedToggle id={quoted.id} text={quoted.text} /> : null}
            {attachments}
          </ChatMessageBubble>
        )}
        {after}
      </div>
    </div>
  );
}

export function ChatCopyButton({
  content,
  size = "compact",
  className,
  iconClassName = "size-3.5",
}: {
  content: string;
  size?: PillButtonSize;
  className?: string;
  iconClassName?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!content.trim()) return null;
  return (
    <PillButton
      type="button"
      variant="icon"
      size={size}
      label={copied ? "Copied" : "Copy response"}
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(content);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Could not copy response");
        }
      }}
    >
      {copied ? (
        <Check className={cn(iconClassName, "text-emerald-500")} />
      ) : (
        <Copy className={iconClassName} />
      )}
    </PillButton>
  );
}
