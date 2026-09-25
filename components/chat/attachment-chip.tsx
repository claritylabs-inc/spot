"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { Loader2, Paperclip } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { usePdf } from "@/components/pdf-context";
import { operatorAgentApi } from "@/lib/operator-agent-api";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { cn } from "@/lib/utils";
import { typeStyle } from "@/lib/typography";

export type ChatAttachmentChipProps = {
  attachment: { filename: string; contentType?: string; fileId?: Id<"_storage"> };
  threadId?: Id<"threads">;
  /** Resolves through the operator agent API instead of the tenant thread. */
  operatorThreadId?: string;
  url?: string | null;
  className?: string;
  size?: "default" | "compact";
  onOpen?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  unavailableTitle?: string;
};

/**
 * File pill. Resolves the URL from the tenant thread or operator thread when
 * one is given, otherwise uses `url`; PDFs open in the in-app viewer.
 */
export function ChatAttachmentChip({
  attachment,
  threadId,
  operatorThreadId,
  url,
  className,
  size = "default",
  onOpen,
  isLoading = false,
  disabled = false,
  unavailableTitle,
}: ChatAttachmentChipProps) {
  const { openWithUrl } = usePdf();
  const storedUrl = useCachedQuery(
    "threads.getAttachmentUrl",
    api.threads.getAttachmentUrl,
    threadId && attachment.fileId ? { threadId, fileId: attachment.fileId } : "skip",
  );
  const operatorUrl = useQuery(
    operatorAgentApi.getAttachmentUrl,
    operatorThreadId && attachment.fileId
      ? { threadId: operatorThreadId, fileId: attachment.fileId }
      : "skip",
  );
  const resolvedUrl = url !== undefined ? url : operatorThreadId ? operatorUrl : storedUrl;
  const loading = isLoading || (Boolean(operatorThreadId) && operatorUrl === undefined);
  const isPdf =
    attachment.contentType?.toLowerCase().includes("pdf") ||
    attachment.filename.toLowerCase().endsWith(".pdf");
  const isCompact = size === "compact";
  const handleOpen = onOpen ?? (isPdf && resolvedUrl ? () => openWithUrl(resolvedUrl) : undefined);
  const canOpen = Boolean(handleOpen || resolvedUrl);
  const iconClass = cn("shrink-0 text-muted-foreground", isCompact ? "h-2.5 w-2.5" : "h-3 w-3");

  const shared = {
    title: canOpen
      ? attachment.filename
      : (unavailableTitle ?? `${attachment.filename} is not available yet`),
    style: { maxWidth: isCompact ? "11rem" : "13rem" },
    className: cn(
      `inline-flex min-w-0 items-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-50 ${typeStyle("body.medium")}`,
      isCompact
        ? `h-5 gap-1 px-1.5 ${typeStyle("caption.default")}`
        : `h-6 gap-1.5 px-2 ${typeStyle("caption.default")}`,
      canOpen
        ? "cursor-pointer bg-foreground/5 text-foreground/65 hover:bg-foreground/8 hover:text-foreground/80"
        : "pointer-events-none bg-foreground/3 text-muted-foreground/40",
      className,
    ),
    children: (
      <>
        {loading ? (
          <Loader2 className={cn(iconClass, "animate-spin")} />
        ) : (
          <Paperclip className={iconClass} />
        )}
        <span className="min-w-0 flex-1 truncate">{attachment.filename}</span>
      </>
    ),
  };

  if (handleOpen) {
    return (
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled || loading}
        aria-label={`${onOpen ? "Preview" : "Open"} ${attachment.filename}`}
        aria-busy={loading || undefined}
        {...shared}
      />
    );
  }

  return (
    <a
      href={isPdf ? undefined : (resolvedUrl ?? undefined)}
      target={isPdf ? undefined : "_blank"}
      rel={isPdf ? undefined : "noopener noreferrer"}
      aria-label={resolvedUrl ? `Open ${attachment.filename}` : attachment.filename}
      {...shared}
    />
  );
}

/** Shared file row; email headers may initially show only the first two files. */
export function ChatAttachmentList({
  attachments,
  collapseAfter = Infinity,
  className,
  ...chipProps
}: Pick<ChatAttachmentChipProps, "threadId" | "operatorThreadId" | "size"> & {
  attachments: ChatAttachmentChipProps["attachment"][];
  collapseAfter?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hidden = attachments.length - collapseAfter;
  return (
    <div className={cn("flex min-w-0 flex-wrap gap-1.5", className)}>
      {(expanded ? attachments : attachments.slice(0, collapseAfter)).map((attachment, index) => (
        <ChatAttachmentChip
          key={`${attachment.fileId ?? attachment.filename}-${index}`}
          attachment={attachment}
          {...chipProps}
        />
      ))}
      {hidden > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className={`inline-flex h-5 shrink-0 items-center rounded-full bg-foreground/5 px-1.5 text-foreground/40 transition-colors hover:bg-foreground/8 hover:text-foreground/80 ${typeStyle("control.button")}`}
        >
          {expanded ? "Hide" : `+ ${hidden} more`}
        </button>
      ) : null}
    </div>
  );
}
