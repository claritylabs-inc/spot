"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FadeIn } from "@/components/FadeIn";
import Image from "next/image";

const FAQ_ITEMS = [
  {
    value: "free",
    q: "Is this actually free?",
    a: "Yes. No hidden fees, no upsell, no premium tier. Spot is free.",
  },
  {
    value: "types",
    q: "What insurance types do you cover?",
    a: "Auto, renters, homeowners, pet, and most personal policies.",
  },
  {
    value: "how",
    q: "How does this actually work?",
    a: "You send your full insurance policy to our number over SMS. We read it and text you back a summary \u2014 what\u2019s covered, what\u2019s not, and anything that looks off. No app, no login.",
  },
  {
    value: "safe",
    q: "Is my information safe?",
    a: "Your documents are encrypted and never sold or shared. We read your policy, send you a summary, and that\u2019s it.",
  },
  {
    value: "speed",
    q: "How fast is the response?",
    a: "Usually a few minutes.",
  },
];

export function FAQSection() {
  return (
    <section id="faq" className="bg-warm-bg min-h-dvh flex flex-col justify-center">
      <div className="px-6 py-20 sm:py-24 w-full">
        <div className="mx-auto max-w-5xl w-full">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
            {/* Accordion with header */}
            <div>
              <FadeIn>
                <h2 className="font-heading text-3xl sm:text-4xl tracking-tight mb-8">
                  Questions
                </h2>
              </FadeIn>
              <Accordion className="w-full">
                {FAQ_ITEMS.map((item, i) => (
                  <FadeIn key={item.value} delay={i * 0.08}>
                    <AccordionItem value={item.value}>
                      <AccordionTrigger>{item.q}</AccordionTrigger>
                      <AccordionContent>{item.a}</AccordionContent>
                    </AccordionItem>
                  </FadeIn>
                ))}
              </Accordion>
            </div>

            {/* Photo card */}
            <FadeIn delay={0.2} className="hidden lg:flex">
              <div className="relative overflow-hidden rounded-3xl w-full min-h-[300px]">
                <Image
                  src="/faq-photo.webp"
                  alt="Person relaxing on grass with dogs"
                  fill
                  sizes="(max-width: 1024px) 0px, 50vw"
                  className="object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-8">
                  <p className="text-white font-heading text-2xl tracking-tight leading-snug">
                    Insurance should be
                    <br />
                    simple to understand.
                  </p>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </div>
    </section>
  );
}
