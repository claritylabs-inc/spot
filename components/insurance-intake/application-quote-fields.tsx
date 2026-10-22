"use client";
import { Fragment } from "react";
import { Input } from "@claritylabs-inc/ui/components/input";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import { InlineFieldRow } from "@/components/ui/inline-fields";
import type { IntakeDetails } from "@/lib/insurance-intake-details";
import type { IntakeDriver } from "@/lib/intake-drivers";
import {
  personalizeIntakeQuestion,
  withIntakeFollowupAnswer,
  type IntakeFollowupAnswer,
} from "@/lib/intake-followups";
import {
  intakeApplicantQuestion,
  intakeLocationHeading,
} from "@/lib/intake-applicant-wording";
import { payrollPages, payrollPageTitle } from "@/lib/intake-payroll";
import { IntakeRadioChoices } from "./details-fields";
import { DriverJurisdiction } from "./driver-jurisdiction";
import { IntakeFollowups } from "./followups";

type Props = {
  details: IntakeDetails;
  onChange: (details: IntakeDetails) => void;
};

/** Saved follow-up answers as inline rows, using the applicant's typed controls. */
export function IntakeFollowupRows({
  rows,
  details,
  businessName,
  industry,
  onChange,
}: Props & {
  rows: IntakeFollowupAnswer[];
  businessName?: string;
  industry?: string;
}) {
  return rows.flatMap((row) => {
    const presentation = intakeApplicantQuestion(row, industry, details.followups);
    const label =
      row.section === "acord"
        ? [
            intakeLocationHeading(row, details)?.name ?? presentation.context,
            presentation.title,
          ]
            .filter(Boolean)
            .join(" · ")
        : personalizeIntakeQuestion(row.label, businessName);
    const pages = row.source?.endsWith(" · shared.operations.annual_payroll")
      ? payrollPages(row.answer)
      : [undefined];
    return pages.map((page) => (
      <InlineFieldRow
        key={page ? `${row.id}-${page.field}-${page.groupIndex}` : row.id}
        label={page ? payrollPageTitle(row.answer, page) : label}
      >
        <IntakeFollowups
          status="ready"
          question={row}
          answers={details.followups}
          answer={row.answer}
          payrollPage={page}
          defaultCountry={details.registrationCountry}
          businessName={businessName}
          industry={industry}
          onChange={(question, answer) =>
            onChange({
              ...details,
              followups: withIntakeFollowupAnswer(
                details.followups ?? [],
                question,
                answer,
              ),
            })
          }
        />
      </InlineFieldRow>
    ));
  });
}

const HISTORY = [
  {
    answer: "accidents",
    notes: "accidentDetails",
    label: "Accidents in the past five years",
    notesLabel: "Accident details",
  },
  {
    answer: "violations",
    notes: "violationDetails",
    label: "Violations or suspensions in the past five years",
    notesLabel: "Violation or suspension details",
  },
] as const;

/** Operator rows for one driver; the owner supplies the panel and removal. */
export function IntakeDriverRows({
  driver,
  index,
  defaultCountry,
  onChange: update,
}: {
  driver: IntakeDriver;
  index: number;
  defaultCountry?: string;
  onChange: (patch: Partial<IntakeDriver>) => void;
}) {
  const text = (
    key: "name" | "licenseNumber" | "licenseClass" | "yearsExperience",
    label: string,
  ) => (
    <InlineFieldRow label={label}>
      <Input
        aria-label={`Driver ${index + 1} ${label.toLowerCase()}`}
        placeholder="Not provided"
        autoComplete="off"
        maxLength={200}
        type={key === "yearsExperience" ? "number" : "text"}
        min={key === "yearsExperience" ? 0 : undefined}
        max={key === "yearsExperience" ? 100 : undefined}
        value={driver[key]}
        onChange={(event) => update({ [key]: event.target.value })}
      />
    </InlineFieldRow>
  );
  return (
    <>
      {text("name", "Full name")}
      <InlineFieldRow label="Date of birth">
        <Input
          aria-label={`Driver ${index + 1} date of birth`}
          type="date"
          value={driver.dateOfBirth}
          onChange={(event) => update({ dateOfBirth: event.target.value })}
        />
      </InlineFieldRow>
      {text("licenseNumber", "License number")}
      <InlineFieldRow label="License issued in">
        <DriverJurisdiction
          defaultCountry={defaultCountry}
          value={driver.licenseJurisdiction}
          onChange={(licenseJurisdiction) => update({ licenseJurisdiction })}
        />
      </InlineFieldRow>
      {text("licenseClass", "License class and endorsements")}
      {text("yearsExperience", "Years of driving experience")}
      {HISTORY.map((item) => (
        <Fragment key={item.answer}>
          <InlineFieldRow label={item.label}>
            <IntakeRadioChoices
              label={`Driver ${index + 1} ${item.label.toLowerCase()}`}
              choices={["Yes", "No"]}
              value={
                driver[item.answer] === "yes"
                  ? "Yes"
                  : driver[item.answer] === "no"
                    ? "No"
                    : ""
              }
              onChange={(value) =>
                update({ [item.answer]: value === "Yes" ? "yes" : "no" })
              }
            />
          </InlineFieldRow>
          {driver[item.answer] === "yes" && (
            <InlineFieldRow label={item.notesLabel}>
              <Textarea
                rows={1}
                aria-label={`Driver ${index + 1} ${item.notesLabel.toLowerCase()}`}
                placeholder="Not provided"
                maxLength={2000}
                value={driver[item.notes]}
                onChange={(event) => update({ [item.notes]: event.target.value })}
              />
            </InlineFieldRow>
          )}
        </Fragment>
      ))}
    </>
  );
}
