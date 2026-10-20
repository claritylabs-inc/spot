"use client";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
} from "@claritylabs-inc/ui/components/input-group";
import { IntakeReviewRows } from "./company-review";
import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";
import { IntakeValueInput } from "./details-fields";
import {
  autoVehicles,
  vehicleQuoteLabel,
  estimatedVehicleValueError,
} from "@/lib/intake-auto-quote";
import { hasCommercialAuto } from "@/lib/intake-drivers";
import type { IntakeDetails } from "@/lib/insurance-intake-details";
export function IntakeAutoQuoteFields({
  details,
  step,
  onChange,
}: {
  details: IntakeDetails;
  step: number;
  onChange: (details: IntakeDetails) => void;
}) {
  if (step === 41)
    return (
      <Textarea
        aria-label="What freight do you haul?"
        placeholder="Describe the main goods you transport"
        value={details.freightHauled ?? ""}
        maxLength={2000}
        onChange={(event) =>
          onChange({ ...details, freightHauled: event.target.value })
        }
      />
    );
  const vehicles = autoVehicles(details);
  const index = Math.min(
    details.autoVehicleIndex ?? 0,
    Math.max(0, vehicles.length - 1),
  );
  const vehicle = vehicles[index];
  if (!vehicle) return null;
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        {vehicleQuoteLabel(vehicle, index)}
      </p>
      <InputGroup className="h-12">
        <InputGroupAddon>
          <InputGroupText>$</InputGroupText>
        </InputGroupAddon>
        <IntakeValueInput
          id="vehicle-estimated-value"
          label="Approximate current vehicle value"
          value={vehicle.estimatedValue ?? ""}
          placeholder="0"
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
      {estimatedVehicleValueError(vehicle.estimatedValue) && (
        <p role="alert" className="text-destructive">
          {estimatedVehicleValueError(vehicle.estimatedValue)}
        </p>
      )}
    </div>
  );
}
export function IntakeAutoQuoteReview({
  details,
  onEdit,
  hideHeading = false,
}: {
  details: IntakeDetails;
  onEdit?: (step: number) => void;
  hideHeading?: boolean;
}) {
  if (!hasCommercialAuto(details)) return null;
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {!hideHeading && (
          <div className="flex items-center justify-between">
            <h2 className={typeStyle("heading.item")}>
              Commercial auto details
            </h2>
            {onEdit && (
              <PillButton variant="ghost" onClick={() => onEdit(41)}>
                Edit
              </PillButton>
            )}
          </div>
        )}
        <IntakeReviewRows
          rows={[
            { label: "Freight hauled", value: details.freightHauled },
            ...autoVehicles(details).map((vehicle, index) => ({
              label: `${vehicleQuoteLabel(vehicle, index)} — approximate value`,
              value: vehicle.estimatedValue
                ? `$${vehicle.estimatedValue}`
                : undefined,
            })),
          ]}
        />
      </div>
    </div>
  );
}
