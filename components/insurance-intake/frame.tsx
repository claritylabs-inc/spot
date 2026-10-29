"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { IntakeProviderBrand } from "./provider-brand";
import { Button } from "@claritylabs-inc/ui/components/button";
import { INTAKE_VISIBLE_SECTIONS } from "@/lib/intake-sections";
import { OperatorImpersonationBanner } from "@/components/operator-impersonation-banner";
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
  steps,
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
  steps?: { label: string; id: number; step: number; disabled?: boolean }[];
}) {
  const navigationSteps: readonly {
    label: string;
    id: number;
    step: number;
    disabled?: boolean;
  }[] = steps ?? INTAKE_VISIBLE_SECTIONS;
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
      <header
        className={`grid ${steps ? "grid-cols-[auto_minmax(0,1fr)_auto] gap-4" : "grid-cols-3"} items-center border-b bg-background px-6 py-3 md:sticky md:top-0 md:z-20 sm:px-10`}
      >
        <IntakeProviderBrand />
        {showSteps ? (
          <nav
            aria-label="Application sections"
            className={`flex min-w-0 items-center justify-center ${steps ? "w-full max-w-md justify-self-center" : ""} ${steps && steps.length > 12 ? "gap-0.5 sm:gap-1" : "gap-1.5 sm:gap-2"}`}
          >
            {navigationSteps.map(
              ({ label, id, step, disabled: stepDisabled }, index) => (
                <Button
                  variant="ghost"
                  key={id}
                  aria-label={label}
                  aria-current={section === id ? "step" : undefined}
                  disabled={disabled || !onSection || stepDisabled}
                  onClick={() => onSection?.(step)}
                  className={`h-1.5 rounded-full p-0 disabled:opacity-100 ${steps ? "min-w-0 flex-1 max-w-10" : "w-3 sm:w-10"} ${navigationSteps.findIndex((item) => item.id === section) >= index ? "bg-foreground" : "bg-foreground/15"}`}
                />
              ),
            )}
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
            ? "mx-auto flex w-full max-w-3xl flex-1 items-start px-6 pt-10 pb-[calc(var(--spot-intake-footer-inset,5rem)+var(--spot-app-bottom-inset,0px)+2.5rem)] sm:pt-12 sm:pb-[calc(var(--spot-intake-footer-inset,5rem)+var(--spot-app-bottom-inset,0px)+3rem)]"
            : `mx-auto px-6 pb-[calc(8rem+var(--spot-app-bottom-inset,0px))] pt-10 sm:pt-12 ${compact ? "max-w-xl" : "max-w-2xl"}`
        }
      >
        {children}
      </main>
      <footer
        ref={footerRef}
        className="fixed inset-x-0 bottom-[var(--spot-app-bottom-inset,0px)] z-20 border-t bg-background px-6 pt-3 pb-[calc(.75rem+env(safe-area-inset-bottom))]"
      >
        <div
          className={`mx-auto flex min-h-12 items-center justify-between gap-4 ${introduction ? "max-w-3xl px-6" : compact ? "max-w-xl px-6" : "max-w-2xl"}`}
        >
          {footer}
        </div>
      </footer>
      <OperatorImpersonationBanner fixed />
    </div>
  );
}
