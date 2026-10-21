"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { IntakeProviderBrand } from "./provider-brand";
import { Button } from "@claritylabs-inc/ui/components/button";
import { INTAKE_VISIBLE_SECTIONS } from "@/lib/intake-sections";
import { typeStyle } from "@/lib/typography";

/** Shared intake layout; controls are provided by the shared UI package. */
export function IntakeFrame({
  children,
  footer,
  section = 0,
  status,
  onSection,
  disabled = false,
  showSteps = true,
  compact = false,
  introduction = false,
}: {
  children: ReactNode;
  footer?: ReactNode;
  section?: number;
  status?: string;
  onSection?: (step: number) => void;
  disabled?: boolean;
  showSteps?: boolean;
  compact?: boolean;
  introduction?: boolean;
}) {
  const footerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const footer = footerRef.current;
    if (!footer) return;
    const root = document.documentElement;
    const update = () =>
      root.style.setProperty(
        "--spot-intake-footer-inset",
        `${footer.getBoundingClientRect().height}px`,
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(footer);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--spot-intake-footer-inset");
    };
  }, []);
  return (
    <div
      data-intake-form
      className={`${introduction ? "flex min-h-dvh flex-col" : "min-h-screen"} bg-background text-foreground [&_textarea]:field-sizing-content! [&_textarea]:h-auto! [&_textarea]:max-h-none! [&_textarea]:overflow-y-hidden! [&_textarea]:resize-none!`}
    >
      <header className="grid grid-cols-3 items-center border-b bg-background px-6 py-3 md:sticky md:top-0 md:z-20 sm:px-10">
        <IntakeProviderBrand />
        {showSteps ? (
          <nav
            aria-label="Application sections"
            className="flex items-center justify-center gap-1.5 sm:gap-2"
          >
            {INTAKE_VISIBLE_SECTIONS.map(({ label, id, step }, index) => (
              <Button
                variant="ghost"
                key={label}
                aria-label={label}
                aria-current={section === id ? "step" : undefined}
                disabled={disabled || !onSection}
                onClick={() => onSection?.(step)}
                className={`h-1.5 w-3 rounded-full p-0 disabled:opacity-100 sm:w-10 ${INTAKE_VISIBLE_SECTIONS.findIndex(item => item.id === section) >= index ? "bg-foreground" : "bg-foreground/15"}`}
              />
            ))}
          </nav>
        ) : (
          <span aria-hidden="true" />
        )}
        <span
          role="status"
          aria-live="polite"
          className={`min-w-0 justify-self-end text-right text-muted-foreground ${typeStyle("body.root")}`}
        >
          {status}
        </span>
      </header>
      <main
        className={
          introduction
            ? "mx-auto flex w-full max-w-3xl flex-1 items-start px-6 pt-10 pb-[calc(var(--spot-intake-footer-inset,5rem)+2.5rem)] sm:pt-12 sm:pb-[calc(var(--spot-intake-footer-inset,5rem)+3rem)]"
            : `mx-auto px-6 pb-32 pt-10 sm:pt-12 ${compact ? "max-w-xl" : "max-w-2xl"}`
        }
      >
        {children}
      </main>
      <footer
        ref={footerRef}
        className="fixed inset-x-0 bottom-0 z-20 border-t bg-background px-6 pt-3 pb-[calc(.75rem+env(safe-area-inset-bottom))]"
      >
        <div
          className={`mx-auto flex min-h-12 items-center justify-between gap-4 ${introduction ? "max-w-3xl px-6" : compact ? "max-w-xl px-6" : "max-w-2xl"}`}
        >
          {footer}
        </div>
      </footer>
    </div>
  );
}
