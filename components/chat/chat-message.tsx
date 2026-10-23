"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import { ChatPresentationView } from "@/components/chat-presentation/chat-presentation-view";
import { QuotedContent } from "@/components/conversation-message";
import { useChatDisplayPreferences } from "@/components/profile/streaming-preference";
import {
  ProseMarkdown,
  type ProseMarkdownProps,
} from "@/components/prose-markdown";
import { PillButton, type PillButtonSize } from "@/components/ui/pill-button";
import { formatDisplayDateTime } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { ChatMessageBubble, type ChatChannel } from "./message-bubble";
import { ChatDisclosure } from "./disclosure";
import type { OperatorExecutionPlan } from "@/convex/lib/operatorRunPlan";
import { ChatErrorDetails } from "./error-details";
import type { RouterJobFailure } from "@/convex/lib/routerJobFailure";
import {
  activityStatusLabel,
  hasActiveActivity,
  ThinkingSummary,
  type ChatActivity,
} from "./thinking-summary";

export { ChatErrorNotice } from "./message-bubble";

function AgentThinkingBubble({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex min-h-9 items-center gap-2 text-muted-foreground/50",
        typeStyle("caption.default"),
      )}
    >
      <Spinner
        aria-hidden="true"
        role="presentation"
        aria-label={undefined}
        className="motion-reduce:animate-none"
      />
      <span>{label}</span>
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
  tools,
  toolCalls,
  activity,
  executionPlan,
  failure,
  routerRequestId,
  errorCode,
  messageReference,
  aside,
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
  tools?: string[];
  toolCalls?: { name: string; input?: string }[];
  /** Observed stages and tool status; retained as evidence once settled. */
  activity?: ChatActivity;
  executionPlan?: OperatorExecutionPlan;
  /** Operator-only diagnostics for a failed turn; ignored for other audiences. */
  failure?: RouterJobFailure;
  routerRequestId?: string;
  errorCode?: string;
  messageReference?: string;
  /** Rendered beside the answer or thinking indicator, e.g. a stop control. */
  aside?: ReactNode;
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
  // A visible activity row already shows what the turn is doing, so the
  // standalone indicator would repeat it. It stays for Show thinking off, no
  // activity, and waiting on the model with no row in progress.
  const rowShowsProgress = showThinking && hasActiveActivity(activity);
  const answer =
    working && (!streamResponses || !content) ? (
      rowShowsProgress ? (
        // The row shows the detail; announce only the current activity.
        <span role="status" aria-live="polite" className="sr-only">
          {activityStatusLabel(activity)}
        </span>
      ) : (
        <AgentThinkingBubble
          label={activityStatusLabel(showThinking ? activity : undefined)}
        />
      )
    ) : (
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
    );
  return (
    <div className="w-full">
      {audience === "operator" && executionPlan ? (
        <ChatDisclosure
          working={working}
          summary={<span>Plan · {executionPlan.steps.length} steps</span>}
          className={`max-w-3xl text-muted-foreground/50 ${typeStyle("caption.default")}`}
          summaryClassName="hover:text-muted-foreground"
        >
          <div
            className={`space-y-2.5 pt-2.5 pb-1 text-muted-foreground/70 ${typeStyle("body.default")}`}
          >
            <p className="text-foreground">{executionPlan.summary}</p>
            {executionPlan.targets.length ? (
              <p className="break-words">
                Targets: {executionPlan.targets.join(", ")}
              </p>
            ) : null}
            <ol className="list-outside list-decimal space-y-2.5 pl-7">
              {executionPlan.steps.map((step, index) => (
                <li key={index} className="break-words pl-1">
                  <p className="text-foreground">{step.title}</p>
                  <p>{step.detail}</p>
                  <p className="mt-1">Done when: {step.completionCriteria}</p>
                </li>
              ))}
            </ol>
          </div>
        </ChatDisclosure>
      ) : null}
      {showThinking ? (
        <ThinkingSummary
          tools={tools}
          toolCalls={toolCalls}
          activity={activity}
          working={working}
        />
      ) : null}
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
      {after}
    </div>
  );
}

export function ChatAvatar({
  name,
  title,
  imageUrl,
  className,
  children,
}: {
  name: string;
  title?: string;
  /** Profile photo; initials show while it is missing or fails to load. */
  imageUrl?: string | null;
  className?: string;
  children?: ReactNode;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  const showImage = !children && imageUrl && failedUrl !== imageUrl;
  return (
    <div
      className={cn(
        "@container flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-foreground/8",
        className,
      )}
      title={title}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote avatar hosts vary
        <img
          src={imageUrl}
          alt=""
          className="size-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(imageUrl)}
        />
      ) : (
        (children ?? (
          // Initials scale with the circle so every avatar size stays balanced.
          <span
            className={cn(
              "text-foreground/60 select-none",
              typeStyle("caption.medium"),
              // Trim to cap height so the letters sit optically centered.
              "text-[44cqw]! [text-box:trim-both_cap_alphabetic]",
            )}
          >
            {initials}
          </span>
        ))
      )}
    </div>
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
  quotedText,
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
  quotedText?: string | null;
  customBody?: boolean;
  /** Avatar, name and time; threads with a single sender leave them out. */
  showSender?: boolean;
  after?: ReactNode;
}) {
  const [showQuoted, setShowQuoted] = useState(false);
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
                  {avatar ?? <ChatAvatar name={name} />}
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
            {quotedText ? (
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
                {showQuoted ? <QuotedContent text={quotedText} /> : null}
              </>
            ) : null}
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
