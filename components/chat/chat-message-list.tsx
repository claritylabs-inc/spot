"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStickToBottom } from "use-stick-to-bottom";
import { ChatInputOverlay } from "@/components/spot-prompt-input";
import { cn } from "@/lib/utils";

/**
 * Scrollable transcript with the composer overlaid at the bottom. It sticks
 * to the latest message while the viewer stays at the bottom and jumps there
 * whenever `anchorKey` changes (e.g. thread switch or a new turn).
 */
export function ChatMessageList({
  anchorKey,
  composer,
  className,
  children,
}: {
  anchorKey: string | null;
  composer: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const { contentRef, scrollRef, scrollToBottom } = useStickToBottom({
    initial: "instant",
    resize: "instant",
  });

  // The last message clears exactly the composer's measured height, so the
  // transcript never keeps a fixed block of empty space below it.
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState<number | null>(null);
  useEffect(() => {
    const composerElement = composerRef.current;
    if (!composerElement) return;
    const observer = new ResizeObserver(() =>
      setComposerHeight(composerElement.offsetHeight),
    );
    observer.observe(composerElement);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (anchorKey === null) return;
    const frame = window.requestAnimationFrame(
      () => void scrollToBottom("instant"),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [anchorKey, scrollToBottom]);

  return (
    <div data-agent-surface="" className={cn("relative", className)}>
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-auto scrollbar-hide px-4 py-4 md:px-6"
      >
        <div ref={contentRef} className="flex min-h-full w-full flex-col justify-end gap-4">
          {children}
          <div
            aria-hidden="true"
            className={composerHeight === null ? "h-24 shrink-0" : "shrink-0"}
            style={composerHeight === null ? undefined : { height: composerHeight }}
          />
        </div>
      </div>
      <ChatInputOverlay composerRef={composerRef}>{composer}</ChatInputOverlay>
    </div>
  );
}
