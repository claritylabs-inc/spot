"use client";

import { useEffect, type ReactNode } from "react";
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
  clearanceClassName,
  className,
  children,
}: {
  anchorKey: string | null;
  composer: ReactNode;
  /** Bottom spacer height so the last message clears the composer. */
  clearanceClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  const { contentRef, scrollRef, scrollToBottom } = useStickToBottom({
    initial: "instant",
    resize: "instant",
  });

  useEffect(() => {
    if (anchorKey === null) return;
    const frame = window.requestAnimationFrame(
      () => void scrollToBottom("instant"),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [anchorKey, scrollToBottom]);

  return (
    <div className={cn("relative", className)}>
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-auto scrollbar-hide px-4 py-4 md:px-6"
      >
        <div ref={contentRef} className="flex min-h-full w-full flex-col justify-end gap-4">
          {children}
          {clearanceClassName ? <div className={clearanceClassName} /> : null}
        </div>
      </div>
      <ChatInputOverlay>{composer}</ChatInputOverlay>
    </div>
  );
}
