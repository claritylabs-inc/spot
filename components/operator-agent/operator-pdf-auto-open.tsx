"use client";

import { useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { usePdf } from "@/components/pdf-context";
import { useAppMinWidth } from "@/hooks/use-app-container-width";
import {
  operatorAgentApi,
  type OperatorAgentThreadDetail,
} from "@/lib/operator-agent-api";

type PdfAttachment = { key: string; fileId: string; filename: string };

function assistantPdfAttachments(
  messages: OperatorAgentThreadDetail["messages"],
): PdfAttachment[] {
  return messages.flatMap((message) =>
    message.role === "assistant"
      ? (message.attachments ?? []).flatMap((attachment) =>
          attachment.contentType?.toLowerCase().includes("pdf") ||
          attachment.filename.toLowerCase().endsWith(".pdf")
            ? [
                {
                  key: `${message.id}:${attachment.fileId}`,
                  fileId: String(attachment.fileId),
                  filename: attachment.filename,
                },
              ]
            : [],
        )
      : [],
  );
}

/** Opens PDFs the agent produces during this session (e.g. a filled form) in the PDF panel. */
export function useAutoOpenOperatorPdfs(
  threadId: string,
  messages: OperatorAgentThreadDetail["messages"],
) {
  const { openWithUrl } = usePdf();
  const isDesktop = useAppMinWidth(1024);
  const seenThreadId = useRef<string | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const opened = useRef<string | null>(null);
  const [pending, setPending] = useState<PdfAttachment | null>(null);
  const url = useQuery(
    operatorAgentApi.getAttachmentUrl,
    pending && threadId ? { threadId, fileId: pending.fileId as Id<"_storage"> } : "skip",
  );

  useEffect(() => {
    const attachments = assistantPdfAttachments(messages);
    // PDFs already in the thread when it is opened stay closed.
    if (seenThreadId.current !== threadId) {
      seenThreadId.current = threadId;
      seen.current = new Set(attachments.map((attachment) => attachment.key));
      setPending(null);
      return;
    }
    const unseen = attachments.filter(
      (attachment) => !seen.current.has(attachment.key),
    );
    for (const attachment of unseen) seen.current.add(attachment.key);
    if (isDesktop && unseen.length) setPending(unseen.at(-1) ?? null);
  }, [isDesktop, messages, threadId]);

  useEffect(() => {
    if (!pending || !url || opened.current === pending.key) return;
    opened.current = pending.key;
    openWithUrl(url, undefined, undefined, {
      kind: "operatorAttachment",
      fileId: pending.fileId,
      filename: pending.filename,
    });
  }, [openWithUrl, pending, url]);
}
