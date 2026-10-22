"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * Chat artifacts open beside the agent conversation, in the dock's artifact
 * card (`AppShellPortal slot="artifactPanel"`). The card owns the frame; an
 * artifact supplies a title bar, optional fixed meta, a scrolling body and an
 * optional action bar.
 */
export function ChatArtifact({
  title,
  eyebrow,
  status,
  closeLabel,
  onClose,
  meta,
  footer,
  bodyClassName,
  children,
}: {
  title: ReactNode;
  /** Small label above the title, e.g. the artifact kind or client. */
  eyebrow?: ReactNode;
  status?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  /** Fixed content between the title bar and the scrolling body. */
  meta?: ReactNode;
  footer?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <article className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 items-start justify-between gap-3 px-4 pt-3.5 pb-3">
        <div className="min-w-0 space-y-0.5">
          {eyebrow ? (
            <p
              className={cn(
                "truncate text-muted-foreground/60",
                typeStyle("caption.default"),
              )}
            >
              {eyebrow}
            </p>
          ) : null}
          <div className="flex min-w-0 items-center gap-2">
            <h2
              className={cn(
                "min-w-0 truncate text-foreground",
                typeStyle("heading.micro"),
              )}
            >
              {title}
            </h2>
            {status}
          </div>
        </div>
        <PillButton
          size="compact"
          variant="icon"
          onClick={onClose}
          label={closeLabel}
          className="-mr-1.5 shrink-0"
        >
          <X className="h-4 w-4" />
        </PillButton>
      </header>
      {meta ? (
        <div className="shrink-0 border-y border-border/70 px-4 py-3">
          {meta}
        </div>
      ) : (
        <div className="shrink-0 border-t border-border/70" />
      )}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-4 py-4",
          bodyClassName,
        )}
      >
        {children}
      </div>
      {footer ? (
        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border/70 px-4 py-3">
          {footer}
        </footer>
      ) : null}
    </article>
  );
}

/** Label/value rows for artifact headers such as email From/To or record facts. */
export function ChatArtifactMeta({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[minmax(4.5rem,max-content)_minmax(0,1fr)] gap-x-4 gap-y-1.5">
      {children}
    </dl>
  );
}

export function ChatArtifactMetaRow({
  label,
  value,
}: {
  label: ReactNode;
  value: ReactNode | null | undefined;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <>
      <dt
        className={cn(
          "text-muted-foreground/60",
          typeStyle("caption.default"),
        )}
      >
        {label}
      </dt>
      <dd
        className={cn(
          "min-w-0 break-words text-foreground",
          typeStyle("body.default"),
        )}
      >
        {value}
      </dd>
    </>
  );
}

/** A titled group inside an artifact body. */
export function ChatArtifactSection({
  title,
  action,
  className,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("space-y-2 [&+&]:mt-5", className)}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h3
          className={cn(
            "min-w-0 truncate text-muted-foreground",
            typeStyle("caption.medium"),
          )}
        >
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}
