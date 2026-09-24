import { type ReactNode } from "react";
import { SpotWordmark } from "@claritylabs-inc/ui/components/brand/spot-wordmark";
import { typeStyle } from "@/lib/typography";

export function BrandWordmark() {
  return <SpotWordmark />;
}

export function PoweredBySpotWordmark() {
  return (
    <div className={`flex items-center justify-center gap-2 text-muted-foreground ${typeStyle("caption.default")}`}>
      <span>Powered by</span>
      <SpotWordmark />
    </div>
  );
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-8 sm:py-10">
        <header className={`flex items-center justify-between text-muted-foreground ${typeStyle("body.default")}`}>
          <BrandWordmark />
        </header>
        <main className="flex flex-1 items-center justify-center py-12 sm:py-20">{children}</main>
      </div>
    </div>
  );
}

export function AuthMinimalShell({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-8 sm:py-10">
        <main className="flex flex-1 items-center justify-center py-12 sm:py-20">{children}</main>
        {footer ? <footer className="pb-2 sm:pb-4">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function AuthCard({
  title,
  subtitle,
  logo,
  children,
}: {
  title: string;
  subtitle?: string;
  logo?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="w-full max-w-md space-y-8">
      <div className="space-y-3 text-left">
        {logo ? <div className="mb-14">{logo}</div> : null}
        <h1 className={`${typeStyle("heading.micro")}`}>{title}</h1>
        {subtitle ? <p className={`text-muted-foreground ${typeStyle("body.default")}`}>{subtitle}</p> : null}
      </div>
      <div>
        {children}
      </div>
    </div>
  );
}
