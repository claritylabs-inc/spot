"use client";
import { NumberField } from "@base-ui/react/number-field";
import { Input } from "@claritylabs-inc/ui/components/input";
import { InputGroup, InputGroupInput, InputGroupAddon, InputGroupText } from "@claritylabs-inc/ui/components/input-group";
import { typeStyle } from "@/lib/typography";
import { IntakeUnknownChoice, INTAKE_UNSURE } from "./unknown-choice";

export type VehicleNumberField = "annual_distance" | "gross_vehicle_weight" | "seats" | "percentage" | "number" | "count";

/** Unit suffixes remain part of saved facts; legacy metric values retain their units. */
export function VehicleUnitInput({ id, label, field, value, onChange }: {
  id: string; label: string; field: VehicleNumberField; value: string; onChange: (value: string) => void;
}) {
  const match = value.trim().match(/^(\d[\d,]*(?:\.\d+)?)\s*(miles?|mi|km|kilomet(?:er|re)s?|lbs?|pounds?|kg|kilograms?|seats?)?$/i);
  const unknown = value === INTAKE_UNSURE;
  const unit = ["number", "count"].includes(field) ? "" : field === "percentage" ? "%" : field === "seats" ? "seats" : field === "annual_distance"
    ? /^(km|kilomet)/i.test(match?.[2] ?? "") ? "km" : "miles"
    : /^(kg|kilogram)/i.test(match?.[2] ?? "") ? "kg" : "lb";
  // Preserve freeform historical answers until the applicant replaces them.
  if (value.trim() && !unknown && !match) return <Input id={id} aria-label={label} value={value}
    inputMode="numeric" onChange={event => onChange(event.target.value)} />;
  if (unknown) return <InputGroup className="h-12"><InputGroupAddon className="w-full px-3"><IntakeUnknownChoice label={label} checked onChange={() => onChange("")} /></InputGroupAddon></InputGroup>;
  return <NumberField.Root id={id} min={0} max={field === "percentage" ? 100 : field === "count" ? 999999999 : undefined} step={1}
    value={match ? Number(match[1].replaceAll(",", "")) : null}
    onValueChange={next => onChange(next === null ? "" : `${["percentage", "number"].includes(field) ? next : Math.round(next)}${["seats", "percentage", "number", "count"].includes(field) ? "" : ` ${unit}`}`)}
    format={{ maximumFractionDigits: ["percentage", "number"].includes(field) ? 2 : 0, useGrouping: true }}
    render={<InputGroup className="h-12" />}>
    <NumberField.Input aria-label={label} placeholder={field === "percentage" ? "e.g. 25" : ["number", "count"].includes(field) ? "Enter a number" : field === "seats" ? "e.g. 2" : field === "annual_distance" ? "e.g. 40,000" : "e.g. 26,000"}
      render={<InputGroupInput className={`min-w-0 ${typeStyle("body.root")}`} />} />
    {unit && <InputGroupAddon align="inline-end"><InputGroupText>{unit}</InputGroupText></InputGroupAddon>}
    {!value.trim() && <InputGroupAddon align="inline-end" className="pr-4"><IntakeUnknownChoice label={label} checked={false} onChange={checked => onChange(checked ? INTAKE_UNSURE : "")} /></InputGroupAddon>}
  </NumberField.Root>;
}
