"use client";

import { ScrollArea } from "@claritylabs-inc/ui/components/scroll-area";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { useShellPanel } from "@/components/shell-panels";
import { cn } from "@/lib/utils";
import { typeStyle } from "@/lib/typography";

const EASE = [0.2, 0, 0, 1] as const;

export function SettingsDrawer({
  open,
  onOpenChange,
  title,
  tabs,
  actions,
  children,
  footer,
  body = "padded",
  contentClassName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  /** The drawer's own views (`DrawerTabs`), laid out like page top-bar tabs. */
  tabs?: ReactNode;
  /** Header controls beside the close button. */
  actions?: ReactNode;
  children: ReactNode;
  /** Buttons, right-aligned with the primary last; stacked full width on phones. */
  footer?: ReactNode;
  /**
   * `padded` scrolls the content with the drawer's inset; `flush` scrolls it
   * edge to edge (mail, composers); `fill` hands the content the whole body
   * to lay out and scroll itself (a document viewer).
   */
  body?: "padded" | "flush" | "fill";
  contentClassName?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [footerElement, setFooterElement] = useState<HTMLDivElement | null>(
    null,
  );
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const hasFooter = Boolean(footer);

  // Opening the drawer, or showing another record in it, scrolls its panel
  // into view; the shell can close it the way the close button does.
  const panel = useShellPanel();
  const record = typeof title === "string" ? title : null;
  useEffect(() => {
    if (open) panel?.focus();
  }, [open, panel, record]);
  useEffect(() => {
    if (!panel || !open) return;
    panel.setOnClose(() => onOpenChange(false));
    return () => panel.setOnClose(undefined);
  }, [onOpenChange, open, panel]);

  useEffect(() => {
    if (!open || !footerElement) return;
    const root = document.documentElement;
    const previous = root.style.getPropertyValue(
      "--spot-settings-drawer-footer-inset",
    );
    const updateInset = () => {
      const height = footerElement.getBoundingClientRect().height;
      root.style.setProperty(
        "--spot-settings-drawer-footer-inset",
        `${height}px`,
      );
    };
    updateInset();
    const observer = new ResizeObserver(updateInset);
    observer.observe(footerElement);
    return () => {
      observer.disconnect();
      if (previous) {
        root.style.setProperty("--spot-settings-drawer-footer-inset", previous);
      } else {
        root.style.removeProperty("--spot-settings-drawer-footer-inset");
      }
    };
  }, [footerElement, open]);

  return (
    <Dialog.Root
      open={open}
      modal={false}
      disablePointerDismissal
      onOpenChange={(nextOpen, details) => {
        if (
          details.reason === "close-press" ||
          (details.reason === "escape-key" &&
            (panel?.ownsEscape(details.event) ?? true))
        ) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <div ref={setContainer} className="h-full w-full">
        <Dialog.Portal
          container={container}
          className="h-full w-full"
          keepMounted
        >
          <AnimatePresence mode="popLayout">
            {open && (
              <Dialog.Popup
                // Open on the close button, as untabbed drawers do, rather than the first tab.
                initialFocus={tabs ? closeRef : undefined}
                render={
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.08, ease: EASE }}
                  />
                }
                // The shell places the panel: a column, or full screen on phones.
                className="flex h-full w-full shrink-0 overflow-hidden outline-none"
              >
                <motion.div
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
                  transition={{ duration: 0.1, ease: EASE }}
                  className="flex min-h-0 w-full flex-1 flex-col border-l border-border bg-background"
                >
                  {/* Same header geometry as the page top bar, so drawer tabs
                      sit beside the title or wrap under it the same way. */}
                  <div className="app-top-bar-container">
                    <div
                      data-slot="app-top-bar"
                      data-tabs={tabs ? "true" : undefined}
                      className={cn(
                        "min-h-top-bar flex items-center gap-3 px-4 border-b border-border shrink-0",
                        !tabs && "py-2",
                      )}
                    >
                      <Dialog.Title
                        render={<div />}
                        data-slot="app-top-bar-context"
                        className={`flex min-w-0 flex-1 items-center truncate text-foreground ${typeStyle("body.medium")}`}
                      >
                        <span className="truncate">{title}</span>
                      </Dialog.Title>
                      {tabs ? <div data-slot="app-top-bar-tabs">{tabs}</div> : null}
                      {actions ? (
                        <div className="flex shrink-0 items-center gap-1 empty:hidden">
                          {actions}
                        </div>
                      ) : null}
                      <Dialog.Close
                        ref={closeRef}
                        type="button"
                        className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/4 transition-colors shrink-0"
                        aria-label="Close"
                      >
                        <X className="w-4 h-4" />
                      </Dialog.Close>
                    </div>
                  </div>

                  {body === "fill" ? (
                    <div
                      className={cn(
                        "flex min-h-0 min-w-0 flex-1 flex-col",
                        contentClassName,
                      )}
                    >
                      {children}
                    </div>
                  ) : (
                    <ScrollArea className="min-h-0 flex-1">
                      {body === "padded" ? (
                        <div className="flex flex-col px-4">
                          <div
                            className={cn(
                              "my-4 flex min-w-0 flex-col",
                              contentClassName,
                            )}
                          >
                            {children}
                          </div>
                        </div>
                      ) : (
                        <div
                          className={cn("flex min-w-0 flex-col", contentClassName)}
                        >
                          {children}
                        </div>
                      )}
                    </ScrollArea>
                  )}

                  {hasFooter && (
                    <div
                      ref={setFooterElement}
                      className="border-t border-border px-4 py-3 flex flex-col-reverse items-stretch gap-2 shrink-0 sm:flex-row sm:items-center sm:justify-end [&>:is(a,button)]:w-full [&>:is(a,button)]:min-h-8 [&>:is(a,button)]:py-2 [&>:is(a,button)[data-icon-only=true]]:!w-8 [&>:is(a,button)[data-icon-only=true]]:!px-0 [&>:is(a,button)[data-icon-only=true]]:!py-0 [&>:is(a,button)[data-icon-only=true]]:self-start sm:[&>:is(a,button)]:w-auto sm:[&>:is(a,button)]:min-h-7 sm:[&>:is(a,button)]:py-1 sm:[&>:is(a,button)[data-icon-only=true]]:!w-7 sm:[&>:is(a,button)[data-icon-only=true]]:!min-h-7 sm:[&>:is(a,button)[data-icon-only=true]]:self-auto"
                    >
                      {footer}
                    </div>
                  )}
                </motion.div>
              </Dialog.Popup>
            )}
          </AnimatePresence>
        </Dialog.Portal>
      </div>
    </Dialog.Root>
  );
}
