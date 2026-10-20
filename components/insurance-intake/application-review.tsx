"use client";
import { hasCommercialAuto } from "@/lib/intake-drivers";
import { IntakeAutoQuoteReview } from "./auto-quote-fields";
import { IntakeDriverReview } from "./driver-fields";
import { followupQuestionVisible } from "@/lib/intake-followups";
import { IntakeFollowupReview } from "./followup-review";
import { useState, type ReactNode } from "react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@claritylabs-inc/ui/components/tabs";
import type { IntakeApplication } from "@/lib/intake-application";
import { IntakeCompanyReview, IntakeRequestReview } from "./company-review";
import { typeStyle } from "@/lib/typography";

/** One structured application presentation for intake and operator surfaces. */
export function IntakeApplicationReview({
  application,
  tabbed = false,
  activeSection,
  extraRows,
}: {
  application: IntakeApplication;
  tabbed?: boolean;
  activeSection?: string;
  extraRows?: { label: string; value?: ReactNode }[];
}) {
  const [selected, setSelected] = useState("Contact details");
  const groups = [
    { title: "Contact details", section: "contact" as const },
    { title: "Request details", section: "request" as const },
    { title: "Coverage Requested", section: "coverage" as const },
    { title: "Business details", section: null },
    { title: "Insurance history", section: "history" as const },
    ...(hasCommercialAuto(application.details) &&
    (application.details.freightHauled ||
      application.details.coverages.some((line) =>
        line.vehicles?.some((vehicle) => vehicle.estimatedValue),
      ))
      ? [{ title: "Quote details", section: "autoQuote" as const }]
      : []),
    ...(hasCommercialAuto(application.details) &&
    application.details.drivers?.length
      ? [{ title: "Driver schedule", section: "drivers" as const }]
      : []),
    ...(application.details.followups?.some((row) =>
      followupQuestionVisible(row, application.details.followups),
    )
      ? [{ title: "Follow-up answers", section: "followups" as const }]
      : []),
  ];
  const content = (section: (typeof groups)[number]["section"]) =>
    section === "autoQuote" ? (
      <IntakeAutoQuoteReview details={application.details} hideHeading />
    ) : section === "drivers" ? (
      <IntakeDriverReview details={application.details} />
    ) : section === "followups" ? (
      <IntakeFollowupReview
        businessName={application.answers.legalName || application.answers.dba}
        answers={application.details.followups ?? []}
      />
    ) : section ? (
      <IntakeRequestReview
        answers={application.answers}
        details={application.details}
        section={section}
        extraRows={
          section === "request" || section === "history" ? extraRows : undefined
        }
        hideHeading
      />
    ) : (
      <IntakeCompanyReview
        hideHeading
        answers={application.answers}
        details={application.details}
      />
    );
  if (activeSection)
    return (
      <div data-review-content>
        {content(
          groups.find((group) => group.title === activeSection)?.section ??
            null,
        )}
      </div>
    );
  if (tabbed)
    return (
      <Tabs
        value={
          groups.some((group) => group.title === selected)
            ? selected
            : groups[0].title
        }
        onValueChange={(value) => setSelected(String(value))}
        className="gap-5"
      >
        <TabsList
          variant="pill"
          aria-label="Application details"
          className="max-w-full flex-wrap"
        >
          {groups.map(({ title }) => (
            <TabsTrigger key={title} value={title}>
              {title}
            </TabsTrigger>
          ))}
        </TabsList>
        {groups.map(({ title, section }) => (
          <TabsContent key={title} value={title}>
            {content(section)}
          </TabsContent>
        ))}
      </Tabs>
    );
  return (
    <div data-review-content className="w-full space-y-8">
      {groups.map(({ title, section }) => (
        <section key={title} className="space-y-3">
          <h2 className={typeStyle("heading.item")}>{title}</h2>
          {content(section)}
        </section>
      ))}
    </div>
  );
}
