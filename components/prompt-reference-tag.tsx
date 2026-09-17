"use client";

import { TagRemoveButton } from "@/components/ui/tag-remove-button";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { typeStyle } from "@/lib/typography";

export type PromptReferenceTagKind =
  | "policy"
  | "requirement"
  | "mailbox";

export type PromptReference = {
  kind: PromptReferenceTagKind;
  id: string;
  label: string;
};

type PromptReferenceTextPart =
  | { type: "text"; text: string }
  | { type: "reference"; reference: PromptReference };

export function promptReferenceMarker(kind: PromptReferenceTagKind) {
  return kind === "mailbox" ? "/" : "@";
}

function referenceMentionCandidates(reference: PromptReference) {
  const marker = promptReferenceMarker(reference.kind);
  const labels = new Set([reference.label]);
  labels.add(reference.label.replace(/\s+#/g, " "));
  return Array.from(labels).map((label) => `${marker}${label}`);
}

function promptReferenceTextParts(
  content: string,
  references: PromptReference[],
): PromptReferenceTextPart[] {
  if (!content || references.length === 0) {
    return [{ type: "text", text: content }];
  }

  const lowerContent = content.toLowerCase();
  const matches: Array<{
    start: number;
    end: number;
    reference: PromptReference;
  }> = [];

  references.forEach((reference) => {
    referenceMentionCandidates(reference).forEach((candidate) => {
      const lowerCandidate = candidate.toLowerCase();
      if (!lowerCandidate) return;

      let searchFrom = 0;
      while (searchFrom < lowerContent.length) {
        const start = lowerContent.indexOf(lowerCandidate, searchFrom);
        if (start === -1) break;
        matches.push({
          start,
          end: start + candidate.length,
          reference,
        });
        searchFrom = start + candidate.length;
      }
    });
  });

  if (matches.length === 0) return [{ type: "text", text: content }];

  matches.sort((first, second) => {
    if (first.start !== second.start) return first.start - second.start;
    return second.end - first.end;
  });

  const parts: PromptReferenceTextPart[] = [];
  let cursor = 0;
  matches.forEach((match) => {
    if (match.start < cursor) return;
    if (match.start > cursor) {
      parts.push({ type: "text", text: content.slice(cursor, match.start) });
    }
    parts.push({ type: "reference", reference: match.reference });
    cursor = match.end;
  });
  if (cursor < content.length) {
    parts.push({ type: "text", text: content.slice(cursor) });
  }
  return parts;
}

export function PromptReferenceTag({
  kind,
  label,
  onRemove,
  className,
}: {
  kind: PromptReferenceTagKind;
  label: string;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        `inline-flex h-5 max-w-[min(16rem,100%)] shrink-0 items-center gap-1 align-middle rounded-4xl bg-foreground/5 px-2 text-foreground/70 ${typeStyle("label.tag")}`,
        className,
      )}
    >
      <span className="text-muted-foreground/45">
        {promptReferenceMarker(kind)}
      </span>
      <span className="min-w-0 truncate" title={label}>
        {label}
      </span>
      {onRemove ? (
        <TagRemoveButton label={`Remove ${label}`} onClick={onRemove} />
      ) : null}
    </span>
  );
}

export function PromptReferenceText({
  content,
  references,
  className,
  tagClassName,
}: {
  content: string;
  references: PromptReference[];
  className?: string;
  tagClassName?: string;
}) {
  const parts = useMemo(
    () => promptReferenceTextParts(content, references),
    [content, references],
  );

  return (
    <span
      className={cn(
        "whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
        className,
      )}
    >
      {parts.map((part, index) =>
        part.type === "text" ? (
          <span key={index}>{part.text}</span>
        ) : (
          <PromptReferenceTag
            key={`${part.reference.kind}:${part.reference.id}:${index}`}
            kind={part.reference.kind}
            label={part.reference.label}
            className={cn("bg-background/60", tagClassName)}
          />
        ),
      )}
    </span>
  );
}
