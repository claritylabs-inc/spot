"use client";

import { Component, type ReactNode } from "react";

import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { typeStyle } from "@/lib/typography";

/** Shown in the reader when a conversation id is invalid, deleted or out of scope. */
export function ConversationUnavailable({ onClose }: { onClose: () => void }) {
  return (
    <SettingsDrawer
      open
      title="Conversation unavailable"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
        This conversation is not available. It may have been deleted, or it
        belongs to another request.
      </p>
    </SettingsDrawer>
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
