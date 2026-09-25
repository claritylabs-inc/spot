"use client";

import { Component, type ReactNode } from "react";

/** Keeps a missing or inaccessible thread from taking down the whole shell. */
export class DockErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
