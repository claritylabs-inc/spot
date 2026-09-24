"use client";

import { forwardRef, type ReactNode } from "react";
import {
  SpotPromptInput,
  type SpotPromptInputHandle,
  type SpotPromptInputProps,
} from "@/components/spot-prompt-input";

export type ChatComposerHandle = SpotPromptInputHandle;

/**
 * Prompt input with attachments, submit and (when `onStop` is set) stop.
 * `busy` shows the submitted state with `busyLabel`; `banner` sits above the
 * input, e.g. a queued message.
 */
export const ChatComposer = forwardRef<
  ChatComposerHandle,
  Omit<SpotPromptInputProps, "status" | "submittedLabel"> & {
    busy: boolean;
    busyLabel: string;
    banner?: ReactNode;
  }
>(function ChatComposer({ busy, busyLabel, banner, ...props }, ref) {
  return (
    <>
      {banner}
      <SpotPromptInput
        ref={ref}
        {...props}
        status={busy ? "submitted" : undefined}
        submittedLabel={busyLabel}
      />
    </>
  );
});
