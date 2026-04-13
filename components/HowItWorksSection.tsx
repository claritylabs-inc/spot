"use client";

import Image from "next/image";
import { FadeIn } from "@/components/FadeIn";
import { StaggerCard } from "@/components/StaggerCard";

const STEPS = [
  {
    step: "01",
    title: "Send your policy",
    desc: "Snap a photo, forward a PDF, or send your declarations page. Any format works.",
  },
  {
    step: "02",
    title: "Get your breakdown",
    desc: "Coverage, deductibles, exclusions, and gaps — explained in plain English within minutes.",
  },
  {
    step: "03",
    title: "Ask follow-ups",
    desc: "Text any question about your policy. We'll answer from the actual document, not generic advice.",
  },
];

export function HowItWorksSection() {
  return (
    <section id="how" className="relative overflow-hidden min-h-dvh flex flex-col justify-center">
      {/* Photo background */}
      <div className="absolute inset-0">
        <Image
          src="/auto.webp"
          alt="Background"
          fill
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-black/60" />
      </div>

      <div className="relative z-10 px-6 py-20 sm:py-24 w-full">
        <div className="mx-auto max-w-5xl w-full">
          <FadeIn>
            <h2 className="font-heading text-3xl sm:text-4xl tracking-tight mb-14 text-white">
              How Spot works
            </h2>
          </FadeIn>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {STEPS.map((card, i) => (
              <StaggerCard key={card.title} index={i}>
                <div className="rounded-2xl bg-white p-6 sm:p-8 h-full">
                  <span className="text-xs font-mono text-[#9ca3af] mb-3 block">
                    {card.step}
                  </span>
                  <h3 className="text-lg sm:text-xl font-medium mb-2 text-[#111827]">
                    {card.title}
                  </h3>
                  <p className="text-sm text-[#4b5563] leading-relaxed">
                    {card.desc}
                  </p>
                </div>
              </StaggerCard>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
