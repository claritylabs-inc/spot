"use client";
import { typeStyle } from "@/lib/typography";
import { INTAKE_SECTION_INTRODUCTIONS } from "@/lib/intake-sections";
import { PillButton } from "@/components/ui/pill-button";
import { ChevronLeft } from "lucide-react";
import { IntakeFrame } from "./frame";

export function IntakeSectionIntroduction({
  section,
  savings,
  status,
  disabled,
  onContinue,
  onBack,
  onSection,
}: {
  section: number;
  savings: boolean;
  status: string;
  disabled: boolean;
  onContinue: () => void;
  onBack: () => void;
  onSection: (step: number) => void;
}) {
  const content =
    savings && section === 3
      ? {
          title: "Your current policies",
          description:
            "Upload your policy PDFs so we can review your existing coverage and look for savings.",
        }
      : savings && section === 6
        ? {
            title: "Review your policies and business details",
            description:
              "Check your uploads and answers before sending them for review.",
          }
        : INTAKE_SECTION_INTRODUCTIONS[section];
  return (
    <IntakeFrame
      section={section}
      showSteps={!savings}
      status={status}
      disabled={disabled}
      onSection={onSection}
      footer={
        <>
          <PillButton
            size="large"
            variant="ghost"
            disabled={disabled}
            onClick={onBack}
          >
            {section === 0 ? (
              "Cancel"
            ) : (
              <>
                <ChevronLeft className="size-4" />
                Back
              </>
            )}
          </PillButton>
          <PillButton size="large" disabled={disabled} onClick={onContinue}>
            Continue
          </PillButton>
        </>
      }
    >
      <section aria-labelledby="intake-section-title" className="space-y-6">
        <h1
          id="intake-section-title"
          className={`text-wrap-pretty ${typeStyle("heading.display")}`}
        >
          {content.title}
        </h1>
        <p className={`text-muted-foreground ${typeStyle("body.large")}`}>
          {content.description}
        </p>
      </section>
    </IntakeFrame>
  );
}
