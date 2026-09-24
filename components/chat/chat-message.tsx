"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import type { PresentationFollowUp } from "@/components/chat-presentation/context";
import { ChatPresentationView } from "@/components/chat-presentation/chat-presentation-view";
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
import { ThinkingSummary } from "./thinking-summary";

function AgentThinkingBubble() {
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
      <span>Thinking…</span>
    </div>
  );
}

/**
 * Assistant turn shell. Applies the viewer's Stream responses and Show
 * thinking preferences: while `working`, the answer is replaced by the
 * thinking indicator until streamed text arrives (or always, when streaming
 * is off).
 */
export function ChatAssistantMessage({
  working,
  hasText,
  tools,
  toolCalls,
  aside,
  after,
  children,
}: {
  working: boolean;
  hasText: boolean;
  tools?: string[];
  toolCalls?: { name: string; input?: string }[];
  /** Rendered beside the answer or thinking indicator, e.g. a stop control. */
  aside?: ReactNode;
  /** Rendered below the answer regardless of pending state. */
  after?: ReactNode;
  children: ReactNode;
}) {
  const { streamResponses, showThinking } = useChatDisplayPreferences();
  const body =
    working && (!streamResponses || !hasText) ? (
      <AgentThinkingBubble />
    ) : (
      children
    );
  return (
    <div className="w-full">
      {showThinking ? (
        <ThinkingSummary tools={tools} toolCalls={toolCalls} working={working} />
      ) : null}
      {aside ? (
        <div className="flex items-start gap-2">
          {body}
          {aside}
        </div>
      ) : (
        body
      )}
      {after}
    </div>
  );
}

/** Assistant answer bubble: Markdown text plus any generated presentation. */
export function ChatAnswer({
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
  presentationDisabled,
  children,
}: {
  content: string;
  channel?: ChatChannel;
  isError?: boolean;
  markdownClassName?: string;
  markdownComponents?: ProseMarkdownProps["components"];
  presentation?: unknown;
  audience?: "operator" | "client";
  organizationId?: string;
  structuredReferences?: boolean;
  onFollowUp?: PresentationFollowUp;
  presentationDisabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <ChatMessageBubble role="agent" channel={channel} isError={isError}>
      <ChatPresentationView
        audience={audience}
        organizationId={organizationId}
        presentation={isError ? undefined : presentation}
        onFollowUp={onFollowUp}
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
  );
}

export function chatInitials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export function ChatAvatar({
  name,
  title,
  className,
  children,
}: {
  name: string;
  title?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground/8",
        className,
      )}
      title={title}
    >
      {children ?? (
        <span className={cn("text-foreground/60", typeStyle("caption.medium"))}>
          {chatInitials(name)}
        </span>
      )}
    </div>
  );
}

/** A person's turn: avatar, sender line, then the adapter's message body. */
export function ChatUserMessage({
  own,
  name,
  nameTitle,
  avatar,
  meta,
  channelIcon,
  createdAt,
  children,
}: {
  own: boolean;
  name: string;
  nameTitle?: string;
  avatar?: ReactNode;
  /** Extra sender details between the name and the channel icon. */
  meta?: ReactNode;
  channelIcon?: ReactNode;
  createdAt: number;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex w-fit max-w-[min(32rem,100%)] items-start gap-2.5",
        own && "ml-auto flex-row-reverse",
      )}
    >
      {avatar ?? <ChatAvatar name={name} />}
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "mb-1 flex min-w-0 items-center gap-2",
            own && "justify-end",
          )}
        >
          <p
            className={cn(
              "min-w-0 max-w-[min(24rem,70vw)] truncate text-muted-foreground/50",
              typeStyle("caption.medium"),
            )}
            title={nameTitle ?? name}
          >
            {name}
          </p>
          {meta}
          {channelIcon}
          <span className="text-muted-foreground/30">·</span>
          <span
            className={cn(
              "shrink-0 text-muted-foreground/45",
              typeStyle("caption.default"),
            )}
          >
            {formatDisplayDateTime(createdAt)}
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ChatErrorNotice({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-destructive/20 bg-destructive/5 text-destructive",
        className,
      )}
    >
      {children}
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
