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
 * input, e.g. a queued message. Teammates on the same page share the prompt
 * only with a `collabScope` naming the thread; otherwise it stays private and
 * hides this operator's pointer from them.
 */
export const ChatComposer = forwardRef<
  ChatComposerHandle,
  Omit<SpotPromptInputProps, "status" | "submittedLabel"> & {
    busy: boolean;
    busyLabel: string;
    banner?: ReactNode;
    collabScope?: string;
  }
>(function ChatComposer(
  { busy, busyLabel, banner, collabScope, ...props },
  ref,
) {
  return (
    <div
      className="contents"
      {...(collabScope
        ? { "data-collab-scope": collabScope }
        : { "data-follow-private": "" })}
    >
      {banner}
      <SpotPromptInput
        ref={ref}
        {...props}
        status={busy ? "submitted" : undefined}
        submittedLabel={busyLabel}
      />
    </div>
  );
});
