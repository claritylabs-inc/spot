"use client";

import { memo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { typeStyle } from "@/lib/typography";

export type ChatChannel = "chat" | "email" | "imessage" | "slack";

export const ChatMessageBubble = memo(function ChatMessageBubble({
  role,
  channel,
  isOwnMessage,
  isError,
  children,
}: {
  role: "agent" | "user";
  channel?: ChatChannel;
  isOwnMessage?: boolean;
  isError?: boolean;
  children: ReactNode;
}) {
  if (role === "agent") {
    if (!isError) {
      return (
        <div
          className={cn(
            "text-foreground",
            channel === "imessage"
              ? typeStyle("body.large")
              : typeStyle("body.default"),
          )}
        >
          {children}
        </div>
      );
    }

    return (
      <div
        className={cn(
          "rounded-lg border border-destructive/20 bg-destructive/5 text-destructive",
          channel === "imessage" ? "px-3 py-2" : "px-3.5 py-2.5",
        )}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg px-3.5 py-2.5 text-foreground",
        channel === "imessage"
          ? typeStyle("body.large")
          : typeStyle("body.default"),
        channel === "email"
          ? [
              "border border-border",
              isOwnMessage ? "bg-foreground/[0.04]" : "bg-foreground/[0.02]",
            ]
          : isOwnMessage
            ? "bg-foreground/[0.06]"
            : "bg-foreground/[0.03]",
      )}
    >
      {children}
    </div>
  );
});
