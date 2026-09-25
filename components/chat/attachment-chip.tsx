"use client";

import { Loader2, Paperclip } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { usePdf } from "@/components/pdf-context";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { cn } from "@/lib/utils";
import { typeStyle } from "@/lib/typography";

export type ChatAttachmentChipProps = {
  attachment: { filename: string; contentType?: string; fileId?: Id<"_storage"> };
  threadId?: Id<"threads">;
  url?: string | null;
  className?: string;
  size?: "default" | "compact";
  onOpen?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  unavailableTitle?: string;
};

export function ChatAttachmentChip({
  attachment,
  threadId,
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
    threadId && attachment.fileId
      ? { threadId, fileId: attachment.fileId }
      : "skip",
  );
  const resolvedUrl = url === undefined ? storedUrl : url;
  const isPdf =
    attachment.contentType?.toLowerCase().includes("pdf") ||
    attachment.filename.toLowerCase().endsWith(".pdf");
  const isCompact = size === "compact";
  const handleOpen =
    onOpen ?? (isPdf && resolvedUrl ? () => openWithUrl(resolvedUrl) : undefined);
  const canOpen = Boolean(handleOpen || resolvedUrl);

  const title = canOpen
    ? attachment.filename
    : (unavailableTitle ?? `${attachment.filename} is not available yet`);
  const classNames = cn(
    `inline-flex min-w-0 items-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-50 ${typeStyle("body.medium")}`,
    isCompact
      ? `h-5 gap-1 px-1.5 ${typeStyle("caption.default")}`
      : `h-6 gap-1.5 px-2 ${typeStyle("caption.default")}`,
    canOpen
      ? "cursor-pointer bg-foreground/5 text-foreground/65 hover:bg-foreground/8 hover:text-foreground/80"
      : "pointer-events-none bg-foreground/3 text-muted-foreground/40",
    className,
  );
  const content = (
    <>
      {isLoading ? (
        <Loader2
          className={cn(
            "shrink-0 animate-spin text-muted-foreground",
            isCompact ? "h-2.5 w-2.5" : "h-3 w-3",
          )}
        />
      ) : (
        <Paperclip
          className={cn(
            "shrink-0 text-muted-foreground",
            isCompact ? "h-2.5 w-2.5" : "h-3 w-3",
          )}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{attachment.filename}</span>
    </>
  );

  if (handleOpen) {
    return (
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled || isLoading}
        title={title}
        aria-label={`${onOpen ? "Preview" : "Open"} ${attachment.filename}`}
        aria-busy={isLoading || undefined}
        style={{ maxWidth: isCompact ? "11rem" : "13rem" }}
        className={classNames}
      >
        {content}
      </button>
    );
  }

  return (
    <a
      href={isPdf ? undefined : (resolvedUrl ?? undefined)}
      target={isPdf ? undefined : "_blank"}
      rel={isPdf ? undefined : "noopener noreferrer"}
      title={title}
      aria-label={resolvedUrl ? `Open ${attachment.filename}` : attachment.filename}
      style={{ maxWidth: isCompact ? "11rem" : "13rem" }}
      className={classNames}
    >
      {content}
    </a>
  );
}
