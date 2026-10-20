"use client";
import { typeStyle } from "@/lib/typography";
import { INTAKE_SECTION_INTRODUCTIONS } from "@/lib/intake-sections";
import { PillButton } from "@/components/ui/pill-button";
import { ChevronLeft, ArrowRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@claritylabs-inc/ui/components/card";
import { IntakeFrame } from "./frame";

export function IntakeSectionIntroduction({
  section,
  savings,
  status,
  disabled,
  onContinue,
  onBack,
  onSection,
  content: suppliedContent,
  applicantName,
}: {
  section: number;
  savings: boolean;
  status: string;
  disabled: boolean;
  onContinue: () => void;
  onBack: () => void;
  onSection: (step: number) => void;
  content?: { title: string; description: string; topics: string[] };
  applicantName?: string;
}) {
  const firstName = applicantName?.trim().split(/\s+/)[0];
  const content = suppliedContent ?? (
    savings && section === 3
      ? {
          title: "Your current policies",
          label: "Current policies",
          topics: [
            "Your current policy PDFs",
            "The coverage you’d like us to review",
          ],
          description:
            "Upload your policy PDFs so we can review your existing coverage and look for savings.",
        }
      : savings && section === 6
        ? {
            title: "Review your policies and business details",
            label: "Review",
            topics: ["Your policy uploads", "Your business information"],
            description:
              "Check your uploads and answers before sending them for review.",
          }
        : INTAKE_SECTION_INTRODUCTIONS[section]);
  return (
    <IntakeFrame
      introduction
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
            Let’s begin
            <ArrowRight aria-hidden="true" className="size-4" />
          </PillButton>
        </>
      }
    >
      <section
        aria-labelledby="intake-section-title"
        className="w-full space-y-8 sm:space-y-10"
      >
        <div className="space-y-4">
          <h1
            id="intake-section-title"
            className={`text-wrap-pretty ${typeStyle("heading.display")}`}
          >
            {section === 0 && !suppliedContent
              ? `Welcome${firstName ? ` ${firstName}` : ""}, let’s start with your request`
              : content.title}
          </h1>
          <p
            className={`max-w-xl text-pretty text-muted-foreground ${typeStyle("body.root")}`}
          >
            {content.description}
          </p>
        </div>
        <Card className="gap-5 py-6 sm:gap-6">
          <CardHeader className="px-6">
            <CardTitle>
              <h2 className={typeStyle("heading.item")}>What we’ll cover</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6">
            <ul className="divide-y">
              {content.topics.map((topic) => (
                <li
                  key={topic}
                  className={`flex items-start gap-3 py-4 first:pt-0 last:pb-0 sm:py-5 ${typeStyle("body.root")}`}
                >
                  <span
                    aria-hidden="true"
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
                  />
                  <span>{topic}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>
    </IntakeFrame>
  );
}
