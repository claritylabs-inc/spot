import { Navbar } from "@/components/Navbar";
import { HeroSection } from "@/components/HeroSection";
import { SpotIsSection } from "@/components/SpotIsSection";
import { UseCasesSection } from "@/components/UseCasesSection";
import { HowItWorksSection } from "@/components/HowItWorksSection";
import { FAQSection } from "@/components/FAQSection";
import { BottomCTA } from "@/components/BottomCTA";

export default function Home() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Spot",
    description:
      "Know what your insurance actually covers. Text a photo of your policy to Spot and get a plain-English breakdown of your coverage, deductibles, and gaps in minutes.",
    url: process.env.NEXT_PUBLIC_SITE_URL || "https://spot.claritylabs.inc",
    applicationCategory: "FinanceApplication",
    operatingSystem: "SMS",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    creator: {
      "@type": "Organization",
      name: "Clarity Labs",
      url: "https://claritylabs.inc",
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Navbar />
      <main>
        <HeroSection />
        <SpotIsSection />
        <UseCasesSection />
        <HowItWorksSection />
        <FAQSection />
        <BottomCTA />
      </main>
    </>
  );
}
