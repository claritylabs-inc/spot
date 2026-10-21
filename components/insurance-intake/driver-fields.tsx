"use client";
import { IntakeReviewRows } from "./company-review";
import { typeStyle } from "@/lib/typography";
import dayjs from "dayjs";
import { DateField, parseDateText } from "@claritylabs-inc/ui/components/date-field";
import { DriverJurisdiction } from "./driver-jurisdiction";
import { Field, FieldLabel } from "@claritylabs-inc/ui/components/field";
import { Input } from "@claritylabs-inc/ui/components/input";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import { PillButton } from "@/components/ui/pill-button";
import { RemoveButton } from "@/components/ui/remove-button";
import { IntakeRadioChoices } from "./details-fields";
import {
  DRIVER_FIELDS,
  driverQuestion,
  newIntakeDriver,
  type IntakeDriver,
} from "@/lib/intake-drivers";
import type { IntakeDetails } from "@/lib/insurance-intake-details";
export function IntakeDriverFields({
  details,
  step,
  onChange,
}: {
  details: IntakeDetails;
  step: number;
  onChange: (details: IntakeDetails) => void;
}) {
  const drivers = details.drivers ?? [];
  const index = Math.min(
    details.driverIndex ?? 0,
    Math.max(0, drivers.length - 1),
  );
  const driver = drivers[index];
  const update = (patch: Partial<IntakeDriver>) =>
    onChange({
      ...details,
      drivers: drivers.map((row, i) =>
        i === index ? { ...row, ...patch } : row,
      ),
    });
  if (step === 31)
    return (
      <div className="ph-no-capture space-y-4 [&_input]:h-12">
        {drivers.map((row, i) => (
          <div key={row.id} className="flex items-center gap-3">
            <Input
              aria-label={`Driver ${i + 1} full name`}
              placeholder="Driver’s full name"
              value={row.name}
              onChange={(event) =>
                onChange({
                  ...details,
                  drivers: drivers.map((d, j) =>
                    j === i ? { ...d, name: event.target.value } : d,
                  ),
                })
              }
            />
            <RemoveButton
              label={`Remove driver ${i + 1}`}
              onClick={() =>
                onChange({
                  ...details,
                  drivers: drivers.filter((_, j) => j !== i),
                  driverIndex: 0,
                })
              }
            />
          </div>
        ))}
        <PillButton
          variant="secondary"
          size="large"
          disabled={drivers.length >= 30}
          onClick={() =>
            onChange({ ...details, drivers: [...drivers, newIntakeDriver()] })
          }
        >
          Add driver
        </PillButton>
      </div>
    );
  if (!driver) return <p>Add a driver to the schedule first.</p>;
  const field = DRIVER_FIELDS[step - 31];
  const label = driverQuestion(step, driver.name);
  return (
    <Field className="ph-no-capture gap-6 [&_input]:h-12 [&_button[role=combobox]]:h-12">
      {step === 32 ? (
        <Input
          aria-label={label}
          inputMode="numeric"
          placeholder="MM/DD/YYYY"
          maxLength={10}
          value={
            /^\d{4}-\d{2}-\d{2}$/.test(driver.dateOfBirth)
              ? dayjs(driver.dateOfBirth).format("MM/DD/YYYY")
              : driver.dateOfBirth
          }
          onChange={(event) =>
            update({
              dateOfBirth:
                parseDateText(event.target.value) ?? event.target.value,
            })
          }
        />
      ) : step === 34 ? (
        <>
        <DriverJurisdiction
          defaultCountry={details.registrationCountry}
          value={driver.licenseJurisdiction}
          onChange={(licenseJurisdiction) => update({ licenseJurisdiction })}
        />
        <DateField id={`driver-${driver.id}-dob`} label="Date of birth"
          value={/^\d{4}-\d{2}-\d{2}$/.test(driver.dateOfBirth) ? driver.dateOfBirth : ""}
          inputValue={/^\d{4}-\d{2}-\d{2}$/.test(driver.dateOfBirth) ? dayjs(driver.dateOfBirth).format("MM/DD/YYYY") : driver.dateOfBirth}
          onInputChange={text=>update({dateOfBirth:parseDateText(text)||text})}
          onChange={dateOfBirth=>update({dateOfBirth})}/>
        <Field><FieldLabel htmlFor={`driver-${driver.id}-license`} className={typeStyle("body.root")}>License number</FieldLabel>
          <Input id={`driver-${driver.id}-license`} aria-label="License number" placeholder="License number" autoComplete="off" maxLength={200}
            value={driver.licenseNumber} onChange={event=>update({licenseNumber:event.target.value})}/>
        </Field>
        </>
      ) : step === 37 || step === 39 ? (
        <IntakeRadioChoices
          label={label}
          value={
            driver[field] === "yes" ? "Yes" : driver[field] === "no" ? "No" : ""
          }
          choices={["Yes", "No"]}
          onChange={(value) =>
            update({ [field]: value === "Yes" ? "yes" : "no" })
          }
        />
      ) : step === 38 || step === 40 ? (
        <Textarea
          aria-label={label}
          placeholder={
            step === 38
              ? "Briefly describe the accidents"
              : "Briefly describe the violations"
          }
          value={driver[field]}
          maxLength={2000}
          onChange={(event) => update({ [field]: event.target.value })}
        />
      ) : (
        <Input
          aria-label={label}
          placeholder={
            step === 33
              ? "License number"
              : step === 35
                ? "e.g. Class A CDL, hazmat"
                : "Years of driving experience"
          }
          type={step === 36 ? "number" : "text"}
          min={step === 36 ? 0 : undefined}
          max={step === 36 ? 100 : undefined}
          value={driver[field]}
          maxLength={200}
          autoComplete="off"
          onChange={(event) => update({ [field]: event.target.value })}
        />
      )}
    </Field>
  );
}
export function IntakeDriverReview({ details }: { details: IntakeDetails }) {
  const historyValue = (answer: "" | "yes" | "no", notes: string) =>
    answer === "yes"
      ? ["Yes", notes.trim()].filter(Boolean).join(" — ")
      : answer === "no"
        ? "No"
        : "Not provided";
  return (
    <div className="ph-no-capture space-y-4">
      {details.drivers?.length ? (
        details.drivers.map((driver, index) => (
          <section key={driver.id} className="space-y-3">
            <h3 className={typeStyle("heading.item")}>
              {driver.name || `Driver ${index + 1}`}
            </h3>
            <IntakeReviewRows
              rows={[
                ...(driver.dateOfBirth
                  ? [
                      {
                        label: "Date of birth",
                        value: /^\d{4}-\d{2}-\d{2}$/.test(driver.dateOfBirth)
                          ? dayjs(driver.dateOfBirth).format("MMM D, YYYY")
                          : driver.dateOfBirth,
                      },
                    ]
                  : []),
                ...(driver.licenseNumber
                  ? [{ label: "License number", value: driver.licenseNumber }]
                  : []),
                {
                  label: "License issued in",
                  value: driver.licenseJurisdiction,
                },
                {
                  label: "License class and endorsements",
                  value: driver.licenseClass,
                },
                {
                  label: "Driving experience",
                  value: driver.yearsExperience.trim()
                    ? `${driver.yearsExperience} ${Number(driver.yearsExperience) === 1 ? "year" : "years"}`
                    : undefined,
                },
                {
                  label: "Accidents in the past five years",
                  value: historyValue(driver.accidents, driver.accidentDetails),
                },
                {
                  label: "Violations or suspensions in the past five years",
                  value: historyValue(
                    driver.violations,
                    driver.violationDetails,
                  ),
                },
              ]}
            />
          </section>
        ))
      ) : (
        <IntakeReviewRows rows={[]} emptyTitle="Driver schedule not provided" />
      )}
    </div>
  );
}
