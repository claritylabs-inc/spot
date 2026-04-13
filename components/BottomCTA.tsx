"use client";

import { useState, useEffect } from "react";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoIcon } from "@/components/LogoIcon";
import { FadeIn } from "@/components/FadeIn";
import {
  PHONE_NUMBER,
  SMS_LINK,
  AI_DIRECT_LINKS,
  AI_COPY_PASTE_PROVIDERS,
  AI_COPY_PASTE_PROMPT,
} from "@/lib/constants";
import Image from "next/image";

function ClarityLogo({
  className = "",
  iconSize = 18,
}: {
  className?: string;
  iconSize?: number;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[3px] font-heading text-lg",
        className
      )}
    >
      <span>clarity</span>
      <LogoIcon size={iconSize} color="currentColor" className="shrink-0" />
      <span>labs</span>
    </span>
  );
}

function CopyPasteOverlay({
  provider,
  onClose,
}: {
  provider: { name: string; iconLarge: React.ReactNode };
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<"in" | "out">("in");

  useEffect(() => {
    const timer = setTimeout(() => {
      setPhase("out");
      setTimeout(onClose, 400);
    }, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-[200] flex items-center justify-center transition-all duration-400",
        phase === "in" ? "opacity-100" : "opacity-0"
      )}
      onClick={() => {
        setPhase("out");
        setTimeout(onClose, 400);
      }}
    >
      <div className="absolute inset-0 backdrop-blur-md bg-black/60" />
      <div
        className={cn(
          "relative z-10 flex flex-col items-center gap-4 transition-all duration-400",
          phase === "in"
            ? "opacity-100 scale-100 translate-y-0"
            : "opacity-0 scale-95 translate-y-2"
        )}
      >
        <div className="w-10 h-10 text-white">{provider.iconLarge}</div>
        <p className="text-[15px] text-white font-heading">
          Sending you to {provider.name}...
        </p>
        <p className="text-[13px] text-white/50">
          Prompt copied. Paste it when you get there.
        </p>
      </div>
    </div>
  );
}

export function BottomCTA() {
  const [activeProvider, setActiveProvider] = useState<
    (typeof AI_COPY_PASTE_PROVIDERS)[number] | null
  >(null);

  const handleCopyPaste = async (
    provider: (typeof AI_COPY_PASTE_PROVIDERS)[number]
  ) => {
    await navigator.clipboard.writeText(AI_COPY_PASTE_PROMPT);
    setActiveProvider(provider);
    setTimeout(() => {
      window.open(provider.url, "_blank", "noopener,noreferrer");
    }, 2500);
  };

  return (
    <>
      {activeProvider && (
        <CopyPasteOverlay
          provider={activeProvider}
          onClose={() => setActiveProvider(null)}
        />
      )}
      <section className="relative min-h-dvh flex flex-col justify-center overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="/auto.webp"
            alt="Friends on a road trip"
            fill
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-black/40" />
        </div>
        <div className="relative z-10 w-full px-6 flex-1 flex items-center">
          <div className="mx-auto max-w-lg text-center text-white">
            <FadeIn>
              <h2 className="font-heading text-4xl sm:text-5xl tracking-tight mb-4">
                Try it now
              </h2>
            </FadeIn>
            <FadeIn delay={0.15}>
              <p className="text-white/80 mb-8">
                Send us your full insurance policy over SMS. Takes about 10
                seconds.
              </p>
            </FadeIn>
            <FadeIn delay={0.3}>
              <a
                href={SMS_LINK}
                className="rounded-full px-8 h-12 text-base shadow-lg shadow-black/10 gap-2 inline-flex items-center font-medium bg-white text-black hover:bg-white/90 transition-colors"
              >
                <MessageSquare className="size-4" />
                Text {PHONE_NUMBER}
              </a>
            </FadeIn>
          </div>
        </div>

        {/* Footer */}
        <footer className="relative z-10 px-6 py-8 border-t border-white/20">
          <div className="mx-auto max-w-6xl flex flex-col gap-6">
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
              <div className="flex items-center gap-3 text-xs text-white">
                <ClarityLogo className="text-sm text-white" iconSize={12} />
                <span className="text-white/30">|</span>
                <span>&copy; 2026</span>
              </div>
              <div className="flex items-center gap-5 text-xs text-white">
                <a
                  href="#"
                  className="hover:text-white/70 transition-colors"
                >
                  Privacy
                </a>
                <a
                  href="#"
                  className="hover:text-white/70 transition-colors"
                >
                  Terms
                </a>
                <a
                  href="mailto:hello@claritylabs.inc"
                  className="hover:text-white/70 transition-colors"
                >
                  hello@claritylabs.inc
                </a>
              </div>
            </div>

            {/* AI Summary */}
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-4 border-t border-white/10">
              <span className="text-[10px] tracking-wide uppercase text-white/20">
                Summarize with AI
              </span>
              <div className="flex flex-wrap items-center gap-4">
                {AI_DIRECT_LINKS.map((link) => (
                  <a
                    key={link.name}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex items-center gap-1.5 text-xs text-white/30 transition-colors duration-200 hover:text-white/60 cursor-pointer"
                  >
                    <span className="transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6">
                      {link.icon}
                    </span>
                    {link.name}
                  </a>
                ))}
                {AI_COPY_PASTE_PROVIDERS.map((provider) => (
                  <button
                    key={provider.name}
                    onClick={() => handleCopyPaste(provider)}
                    className="group inline-flex items-center gap-1.5 text-xs text-white/30 transition-colors duration-200 hover:text-white/60 cursor-pointer"
                  >
                    <span className="transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6">
                      {provider.icon}
                    </span>
                    {provider.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </footer>
      </section>
    </>
  );
}
