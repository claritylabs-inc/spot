"use client";
import type { ReactNode } from "react";
import { Checkbox } from "@claritylabs-inc/ui/components/checkbox";
import { Field, FieldLabel, FieldTitle, FieldDescription } from "@claritylabs-inc/ui/components/field";
import { INTAKE_TERMS_URL, INTAKE_TERMS_TITLE, INTAKE_AUTHORIZATION_CONSENT, INTAKE_SIGNATURE_CONSENT } from "@/lib/intake-terms";
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
  termsConsent,
  continueLabel = "Let’s begin",
  showSteps,
}: {
  continueLabel?: string;
  showSteps?: boolean;
  section: number;
  savings: boolean;
  status: string;
  disabled: boolean;
  onContinue: () => void;
  onBack: () => void;
  onSection: (step: number) => void;
  content?: { title: string; description: string; topics: (string | {label: string; icon: ReactNode})[] };
  applicantName?: string;
  termsConsent?: { checked: boolean; onCheckedChange: (checked: boolean) => void };
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
      showSteps={showSteps ?? !savings}
      status={status}
      disabled={disabled}
      onSection={termsConsent && !termsConsent.checked ? undefined : onSection}
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
          <PillButton size="large" disabled={disabled || (!!termsConsent && !termsConsent.checked)} onClick={onContinue}>
            {continueLabel}
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
            className={`text-pretty ${typeStyle("heading.display")}`}
            style={{textWrap:"pretty"}}
          >
            {section === 0 && !suppliedContent
              ? `Welcome${firstName ? ` ${firstName}` : ""}, let’s start with your request`
              : content.title}
          </h1>
          <p
            className={`w-full text-pretty text-muted-foreground ${typeStyle("body.root")}`}
            style={{ textWrap: "pretty" }}
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
                  key={typeof topic === "string" ? topic : topic.label}
                  className={`flex items-start gap-3 py-4 first:pt-0 last:pb-0 sm:py-5 ${typeStyle("body.root")}`}
                >
                  {typeof topic === "string" ? <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" /> : topic.icon}
                  <span>{typeof topic === "string" ? topic : topic.label}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        {termsConsent && (
          <FieldLabel
            htmlFor="intake-terms-consent"
            className="w-full cursor-pointer rounded-xl border border-border bg-card p-0 text-card-foreground transition-colors hover:bg-accent/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 [&>[data-slot=field]]:px-6 [&>[data-slot=field]]:py-4"
          >
            <Field orientation="horizontal" className="items-start gap-4">
              <Checkbox
                id="intake-terms-consent"
                className="mt-1"
                checked={termsConsent.checked}
                disabled={disabled}
                onCheckedChange={(checked) => termsConsent.onCheckedChange(checked === true)}
                aria-describedby="intake-terms-description"
              />
              <div className="min-w-0 space-y-2">
                <FieldTitle className={typeStyle("body.root")}>
                  {INTAKE_TERMS_TITLE}
                </FieldTitle>
                <FieldDescription id="intake-terms-description">
                  {INTAKE_AUTHORIZATION_CONSENT} {INTAKE_SIGNATURE_CONSENT}{" "}
                  <a href={INTAKE_TERMS_URL} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()} className="underline underline-offset-4">
                    Read the Terms of Service (opens in a new tab)
                  </a>.
                </FieldDescription>
              </div>
            </Field>
          </FieldLabel>
        )}
      </section>
    </IntakeFrame>
  );
}
