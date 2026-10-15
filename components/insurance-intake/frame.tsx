"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { LogoIcon } from "@/components/ui/logo-icon";
import { BrandWordmark } from "@/components/auth-shell";
import { Button } from "@claritylabs-inc/ui/components/button";
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
}: {
  children: ReactNode;
  footer?: ReactNode;
  section?: number;
  status?: string;
  onSection?: (step: number) => void;
  disabled?: boolean;
  showSteps?: boolean;
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
      className="min-h-screen bg-background text-foreground"
    >
      <header className="grid grid-cols-3 items-center border-b bg-background px-6 py-5 md:sticky md:top-0 md:z-20 sm:px-10">
        <a
          href="https://spot.insure"
          aria-label="Spot home"
          className="justify-self-start"
        >
          <LogoIcon size={24} className="sm:hidden" />
          <span className="hidden sm:inline-flex">
            <BrandWordmark />
          </span>
        </a>
        {showSteps ? (
          <nav
            aria-label="Application sections"
            className="flex items-center justify-center gap-1.5 sm:gap-2"
          >
            {[
              "Your request",
              "Coverage",
              "Company",
              "Insurance history",
              "Review",
            ].map((label, index) => (
              <Button
                variant="ghost"
                key={label}
                aria-label={label}
                aria-current={section === index ? "step" : undefined}
                disabled={disabled || !onSection}
                onClick={() => onSection?.([1, 6, 10, 20, 28][index])}
                className={`h-1.5 w-4 rounded-full p-0 disabled:opacity-100 sm:w-14 ${section >= index ? "bg-foreground" : "bg-foreground/15"}`}
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
      <main className="mx-auto max-w-2xl px-6 pb-36 pt-12 sm:pt-20">
        {children}
      </main>
      <footer
        ref={footerRef}
        className="fixed inset-x-0 bottom-0 z-20 border-t bg-background px-6 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto flex min-h-12 max-w-2xl items-center justify-between gap-4">
          {footer}
        </div>
      </footer>
    </div>
  );
}
