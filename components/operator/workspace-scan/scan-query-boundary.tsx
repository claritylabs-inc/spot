"use client";

import { Component, type ReactNode } from "react";
import { OperationalPanel } from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";

export class ScanQueryBoundary extends Component<
  {
    children: ReactNode;
    renderError?: (content: ReactNode) => ReactNode;
  },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const content = (
      <div className="space-y-3">
        <p
          role="alert"
          className={`text-muted-foreground ${typeStyle("body.default")}`}
        >
          Email scan information could not be loaded. Your operator access may
          have changed.
        </p>
        <PillButton
          variant="secondary"
          onClick={() => this.setState({ failed: false })}
        >
          Try again
        </PillButton>
      </div>
    );
    return this.props.renderError ? (
      this.props.renderError(content)
    ) : (
      <OperationalPanel className="p-4">{content}</OperationalPanel>
    );
  }
}
