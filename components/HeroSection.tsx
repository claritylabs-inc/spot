"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoIcon } from "@/components/LogoIcon";
import { PHONE_NUMBER, SMS_LINK } from "@/lib/constants";
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

export { ClarityLogo };

export function HeroSection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });

  const heroTextOpacity = useTransform(scrollYProgress, [0, 0.4], [1, 0]);
  const heroTextY = useTransform(scrollYProgress, [0, 0.4], [0, -60]);

  return (
    <section ref={sectionRef} className="relative h-dvh overflow-hidden">
      <div className="absolute inset-0">
        <Image
          src="/hero.webp"
          alt="Person laughing against blue sky"
          fill
          sizes="100vw"
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/5 to-black/40" />
      </div>

      <motion.div
        className="relative z-10 flex flex-col items-center justify-center h-full px-6 text-center text-white"
        style={{ opacity: heroTextOpacity, y: heroTextY }}
      >
        <h1 className="font-heading text-4xl sm:text-6xl lg:text-7xl tracking-tight leading-[1.1] hero-fade-in hero-delay-1">
          Know what your
          <br />
          insurance actually covers
        </h1>
        <p className="mt-5 sm:mt-6 text-base sm:text-lg text-white max-w-md mx-auto leading-relaxed hero-fade-in hero-delay-3">
          Send us your full insurance policy over SMS. We&apos;ll text you back
          with what&apos;s covered, what&apos;s not, and what to look out for.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 hero-fade-in hero-delay-4">
          <a
            href={SMS_LINK}
            className="rounded-full px-8 h-12 text-base shadow-lg shadow-black/10 gap-2 inline-flex items-center font-medium bg-white text-black hover:bg-white/90 transition-colors"
          >
            <MessageSquare className="size-4" />
            Text {PHONE_NUMBER}
          </a>
          <p className="text-xs text-white">Free &bull; No app required</p>
        </div>
      </motion.div>

      <motion.div
        className="absolute bottom-8 left-0 right-0 z-10 flex flex-col items-center gap-1"
        style={{ opacity: heroTextOpacity }}
      >
        <span className="text-[10px] text-white/40 uppercase tracking-widest">
          From
        </span>
        <a
          href="https://claritylabs.inc"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/50 hover:text-white transition-colors"
        >
          <ClarityLogo className="text-base sm:text-lg" iconSize={14} />
        </a>
      </motion.div>
    </section>
  );
}
