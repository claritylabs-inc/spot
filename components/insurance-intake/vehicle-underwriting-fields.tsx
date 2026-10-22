"use client";
import { useContext } from "react";
import { Field, FieldLabel } from "@claritylabs-inc/ui/components/field";
import { Input } from "@claritylabs-inc/ui/components/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@claritylabs-inc/ui/components/select";
import {
  InlineFieldsContext,
  InlineFieldRow,
} from "@/components/ui/inline-fields";
import { typeStyle } from "@/lib/typography";
import { IntakeRadioChoices } from "./radio-choices";
import { VehicleUnitInput, type VehicleNumberField } from "./vehicle-unit-input";
import {
  VEHICLE_UNDERWRITING_FIELDS,
  type IntakeVehicleUnderwriting,
} from "@/lib/intake-vehicle-underwriting";
export function IntakeVehicleUnderwritingFields({
  id,
  values,
  onChange,
}: {
  id: string;
  values: IntakeVehicleUnderwriting;
  onChange: (values: IntakeVehicleUnderwriting) => void;
}) {
  const inline = useContext(InlineFieldsContext);
  const Row = inline ? InlineFieldRow : Field;
  return (
    <>
      {VEHICLE_UNDERWRITING_FIELDS.filter(
        (field) =>
          !("retired" in field) &&
          (field.key !== "custom_equipment_detail" ||
            values.custom_equipment === "Yes"),
      ).map((field) => {
        const inputId = `${id}-${field.key}`;
        const change = (answer: string) =>
          onChange({
            ...values,
            [field.key]: answer,
            ...(field.key === "custom_equipment" && answer !== "Yes"
              ? { custom_equipment_detail: "" }
              : {}),
          });
        return (
          <Row key={field.key} label={inline ? field.label : undefined}>
            <FieldLabel
              htmlFor={inputId}
              className={inline ? "sr-only" : typeStyle("body.root")}
            >
              {field.label}
            </FieldLabel>
            {["annual_distance", "gross_vehicle_weight", "seats"].includes(field.key) ? (
              <VehicleUnitInput id={inputId} label={field.label} field={field.key as VehicleNumberField} value={values[field.key] ?? ""} onChange={change} />
            ) : "options" in field ? (
              !inline && field.options.length < 8 ? (
                <IntakeRadioChoices label={field.label} choices={field.options}
                  value={values[field.key] ?? ""} onChange={change} />
              ) : (
              <Select
                value={values[field.key] || null}
                onValueChange={(answer) => change(answer ?? "")}
              >
                <SelectTrigger
                  id={inputId}
                  className={`h-12 w-full ${typeStyle("body.root")}`}
                >
                  <SelectValue placeholder="Choose an answer">
                    {values[field.key] || undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {field.options.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              )
            ) : (
              <Input
                id={inputId}
                className={`h-12 ${typeStyle("body.root")}`}
                value={values[field.key] ?? ""}
                maxLength={2000}
                placeholder={
                  inline
                    ? "Not provided"
                    : "placeholder" in field
                      ? field.placeholder
                      : undefined
                }
                onChange={(event) => change(event.target.value)}
              />
            )}
          </Row>
        );
      })}
    </>
  );
}
