"use client";
import { IntakeAutoQuoteReview } from "./auto-quote-fields";
import { IntakeDriverReview } from "./driver-fields";
import { IntakeFollowupReview } from "./followup-review";
import { useState, type ReactNode } from "react";
import { TabsTrigger } from "@claritylabs-inc/ui/components/tabs";
import {
  SectionTabs,
  SectionTabsList,
  SectionTabsPanel,
} from "@/components/ui/folder-tabs";
import {
  intakeFollowupAnswerRows,
  intakeQuoteSections,
  type IntakeApplication,
} from "@/lib/intake-application";
import { IntakeCompanyReview, IntakeRequestReview } from "./company-review";
import { typeStyle } from "@/lib/typography";

const QUOTE_SECTIONS = {
  "Quote details": "autoQuote",
  "Driver schedule": "drivers",
  "Follow-up answers": "followups",
} as const;

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
    ...intakeQuoteSections(application.details).map((title) => ({
      title,
      section: QUOTE_SECTIONS[title],
    })),
  ];
  const content = (section: (typeof groups)[number]["section"]) =>
    section === "autoQuote" ? (
      <IntakeAutoQuoteReview details={application.details} hideHeading />
    ) : section === "drivers" ? (
      <IntakeDriverReview details={application.details} />
    ) : section === "followups" ? (
      <IntakeFollowupReview
        details={application.details}
        businessName={application.answers.dba || application.answers.legalName}
        answers={intakeFollowupAnswerRows(
          application.answers,
          application.details,
        )}
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
      <SectionTabs
        value={
          groups.some((group) => group.title === selected)
            ? selected
            : groups[0].title
        }
        onValueChange={(value) => setSelected(String(value))}
      >
        <SectionTabsList aria-label="Application details">
          {groups.map(({ title }) => (
            <TabsTrigger key={title} value={title}>
              {title}
            </TabsTrigger>
          ))}
        </SectionTabsList>
        {groups.map(({ title, section }) => (
          <SectionTabsPanel key={title} value={title}>
            {content(section)}
          </SectionTabsPanel>
        ))}
      </SectionTabs>
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
