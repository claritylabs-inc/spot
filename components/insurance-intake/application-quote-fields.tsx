"use client";
import { Plus } from "lucide-react";
import { Input } from "@claritylabs-inc/ui/components/input";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
} from "@claritylabs-inc/ui/components/input-group";
import {
  InlineFieldCard,
  InlineFieldRow,
} from "@/components/ui/inline-fields";
import { PillButton } from "@/components/ui/pill-button";
import { RemoveButton } from "@/components/ui/remove-button";
import type { IntakeDetails } from "@/lib/insurance-intake-details";
import {
  autoVehicles,
  estimatedVehicleValueError,
  vehicleQuoteLabel,
} from "@/lib/intake-auto-quote";
import { newIntakeDriver, type IntakeDriver } from "@/lib/intake-drivers";
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
import { IntakeValueInput, IntakeRadioChoices } from "./details-fields";
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

export function IntakeQuoteDetailsFields({ details, onChange }: Props) {
  return (
    <InlineFieldCard>
      <InlineFieldRow label="Freight hauled">
        <Textarea
          rows={1}
          aria-label="Freight hauled"
          placeholder="Not provided"
          maxLength={2000}
          value={details.freightHauled ?? ""}
          onChange={(event) =>
            onChange({ ...details, freightHauled: event.target.value })
          }
        />
      </InlineFieldRow>
      {autoVehicles(details).map((vehicle, index) => {
        const label = `${vehicleQuoteLabel(vehicle, index)} — approximate value`;
        const error = estimatedVehicleValueError(vehicle.estimatedValue);
        return (
          <InlineFieldRow key={index} label={label}>
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText>$</InputGroupText>
              </InputGroupAddon>
              <IntakeValueInput
                id={`operator-vehicle-value-${index}`}
                label={label}
                value={vehicle.estimatedValue ?? ""}
                placeholder="Not provided"
                onValueChange={(estimatedValue) =>
                  onChange({
                    ...details,
                    coverages: details.coverages.map((line) =>
                      line.coverage === "commercial_auto"
                        ? {
                            ...line,
                            vehicles: line.vehicles?.map((row, i) =>
                              i === index
                                ? {
                                    ...row,
                                    estimatedValue,
                                    estimatedValueSkipped: false,
                                  }
                                : row,
                            ),
                          }
                        : line,
                    ),
                  })
                }
              />
            </InputGroup>
            {error && (
              <p role="alert" className="px-3 py-1 text-destructive">
                {error}
              </p>
            )}
          </InlineFieldRow>
        );
      })}
    </InlineFieldCard>
  );
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

export function IntakeDriverScheduleFields({ details, onChange }: Props) {
  const drivers = details.drivers ?? [];
  const update = (index: number, patch: Partial<IntakeDriver>) =>
    onChange({
      ...details,
      drivers: drivers.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    });
  const text = (
    index: number,
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
        value={drivers[index][key]}
        onChange={(event) => update(index, { [key]: event.target.value })}
      />
    </InlineFieldRow>
  );
  return (
    <div className="ph-no-capture space-y-5">
      {!drivers.length && (
        <InlineFieldCard>
          <InlineFieldRow label="Drivers">
            <div className="px-3 py-2 text-muted-foreground">
              No drivers added
            </div>
          </InlineFieldRow>
        </InlineFieldCard>
      )}
      {drivers.map((driver, index) => (
        <InlineFieldCard
          key={driver.id}
          title={driver.name.trim() || `Driver ${index + 1}`}
          actions={
            <RemoveButton
              label={`Remove driver ${index + 1}`}
              onClick={() =>
                onChange({
                  ...details,
                  drivers: drivers.filter((_, i) => i !== index),
                  driverIndex: 0,
                })
              }
            />
          }
        >
          {text(index, "name", "Full name")}
          <InlineFieldRow label="Date of birth">
            <Input
              aria-label={`Driver ${index + 1} date of birth`}
              type="date"
              value={driver.dateOfBirth}
              onChange={(event) =>
                update(index, { dateOfBirth: event.target.value })
              }
            />
          </InlineFieldRow>
          {text(index, "licenseNumber", "License number")}
          <InlineFieldRow label="License issued in">
            <DriverJurisdiction
              defaultCountry={details.registrationCountry}
              value={driver.licenseJurisdiction}
              onChange={(licenseJurisdiction) =>
                update(index, { licenseJurisdiction })
              }
            />
          </InlineFieldRow>
          {text(index, "licenseClass", "License class and endorsements")}
          {text(index, "yearsExperience", "Years of driving experience")}
          {HISTORY.map((item) => (
            <div key={item.answer} className="contents">
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
                    update(index, {
                      [item.answer]: value === "Yes" ? "yes" : "no",
                    })
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
                    onChange={(event) =>
                      update(index, { [item.notes]: event.target.value })
                    }
                  />
                </InlineFieldRow>
              )}
            </div>
          ))}
        </InlineFieldCard>
      ))}
      <div className="flex justify-end">
        <PillButton
          variant="secondary"
          size="default"
          disabled={drivers.length >= 30}
          onClick={() =>
            onChange({ ...details, drivers: [...drivers, newIntakeDriver()] })
          }
        >
          <Plus className="size-3.5" />
          Add driver
        </PillButton>
      </div>
    </div>
  );
}
