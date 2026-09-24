"use client";

import type { CSSProperties } from "react";
import { AppToaster as Toaster } from "@claritylabs-inc/ui/components/app-shell/toaster";
import { useTheme } from "@/hooks/use-theme";
import { typeStyle } from "@/lib/typography";

export function AppToaster() {
  const { resolved } = useTheme();
  return (
    <Toaster
      theme={resolved}
      icons={{
        success: undefined,
        info: undefined,
        warning: undefined,
        error: undefined,
        loading: undefined,
      }}
      position="bottom-right"
      closeButton
      gap={8}
      visibleToasts={4}
      offset={{
        right: 24,
        bottom:
          "calc(var(--spot-app-bottom-inset, 0px) + var(--spot-settings-drawer-footer-inset, 0px) + 1rem)",
      }}
      mobileOffset={{
        top: 16,
        right: 16,
        bottom:
          "calc(var(--spot-app-bottom-inset, 0px) + var(--spot-settings-drawer-footer-inset, 0px) + env(safe-area-inset-bottom) + 1rem)",
        left: 16,
      }}
      style={
        {
          "--width": "min(356px, calc(100vw - 2rem))",
        } as CSSProperties
      }
      toastOptions={{
        style: {
          width: "var(--width)",
          maxWidth: "calc(100vw - 2rem)",
        },
        className: `!overflow-hidden !rounded-xl !border !border-foreground/10 !bg-card !text-foreground !shadow-sm !shadow-black/[0.08] dark:!bg-popover/95 ${typeStyle("body.default")}`,
        descriptionClassName: `!text-muted-foreground ${typeStyle("caption.default")}`,
      }}
    />
  );
}
