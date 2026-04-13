"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FadeIn } from "@/components/FadeIn";

const TABS = [
  {
    key: "analyze",
    label: "Analyze",
    messages: [
      { from: "user", text: "📎 State_Farm_Auto_Policy.pdf" },
      { from: "spot", text: "Here's your breakdown:\n\nLiability: $300K/$100K ✓\nCollision: $1K deductible\nComprehensive: $500 deductible\nUninsured motorist: $100K\n\n⚠️ No rideshare coverage — if you drive for Uber/Lyft, you'll want to add that.\n\n⚠️ Your liability is solid but collision deductible is on the high side." },
    ],
  },
  {
    key: "qa",
    label: "Ask questions",
    messages: [
      { from: "user", text: "Am I covered if a tree falls on my car?" },
      { from: "spot", text: "Yes — that's covered under your comprehensive coverage.\n\nYou'd pay your $500 deductible, then insurance covers the rest up to your car's actual cash value.\n\nThis applies whether the tree is on your property or someone else's." },
    ],
  },
  {
    key: "email",
    label: "Email proof",
    messages: [
      { from: "user", text: "Can you email my proof of insurance to my landlord?" },
      { from: "spot", text: "Sure! What's their email?" },
      { from: "user", text: "sarah@building.co" },
      { from: "spot", text: "✉️ Draft ready:\n\nTo: sarah@building.co\nSubject: Proof of Insurance — Apt 4B\n\nAttached is my current renters policy...\n\nReply 'send' to send, or 'cancel' to stop." },
    ],
  },
  {
    key: "remind",
    label: "Reminders",
    messages: [
      { from: "spot", text: "Heads up — your auto policy expires in 30 days (May 15, 2026).\n\nWant me to remind you closer to the date?" },
      { from: "user", text: "Yes, remind me a week before" },
      { from: "spot", text: "Done! I'll text you on May 8th. 👍" },
    ],
  },
  {
    key: "portfolio",
    label: "Portfolio",
    messages: [
      { from: "user", text: "📎 Renters_Policy.pdf" },
      { from: "spot", text: "Got it — that's your 2nd policy. Here's what I found across both:\n\n✓ Auto + renters = good base coverage\n⚠️ No umbrella policy — with $300K auto liability, one bad accident could exceed your limits\n⚠️ Your renters jewelry sub-limit ($1,500) won't cover high-value items\n\nWant me to dig deeper into any of these?" },
    ],
  },
] as const;

export function UseCasesSection() {
  const [active, setActive] = useState(0);

  return (
    <section className="bg-[#111827] min-h-dvh flex flex-col justify-center">
      <div className="px-6 py-20 sm:py-24 w-full">
        <div className="mx-auto max-w-5xl w-full text-center">
          <FadeIn>
            <h2 className="font-heading text-3xl sm:text-4xl tracking-tight mb-4 text-white">
              See it in action
            </h2>
          </FadeIn>
          <FadeIn delay={0.1}>
            <p className="text-white/60 mb-12 max-w-lg mx-auto">
              Everything happens over text. No app, no dashboard — just send a message.
            </p>
          </FadeIn>

          {/* SMS conversation card */}
          <FadeIn delay={0.2}>
            <div className="relative mx-auto max-w-sm sm:max-w-md min-h-[320px]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={TABS[active].key}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                  className="backdrop-blur-xl bg-white/[0.07] border border-white/[0.12] rounded-3xl p-5 sm:p-6"
                >
                  <div className="flex flex-col gap-2.5">
                    {TABS[active].messages.map((msg, j) => (
                      <div
                        key={j}
                        className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed max-w-[88%] ${
                          msg.from === "user"
                            ? "self-end bg-[#A0D2FA]/20 text-white/90 rounded-br-sm"
                            : "self-start bg-white/10 text-white/80 rounded-bl-sm"
                        }`}
                      >
                        <p className="whitespace-pre-line text-left">{msg.text}</p>
                      </div>
                    ))}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </FadeIn>

          {/* Tab pills */}
          <FadeIn delay={0.3}>
            <div className="flex flex-wrap justify-center gap-2 mt-8">
              {TABS.map((tab, i) => (
                <button
                  key={tab.key}
                  onClick={() => setActive(i)}
                  className={`rounded-full px-5 py-2 text-sm font-medium transition-all duration-200 cursor-pointer ${
                    active === i
                      ? "bg-white text-[#111827]"
                      : "bg-white/10 text-white/60 hover:bg-white/15 hover:text-white/80"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}
