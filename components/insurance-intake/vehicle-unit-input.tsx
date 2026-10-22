"use client";
import { useContext } from "react";
import { NumberField } from "@base-ui/react/number-field";
import { InlineFieldsContext } from "@/components/ui/inline-fields";
import { GroupedNumberInput } from "@/components/ui/grouped-number-input";
import { Input } from "@claritylabs-inc/ui/components/input";
import { InputGroup, InputGroupInput, InputGroupAddon, InputGroupText } from "@claritylabs-inc/ui/components/input-group";
import { typeStyle } from "@/lib/typography";
import { IntakeUnknownRow, INTAKE_UNSURE } from "./unknown-choice";

export type VehicleNumberField = "annual_distance" | "gross_vehicle_weight" | "seats" | "percentage" | "number" | "count" | "months";

/** Unit suffixes remain part of saved facts; legacy metric values retain their units. */
export function VehicleUnitInput({ id, label, field, value, allowUnknown = true, onChange }: {
  id: string; label: string; field: VehicleNumberField; value: string; allowUnknown?: boolean; onChange: (value: string) => void;
}) {
  const match = value.trim().match(/^(\d[\d,]*(?:\.\d+)?)\s*(miles?|mi|km|kilomet(?:er|re)s?|lbs?|pounds?|kg|kilograms?|seats?|months?)?$/i);
  const unknown = value === INTAKE_UNSURE;
  const inline = useContext(InlineFieldsContext);
  const size = inline ? "" : "h-12";
  const type = typeStyle(inline ? "body.default" : "control.input");
  const unit = ["number", "count"].includes(field) ? "" : field === "months" ? "months" : field === "percentage" ? "%" : field === "seats" ? "seats" : field === "annual_distance"
    ? /^(km|kilomet)/i.test(match?.[2] ?? "") ? "km" : "miles"
    : /^(kg|kilogram)/i.test(match?.[2] ?? "") ? "kg" : "lbs";
  // Preserve freeform historical answers until the applicant replaces them.
  return <IntakeUnknownRow enabled={allowUnknown} label={label} value={value} onChange={onChange}>
  {value.trim() && !unknown && !match ? <Input id={id} aria-label={label} className={size} value={value}
    inputMode="numeric" onChange={event => onChange(event.target.value)} /> : <NumberField.Root locale="en-US" id={id} min={0} max={field === "percentage" ? 100 : field === "count" ? 999999999 : undefined} step={1}
    value={match ? Number(match[1].replaceAll(",", "")) : null}
    onValueChange={next => onChange(next === null ? "" : `${["percentage", "number"].includes(field) ? next : Math.round(next)}${["seats", "percentage", "number", "count"].includes(field) ? "" : ` ${unit}`}`)}
    format={{ maximumFractionDigits: ["percentage", "number"].includes(field) ? 2 : 0, useGrouping: true }}
    render={<InputGroup className={size} />}>
    <GroupedNumberInput maximum={field === "percentage" ? 100 : undefined} aria-label={label} placeholder={inline ? "Not provided" : field === "months" ? "e.g. 12" : field === "percentage" ? "e.g. 25" : ["number", "count"].includes(field) ? "Enter a number" : field === "seats" ? "e.g. 2" : field === "annual_distance" ? "e.g. 40,000" : "e.g. 26,000"}
      render={<InputGroupInput className={`min-w-0 flex-1 ${type}`} />} />
    {unit && <InputGroupAddon align="inline-end" className="ml-auto shrink-0 pl-3 pr-4"><InputGroupText className={type}>{unit}</InputGroupText></InputGroupAddon>}
  </NumberField.Root>}
  </IntakeUnknownRow>;
}
