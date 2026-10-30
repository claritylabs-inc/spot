"use client";

import type { ReactNode } from "react";
import {
  AppShellPanelLayout as SharedAppShellPanelLayout,
  type AppShellAuxiliaryPanel,
} from "@claritylabs-inc/ui/components/app-shell/app-shell-panel-layout";

export function AppShellPanelLayout({
  entityPanel,
  main,
  pdfPanel,
  preserveAuxiliaryPixelWidths = false,
  rightPanel,
  previewPanel,
  rightPanelLabel = "Resize detail panel",
  rightPanelWide = false,
  storageUserId,
}: {
  entityPanel?: ReactNode;
  main: ReactNode;
  pdfPanel?: ReactNode;
  preserveAuxiliaryPixelWidths?: boolean;
  rightPanel?: ReactNode;
  /** A preview beside the detail panel (for example, the email a composer will send). */
  previewPanel?: ReactNode;
  rightPanelLabel?: string;
  /** Reading surfaces (mail) open wider and keep their own saved width. */
  rightPanelWide?: boolean;
  storageUserId?: string;
}) {
  const hasEntityPanel = Boolean(entityPanel);
  const hasPdfPanel = Boolean(pdfPanel);
  const hasRightPanel = Boolean(rightPanel);
  const auxiliaryPanels: AppShellAuxiliaryPanel[] = [];

  if (hasEntityPanel) {
    auxiliaryPanels.push({
      content: entityPanel,
      defaultWidth: 400,
      desktopOnly: true,
      id: "entity",
      label: "Resize policy preview",
      maxWidth: 700,
      minWidth: 320,
    });
  }

  if (hasRightPanel) {
    auxiliaryPanels.push(
      rightPanelWide
        ? {
            content: rightPanel,
            defaultWidth: 640,
            id: "right-wide",
            label: rightPanelLabel,
            maxWidth: 960,
            minWidth: 360,
          }
        : {
            content: rightPanel,
            defaultWidth: 420,
            id: "right",
            label: rightPanelLabel,
            maxWidth: 760,
            minWidth: 320,
          },
    );
  }

  if (previewPanel) {
    auxiliaryPanels.push({
      content: previewPanel,
      defaultWidth: 440,
      desktopOnly: true,
      id: "preview",
      label: "Resize preview",
      maxWidth: 760,
      minWidth: 320,
    });
  }

  if (hasPdfPanel) {
    auxiliaryPanels.push({
      content: pdfPanel,
      defaultWidth: 540,
      desktopOnly: true,
      id: "pdf",
      label: "Resize PDF preview",
      maxWidth: 900,
      minWidth: 360,
    });
  }

  return (
    <SharedAppShellPanelLayout
      idPrefix="app-shell"
      storageId={`spot:app-shell-panels:${storageUserId ?? "pending"}`}
      equalLayout={auxiliaryPanels.length >= 2 && !preserveAuxiliaryPixelWidths}
      main={main}
      panels={auxiliaryPanels}
    />
  );
}
