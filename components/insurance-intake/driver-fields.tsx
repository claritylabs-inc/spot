"use client";
import { typeStyle } from "@/lib/typography";
import dayjs from "dayjs";
import { parseDateText } from "@claritylabs-inc/ui/components/date-field";
import { DriverJurisdiction } from "./driver-jurisdiction";
import { Label } from "@claritylabs-inc/ui/components/label";
import { Field } from "@claritylabs-inc/ui/components/field";
import { Input } from "@claritylabs-inc/ui/components/input";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import { PillButton } from "@/components/ui/pill-button";
import { RemoveButton } from "@/components/ui/remove-button";
import { IntakeRadioChoices } from "./details-fields";
import {
  driverFieldValid,
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
      <div className="ph-no-capture space-y-4">
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
        <p className="text-muted-foreground">
          List the drivers you know. License numbers and birth dates can be
          provided later if a carrier needs them.
        </p>
        <PillButton
          variant="ghost"
          aria-pressed={!!details.collectSensitiveDriverDetails}
          onClick={() =>
            onChange({
              ...details,
              collectSensitiveDriverDetails:
                !details.collectSensitiveDriverDetails,
            })
          }
        >
          {details.collectSensitiveDriverDetails
            ? "Omit optional license numbers and birth dates"
            : "Add optional license numbers and birth dates"}
        </PillButton>
        <PillButton
          variant="secondary"
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
    <Field className="ph-no-capture gap-2">
      <Label className={`${typeStyle("body.root")} text-foreground`}>
        {driver.name}
      </Label>
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
        <DriverJurisdiction
          value={driver.licenseJurisdiction}
          onChange={(licenseJurisdiction) => update({ licenseJurisdiction })}
        />
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
      {!driverFieldValid(driver, step) && (
        <p role="alert" className="text-destructive">
          {step === 32
            ? "Enter a valid birth date in the past, or clear it to skip."
            : "Check this value, or clear it to skip."}
        </p>
      )}
    </Field>
  );
}
export function IntakeDriverReview({ details }: { details: IntakeDetails }) {
  return (
    <div className="ph-no-capture space-y-4">
      {details.drivers?.length ? (
        details.drivers.map((driver) => (
          <div key={driver.id} className="space-y-1">
            <p className={typeStyle("heading.item")}>{driver.name}</p>
            <p>Date of birth: {driver.dateOfBirth}</p>
            <p>
              License: {driver.licenseNumber} · {driver.licenseJurisdiction} ·{" "}
              {driver.licenseClass}
            </p>
            <p>Experience: {driver.yearsExperience} years</p>
            <p>
              Accidents in past five years: {driver.accidents || "Not answered"}
              {driver.accidents === "yes" ? ` — ${driver.accidentDetails}` : ""}
            </p>
            <p>
              Violations/suspensions in past five years:{" "}
              {driver.violations || "Not answered"}
              {driver.violations === "yes"
                ? ` — ${driver.violationDetails}`
                : ""}
            </p>
          </div>
        ))
      ) : (
        <p className="text-muted-foreground">Driver schedule not provided.</p>
      )}
    </div>
  );
}
