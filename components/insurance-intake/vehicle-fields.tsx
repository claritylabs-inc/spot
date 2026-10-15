"use client";
import {
  InlineFieldRow,
  InlineFieldsContext,
} from "@/components/ui/inline-fields";
import { useContext, useEffect, useState } from "react";
import { CarFront } from "lucide-react";
import { vehicleMakeLabel } from "@/lib/vehicle-display";
import vehicleLogoFiles from "@/lib/vehicle-make-logos.json";
const makeKey = (make: string) => make.toLowerCase().replace(/[^a-z0-9]/g, "");
const familiarMakes = [
  "ford",
  "toyota",
  "chevrolet",
  "honda",
  "nissan",
  "hyundai",
  "kia",
  "jeep",
  "ram",
  "subaru",
  "tesla",
  "volkswagen",
  "bmw",
  "mazda",
  "audi",
  "mercedesbenz",
  "lexus",
  "mclaren",
  "gmc",
  "dodge",
  "buick",
  "lincoln",
  "volvo",
];
const makeAliases: Record<string, string> = {
  chevy: "chevrolet",
  chev: "chevrolet",
  mercedes: "mercedesbenz",
  mclarenautomotive: "mclaren",
};
const logoFile = (make: string) => {
  const key = makeKey(make);
  return (vehicleLogoFiles as Record<string, string>)[makeAliases[key] || key];
};
const hasMakeLogo = (make: string) => !!logoFile(make);
function compareMakes(a: string, b: string) {
  const first = makeKey(a),
    second = makeKey(b);
  const group = (key: string) =>
    !hasMakeLogo(key) ? 2 : familiarMakes.includes(key) ? 0 : 1;
  return (
    group(first) - group(second) ||
    (group(first) === 0
      ? familiarMakes.indexOf(first) - familiarMakes.indexOf(second)
      : a.localeCompare(b))
  );
}
function makeLogo(make: string) {
  const file = logoFile(make);
  if (file)
    return (
      <img
        src={`/vehicle-logos/${file}?v=emblem-4`}
        alt=""
        width={20}
        height={20}
        className="size-5 shrink-0 object-contain grayscale dark:invert"
      />
    );
  return <CarFront className="size-4 shrink-0" aria-hidden="true" />;
}

import { Field, FieldLabel } from "@claritylabs-inc/ui/components/field";
import { Input } from "@claritylabs-inc/ui/components/input";
import { SearchableSelect } from "@claritylabs-inc/ui/components/searchable-select";
import { typeStyle } from "@/lib/typography";

type Vehicle = { year: string; make: string; model: string; vin: string };
const catalog = new Map<string, Promise<string[]>>();
function optionsFor(query: string) {
  if (!catalog.has(query))
    catalog.set(
      query,
      fetch(`/api/vehicle-catalog${query}`)
        .then(async (response) => {
          if (!response.ok) throw new Error("Catalog unavailable");
          const data = (await response.json()) as { options: string[] };
          return data.options;
        })
        .catch(() => {
          catalog.delete(query);
          return [];
        }),
    );
  return catalog.get(query)!;
}
export function IntakeVehicleFields({
  vehicle,
  id,
  onChange,
}: {
  vehicle: Vehicle;
  id: string;
  onChange: (vehicle: Vehicle) => void;
}) {
  const inline = useContext(InlineFieldsContext);
  const VehicleField = inline ? InlineFieldRow : Field;
  const [makes, setMakes] = useState<string[]>([]);
  const [models, setModels] = useState<{ query: string; values: string[] }>();
  const [otherMake, setOtherMake] = useState(false);
  const [otherModel, setOtherModel] = useState(false);
  const [loadingMakes, setLoadingMakes] = useState(true);
  const modelQuery = vehicle.make
    ? `?make=${encodeURIComponent(vehicle.make)}${/^\d{4}$/.test(vehicle.year) ? `&year=${vehicle.year}` : ""}`
    : "";
  useEffect(() => {
    let active = true;
    void optionsFor("").then((values) => {
      if (active) {
        setMakes(values);
        setLoadingMakes(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!modelQuery || otherMake) return;
    let active = true;
    void optionsFor(modelQuery).then((values) => {
      if (active) setModels({ query: modelQuery, values });
    });
    return () => {
      active = false;
    };
  }, [modelQuery, otherMake]);
  const makeOptions = [
    ...new Set([...makes, ...(vehicle.make ? [vehicle.make] : [])]),
  ]
    .sort(compareMakes)
    .map((value, index, sorted) => ({
      value,
      label: vehicleMakeLabel(value),
      icon: makeLogo(value),
      separatorBefore:
        index > 0 && hasMakeLogo(sorted[index - 1]) && !hasMakeLogo(value),
    }));
  const modelOptions = [
    ...new Set([
      ...(models?.query === modelQuery ? models.values : []),
      ...(vehicle.model ? [vehicle.model] : []),
    ]),
  ].map((value) => ({
    value,
    label: value,
    icon: makeLogo(vehicle.make),
  }));
  return (
    <>
      <VehicleField label={inline ? "Vehicle year" : undefined}>
        <FieldLabel
          htmlFor={`${id}-year`}
          className={inline ? "sr-only" : typeStyle("body.root")}
        >
          Year
        </FieldLabel>
        <Input
          id={`${id}-year`}
          className={`h-12 ${typeStyle("body.root")}`}
          placeholder="Enter vehicle year"
          aria-invalid={!!vehicle.year && !/^\d{4}$/.test(vehicle.year)}
          inputMode="numeric"
          maxLength={4}
          value={vehicle.year}
          onChange={(event) =>
            onChange({
              ...vehicle,
              year: event.target.value.replace(/\D/g, "").slice(0, 4),
              model: "",
            })
          }
        />
      </VehicleField>
      {(["make", "model"] as const).map((key) => {
        const manual = key === "make" ? otherMake : otherModel;
        return (
          <VehicleField
            key={key}
            label={
              inline
                ? key === "make"
                  ? "Vehicle make"
                  : "Vehicle model"
                : undefined
            }
          >
            <FieldLabel
              htmlFor={manual ? `${id}-${key}` : undefined}
              className={
                inline
                  ? "sr-only"
                  : `flex items-center gap-2 ${typeStyle("body.root")}`
              }
            >
              {key === "make" ? "Make" : "Model"}
            </FieldLabel>
            <div className="[&_button]:min-h-12">
              <SearchableSelect
                ariaLabel={`Vehicle ${key}`}
                options={[
                  ...(key === "make" ? makeOptions : modelOptions),
                  {
                    value: "__other__",
                    label: "Other / enter manually",
                    icon: (
                      <CarFront
                        className="size-4 shrink-0"
                        aria-hidden="true"
                      />
                    ),
                  },
                ]}
                value={manual ? "__other__" : vehicle[key]}
                disabled={key === "model" && !vehicle.make}
                placeholder={
                  key === "make"
                    ? loadingMakes
                      ? "Loading makes…"
                      : "Choose a make"
                    : !vehicle.make
                      ? "Choose a make first"
                      : models?.query !== modelQuery && !otherMake
                        ? "Loading models…"
                        : "Choose a model"
                }
                onChange={(value) => {
                  if (key === "make") {
                    setOtherMake(value === "__other__");
                    setOtherModel(false);
                    onChange({
                      ...vehicle,
                      make: value === "__other__" ? "" : value,
                      model: "",
                    });
                  } else {
                    setOtherModel(value === "__other__");
                    onChange({
                      ...vehicle,
                      model: value === "__other__" ? "" : value,
                    });
                  }
                }}
              />
            </div>
            {manual && (
              <Input
                id={`${id}-${key}`}
                className={`h-12 ${typeStyle("body.root")}`}
                placeholder={`Enter vehicle ${key}`}
                value={vehicle[key]}
                onChange={(event) =>
                  onChange({
                    ...vehicle,
                    [key]: event.target.value,
                    ...(key === "make" ? { model: "" } : {}),
                  })
                }
              />
            )}
          </VehicleField>
        );
      })}
      <VehicleField label={inline ? "VIN" : undefined}>
        <FieldLabel
          htmlFor={`${id}-vin`}
          className={inline ? "sr-only" : typeStyle("body.root")}
        >
          VIN (optional)
        </FieldLabel>
        <Input
          id={`${id}-vin`}
          className={`h-12 ${typeStyle("body.root")}`}
          placeholder="Enter vehicle VIN"
          value={vehicle.vin}
          maxLength={17}
          onChange={(event) =>
            onChange({
              ...vehicle,
              vin: event.target.value
                .toUpperCase()
                .replace(/[^A-HJ-NPR-Z0-9]/g, "")
                .slice(0, 17),
            })
          }
        />
      </VehicleField>
    </>
  );
}
