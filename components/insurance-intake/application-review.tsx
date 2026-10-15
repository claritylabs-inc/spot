"use client";
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
  ];
  const content = (section: (typeof groups)[number]["section"]) =>
    section ? (
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
        value={selected}
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
          {section ? (
            <IntakeRequestReview
              answers={application.answers}
              details={application.details}
              section={section}
              hideHeading
            />
          ) : (
            <IntakeCompanyReview
              hideHeading
              answers={application.answers}
              details={application.details}
            />
          )}
        </section>
      ))}
    </div>
  );
}
