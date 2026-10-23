"use client";

import { Component, type ReactNode } from "react";

import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";

/** Shown in the reader when a conversation id is invalid, deleted or out of scope. */
export function ConversationUnavailable({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 p-4">
      <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
        This conversation is not available.
      </p>
      <PillButton type="button" variant="ghost" onClick={onClose}>
        Close
      </PillButton>
    </div>
  );
}

type Props = { resetKey: string; onClose: () => void; children: ReactNode };

/**
 * A pasted or stale conversation id can make the reader's query reject. Show an
 * unavailable state instead of failing the page, and recover when the selection changes.
 */
export class ReaderBoundary extends Component<Props, { failedKey: string | null }> {
  state = { failedKey: null as string | null };

  static getDerivedStateFromError() {
    return { failedKey: "" };
  }

  componentDidCatch() {
    this.setState({ failedKey: this.props.resetKey });
  }

  componentDidUpdate(previous: Props) {
    if (previous.resetKey !== this.props.resetKey && this.state.failedKey !== null)
      this.setState({ failedKey: null });
  }

  render() {
    if (this.state.failedKey === null) return this.props.children;
    return <ConversationUnavailable onClose={this.props.onClose} />;
  }
}
