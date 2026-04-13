"use client";

import Image from "next/image";
import { MessageSquare } from "lucide-react";
import { FadeIn } from "@/components/FadeIn";
import { StaggerCard } from "@/components/StaggerCard";
import { SMS_LINK, PHONE_NUMBER } from "@/lib/constants";

const CARDS = [
  {
    title: "Instant breakdown",
    desc: "Coverage, deductibles, exclusions — in plain English",
    image: "/hero.webp",
  },
  {
    title: "Ask anything",
    desc: "'Am I covered for water damage?' Get answers instantly",
    image: "/auto.webp",
  },
  {
    title: "Take action",
    desc: "Email proof of insurance, set reminders — all via text",
    image: "/faq-photo.webp",
  },
];

export function SpotIsSection() {
  return (
    <section className="bg-warm-bg min-h-dvh flex flex-col justify-center">
      <div className="px-6 py-24 sm:py-32 w-full">
        <div className="mx-auto max-w-5xl w-full text-center">
          <FadeIn>
            <h2 className="font-heading text-4xl sm:text-5xl lg:text-6xl tracking-tight mb-6">
              Insurance, understood
            </h2>
          </FadeIn>
          <FadeIn delay={0.1}>
            <p className="text-muted-foreground max-w-2xl mx-auto mb-8 text-base sm:text-lg leading-relaxed">
              Send your full policy over text. Spot reads it and texts you back what&apos;s covered,
              what&apos;s not, and what to watch out for — all in plain English.
            </p>
          </FadeIn>
          <FadeIn delay={0.2}>
            <a
              href={SMS_LINK}
              className="rounded-full px-8 h-12 text-base shadow-lg shadow-black/5 gap-2 inline-flex items-center font-medium bg-[#111827] text-white hover:bg-[#111827]/85 transition-colors"
            >
              <MessageSquare className="size-4" />
              Text {PHONE_NUMBER}
            </a>
          </FadeIn>

          {/* 3 photo cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-16">
            {CARDS.map((card, i) => (
              <StaggerCard key={card.title} index={i}>
                <div className="relative rounded-3xl overflow-hidden h-56 sm:h-72">
                  <Image
                    src={card.image}
                    alt={card.title}
                    fill
                    sizes="(max-width: 640px) 100vw, 33vw"
                    className="object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-6 text-left">
                    <h3 className="text-lg font-medium mb-1 text-white">
                      {card.title}
                    </h3>
                    <p className="text-sm leading-relaxed text-white/70">
                      {card.desc}
                    </p>
                  </div>
                </div>
              </StaggerCard>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
