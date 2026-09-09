"use client";

import { useEffect, useState, type ReactNode } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { typeStyle } from "@/lib/typography";

const EASE = [0.2, 0, 0, 1] as const;

export function SettingsDrawer({
  open,
  onOpenChange,
  title,
  actions,
  children,
  footer,
  contentClassName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  contentClassName?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [footerElement, setFooterElement] = useState<HTMLDivElement | null>(
    null,
  );
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const hasFooter = Boolean(footer);

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
          details.reason === "escape-key" ||
          details.reason === "close-press"
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
                render={
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.08, ease: EASE }}
                  />
                }
                className="max-lg:fixed! max-lg:inset-0! max-lg:z-50! flex h-full w-full shrink-0 overflow-hidden outline-none"
              >
                <motion.div
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
                  transition={{ duration: 0.1, ease: EASE }}
                  className="flex min-h-0 w-full flex-1 flex-col border-l border-border bg-background"
                >
                  <div className="min-h-12 flex items-center gap-3 px-4 py-2 border-b border-border shrink-0">
                    <Dialog.Title
                      render={<div />}
                      className={`min-w-0 flex-1 truncate text-foreground ${typeStyle("body.medium")}`}
                    >
                      {title}
                    </Dialog.Title>
                    {actions ? <div className="shrink-0">{actions}</div> : null}
                    <Dialog.Close
                      type="button"
                      className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/4 transition-colors shrink-0"
                      aria-label="Close"
                    >
                      <X className="w-4 h-4" />
                    </Dialog.Close>
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
                    <div className={cn("flex flex-col my-4", contentClassName)}>
                      {children}
                    </div>
                  </div>

                  {hasFooter && (
                    <div
                      ref={setFooterElement}
                      className="border-t border-border px-4 py-3 flex flex-col-reverse items-stretch gap-2 shrink-0 sm:flex-row sm:items-center sm:justify-end [&>button]:w-full [&>button]:min-h-8 [&>button]:py-2 [&>button[data-icon-only=true]]:!w-8 [&>button[data-icon-only=true]]:!px-0 [&>button[data-icon-only=true]]:!py-0 [&>button[data-icon-only=true]]:self-start sm:[&>button]:w-auto sm:[&>button]:min-h-7 sm:[&>button]:py-1 sm:[&>button[data-icon-only=true]]:!w-7 sm:[&>button[data-icon-only=true]]:!min-h-7 sm:[&>button[data-icon-only=true]]:self-auto"
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
