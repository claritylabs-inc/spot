"use client";

import { useSearchParams } from "next/navigation";
import { BrandWordmark } from "@/components/auth-shell";
import { LogoIcon } from "@/components/ui/logo-icon";
import { typeStyle } from "@/lib/typography";
import { getQuoteProvider } from "@/lib/quote-provider";

/** Only registered brands can supply artwork or a home link. */
export function IntakeProviderBrand() {
  const params = useSearchParams();
  const provider = getQuoteProvider(params.get("provider"));
  if (!provider)
    return (
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
    );
  return (
    <div
      className="min-w-0 justify-self-start"
      data-quote-provider={provider.slug}
    >
      <a
        href={provider.homeUrl}
        aria-label={`${provider.name} home`}
        className="flex max-w-full items-center gap-2 no-underline"
      >
        {/* Public, allowlisted brand assets; native img preserves the source artwork. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={provider.logoUrl}
          alt={provider.name}
          width={32}
          height={32}
          className={
            provider.logoIsLockup
              ? "h-8 w-auto max-w-32 object-contain"
              : "size-8 shrink-0 rounded-sm bg-white object-contain"
          }
        />
      </a>
      <a
        href="https://spot.insure"
        aria-label="Powered by Spot"
        className={`mt-1 flex w-max items-center gap-1.5 whitespace-nowrap text-muted-foreground no-underline [&_svg]:h-2.5 [&_svg]:w-auto [&_svg]:shrink-0 ${typeStyle("caption.default")}`}
      >
        <span>Powered by</span>
        <BrandWordmark />
      </a>
    </div>
  );
}
