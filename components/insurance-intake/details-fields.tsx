"use client";
import dayjs from "dayjs";
import {
  DateField,
  parseDateText,
} from "@claritylabs-inc/ui/components/date-field";
import { useRef, type ReactNode } from "react";
import {
  FiShield,
  FiHome,
  FiUsers,
  FiTruck,
  FiBriefcase,
  FiLock,
  FiUmbrella,
} from "react-icons/fi";

// Match the public site's InsuranceCoverageIcon coverage mapping.
const coverageIcons = {
  general_liability: FiShield,
  property: FiHome,
  workers_compensation: FiUsers,
  commercial_auto: FiTruck,
  professional_liability: FiBriefcase,
  cyber: FiLock,
  umbrella: FiUmbrella,
};
import {
  Field,
  FieldLabel,
  FieldGroup,
  FieldDescription,
  FieldTitle,
} from "@claritylabs-inc/ui/components/field";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Radio } from "@base-ui/react/radio";
import { Button } from "@claritylabs-inc/ui/components/button";
import { Checkbox } from "@claritylabs-inc/ui/components/checkbox";
import { Input } from "@claritylabs-inc/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@claritylabs-inc/ui/components/input-group";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@claritylabs-inc/ui/components/select";
import { Card, CardContent } from "@claritylabs-inc/ui/components/card";
import { PillButton } from "@/components/ui/pill-button";
import { SearchableSelect } from "@claritylabs-inc/ui/components/searchable-select";
import {
  AddressAutofillInput,
  US_STATE_ABBREVIATIONS,
} from "@/components/ui/address-autofill-input";
import {
  COVERAGE_OPTIONS,
  UNKNOWN_ANSWER,
  coverageOption,
  newCoverage,
  type CoverageId,
  type IntakeDetails,
} from "@/lib/insurance-intake-details";
import { typeStyle } from "@/lib/typography";
import { Plus, Trash2 } from "lucide-react";

type Props = {
  details: IntakeDetails;
  onChange: (details: IntakeDetails) => void;
  disabled?: boolean;
};
function Choice({
  id,
  label,
  value,
  choices,
  onChange,
  disabled = false,
  optionIcon,
}: {
  id: string;
  label: string;
  value: string;
  choices: readonly string[];
  onChange: (value: string) => void;
  disabled?: boolean;
  optionIcon?: (value: string) => ReactNode;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id} className={typeStyle("body.root")}>
        {label}
      </FieldLabel>
      {choices.length < 4 ? (
        <IntakeRadioChoices
          label={label}
          choices={choices}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      ) : choices.length > 10 ? (
        <div
          className={`[&_button]:min-h-12 ${typeStyle("body.root")
            .split(" ")
            .map((token) => `[&_button]:${token}`)
            .join(" ")}`}
        >
          <SearchableSelect
            ariaLabel={label}
            value={value}
            options={choices.map((choice) => ({
              value: choice,
              label: choice,
              icon: optionIcon?.(choice),
            }))}
            onChange={onChange}
            disabled={disabled}
            placeholder="Choose an option"
          />
        </div>
      ) : (
        <Select
          value={value || null}
          onValueChange={(value) => onChange(value ?? "")}
          disabled={disabled}
        >
          <SelectTrigger id={id} className="min-h-12 w-full">
            <SelectValue>{value || "Choose an option"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {choices.map((choice) => (
              <SelectItem key={choice} value={choice}>
                {choice}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}
export function IntakeRadioChoices({
  label,
  choices,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  choices: readonly string[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <RadioGroup
      aria-label={label}
      value={value || null}
      onValueChange={(next) => onChange(next ?? "")}
      disabled={disabled}
      className="grid gap-3"
    >
      {choices.map((choice) => (
        <Radio.Root
          key={choice}
          value={choice}
          nativeButton
          render={<Button variant={value === choice ? "default" : "outline"} />}
          className={`min-h-16 w-full justify-center px-5 py-4 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground ${typeStyle("body.root")}`}
        >
          {choice}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
export function IntakeCheckboxCard({
  id,
  label,
  checked,
  icon,
  onCheckedChange,
  disabled = false,
  className = "",
}: {
  id: string;
  label: string;
  checked: boolean;
  icon?: ReactNode;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <FieldLabel
      htmlFor={id}
      className={`cursor-pointer rounded-lg border border-border bg-card p-0 [&>[data-slot=field]]:px-4 [&>[data-slot=field]]:py-3 transition-colors hover:bg-accent/50 has-data-checked:border-primary/40 has-data-checked:bg-primary/5 ${className}`}
    >
      <Field orientation="horizontal" className="gap-4">
        <Checkbox
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(checked) => onCheckedChange(checked === true)}
        />
        {icon}
        <FieldTitle className={typeStyle("body.root")}>{label}</FieldTitle>
      </Field>
    </FieldLabel>
  );
}
export function IntakeCoverageSelection({
  details,
  onChange,
  disabled = false,
}: Props) {
  function toggle(id: CoverageId) {
    const current = details.coverages;
    const next =
      id === "unknown"
        ? current.some((line) => line.coverage === "unknown")
          ? []
          : [newCoverage("unknown")]
        : current.some((line) => line.coverage === id)
          ? current.filter((line) => line.coverage !== id)
          : [
              ...current.filter((line) => line.coverage !== "unknown"),
              newCoverage(id),
            ];
    onChange({
      ...details,
      coverages: next,
      coverageIndex: 0,
    });
  }
  return (
    <FieldGroup>
      <FieldLabel className={typeStyle("body.root")}>
        Select all that you need
      </FieldLabel>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {[
          ...COVERAGE_OPTIONS.filter((option) => option.id !== "unknown"),
          COVERAGE_OPTIONS[0],
        ].map((option) => (
          <IntakeCheckboxCard
            key={option.id}
            id={`coverage-${option.id}`}
            label={option.label}
            icon={(() => {
              const Icon =
                coverageIcons[option.id as keyof typeof coverageIcons];
              return Icon ? (
                <Icon
                  aria-hidden="true"
                  className="size-5 shrink-0 text-muted-foreground"
                />
              ) : undefined;
            })()}
            checked={details.coverages.some(
              (line) => line.coverage === option.id,
            )}
            disabled={disabled}
            onCheckedChange={() => toggle(option.id)}
            className={option.id === "unknown" ? "sm:col-span-2" : ""}
          />
        ))}
      </div>
    </FieldGroup>
  );
}
export function IntakeCoverageLimits({
  details,
  onChange,
  disabled = false,
}: Props) {
  const previousLimits = useRef<Record<string, string>>({});
  const line = details.coverages[details.coverageIndex] ?? details.coverages[0];
  const option = coverageOption(line?.coverage ?? "unknown");
  function setLimit(key: string, value: string) {
    onChange({
      ...details,
      coverages: details.coverages.map((item) =>
        item.coverage === line.coverage
          ? { ...item, limits: { ...item.limits, [key]: value } }
          : item,
      ),
    });
  }
  return (
    <FieldGroup>
      {option.limits.length ? (
        option.limits.map((limit) => {
          const value = line.limits[limit.key] ?? "";
          const unknown = value === UNKNOWN_ANSWER;
          const monetary = !["statutory", "coverage_description"].includes(
            limit.key,
          );
          return (
            <Field key={limit.key}>
              <FieldLabel
                htmlFor={`limit-${line.coverage}-${limit.key}`}
                className={typeStyle("body.root")}
              >
                {limit.label}
              </FieldLabel>
              {limit.key === "products_aggregate" && <FieldDescription>
                The total limit for covered injury or property-damage claims caused by products you sell or work you have completed during the policy period.
              </FieldDescription>}
              <InputGroup
                className={`min-h-12 h-auto ${typeStyle("body.root")} ${unknown ? "bg-primary/10 border-primary" : ""}`}
              >
                {!unknown && monetary && (
                  <InputGroupAddon>
                    <InputGroupText>$</InputGroupText>
                  </InputGroupAddon>
                )}
                {!unknown && (
                  <InputGroupInput
                    id={`limit-${line.coverage}-${limit.key}`}
                    aria-label={`${limit.label}${monetary ? " amount" : ""}`}
                    className="min-w-0 h-12"
                    inputMode={monetary ? "decimal" : "text"}
                    value={monetary ? value.replace(/^\s*\$\s*/, "") : value}
                    placeholder={
                      monetary
                        ? "Enter amount"
                        : limit.key === "statutory"
                          ? "Enter statutory coverage requirements"
                          : "Describe the coverage"
                    }
                    readOnly={disabled}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (!monetary || /^[\d,]*(?:\.\d{0,2})?$/.test(next))
                        setLimit(limit.key, next);
                    }}
                    onBlur={() => {
                      const amount = Number(value.replace(/[,$\s]/g, ""));
                      if (monetary && value.trim() && Number.isFinite(amount))
                        setLimit(
                          limit.key,
                          amount.toLocaleString("en-US", {
                            maximumFractionDigits: 2,
                          }),
                        );
                    }}
                  />
                )}
                <InputGroupAddon
                  align="inline-end"
                  className={`shrink-0 pr-4 ${unknown ? "w-full justify-start px-3" : ""}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  <label
                    className={`flex min-h-10 items-center gap-2 cursor-pointer whitespace-nowrap ${typeStyle("body.default")}`}
                  >
                    <Checkbox
                      id={`limit-${line.coverage}-${limit.key}-unknown`}
                      aria-label={`${limit.label}: ${UNKNOWN_ANSWER}`}
                      checked={unknown}
                      disabled={disabled}
                      onCheckedChange={(checked) => {
                        const savedKey = `${line.coverage}:${limit.key}`;
                        if (checked) previousLimits.current[savedKey] = value;
                        setLimit(
                          limit.key,
                          checked
                            ? UNKNOWN_ANSWER
                            : (previousLimits.current[savedKey] ?? ""),
                        );
                      }}
                    />
                    {UNKNOWN_ANSWER}
                  </label>
                </InputGroupAddon>
              </InputGroup>
            </Field>
          );
        })
      ) : (
        <p className={typeStyle("body.root")}>{UNKNOWN_ANSWER}</p>
      )}
      {details.limitsNote ? (
        <Field>
          <FieldLabel htmlFor="legacy-limits">
            Previous limit details
          </FieldLabel>
          <Textarea
            placeholder="Add limit details"
            id="legacy-limits"
            value={details.limitsNote}
            onChange={(event) =>
              onChange({ ...details, limitsNote: event.target.value })
            }
            disabled={disabled}
          />
        </Field>
      ) : null}
    </FieldGroup>
  );
}
export function IntakeDateFields({
  details,
  onChange,
  disabled = false,
}: Props) {
  const parts = details.dateParts;
  const value =
    parts.year && parts.month && parts.day
      ? `${parts.year}-${parts.month}-${parts.day}`
      : "";
  return (
    <DateField
      hideLabel
      id="effective-date"
      label="Desired effective date"
      value={value}
      inputValue={details.dateInput}
      onInputChange={(text) => {
        const parsed = parseDateText(text);
        const date = parsed ? dayjs(parsed) : null;
        onChange({
          ...details,
          dateInput: text,
          dateParts: {
            year: date ? date.format("YYYY") : "",
            month: date ? date.format("MM") : "",
            day: date ? date.format("DD") : "",
          },
        });
      }}
      disabled={disabled}
      onChange={(value) => {
        const date = value ? dayjs(value) : null;
        onChange({
          ...details,
          dateInput: date ? date.format("MM/DD/YYYY") : "",
          dateParts: {
            year: date ? date.format("YYYY") : "",
            month: date ? date.format("MM") : "",
            day: date ? date.format("DD") : "",
          },
        });
      }}
    />
  );
}

export function IntakeMailingAddress({
  details,
  onChange,
  disabled = false,
}: Props) {
  if (!details.mailingAddressStep)
    return (
      <IntakeRadioChoices
        label="Is your registered business address also your mailing address?"
        choices={["Yes", "No"]}
        value={
          details.mailingSameAsRegistered === "yes"
            ? "Yes"
            : details.mailingSameAsRegistered === "no"
              ? "No"
              : ""
        }
        disabled={disabled}
        onChange={(value) =>
          onChange({
            ...details,
            mailingSameAsRegistered: value === "Yes" ? "yes" : "no",
            mailingAddressStep: false,
            mailingAddress:
              value === "Yes"
                ? (details.registrationAddress ?? {})
                : details.mailingSameAsRegistered === "no"
                  ? details.mailingAddress
                  : {},
          })
        }
      />
    );
  return (
    <Field>
      <FieldLabel htmlFor="mailing-address" className="sr-only">
        Mailing address
      </FieldLabel>
      <AddressAutofillInput
        showMap
        id="mailing-address"
        className={`h-12 ${typeStyle("body.root")}`}
        value={details.mailingAddress}
        onChange={(address) =>
          onChange({ ...details, mailingAddress: address })
        }
        disabled={disabled}
      />
    </Field>
  );
}
export function IntakeLocations({
  details,
  onChange,
  disabled = false,
}: Props) {
  return (
    <FieldGroup>
      {details.locations.map((location, index) => (
        <Card key={index}>
          <CardContent className="space-y-5">
            <Field>
              <FieldLabel
                htmlFor={`location-${index}`}
                className={typeStyle("body.root")}
              >
                Location {index + 1} address
              </FieldLabel>
              <AddressAutofillInput
                id={`location-${index}`}
                className={`h-12 ${typeStyle("body.root")}`}
                value={location.address}
                disabled={disabled}
                onChange={(address) =>
                  onChange({
                    ...details,
                    locations: details.locations.map((row, i) =>
                      i === index ? { ...row, address } : row,
                    ),
                  })
                }
              />
            </Field>
            <Field>
              <FieldLabel
                htmlFor={`location-details-${index}`}
                className={typeStyle("body.root")}
              >
                Activities, owned / leased status, and staff
              </FieldLabel>
              <Textarea
                placeholder="Describe activities, ownership, and staffing"
                id={`location-details-${index}`}
                value={location.details}
                readOnly={disabled}
                onChange={(event) =>
                  onChange({
                    ...details,
                    locations: details.locations.map((row, i) =>
                      i === index
                        ? { ...row, details: event.target.value }
                        : row,
                    ),
                  })
                }
              />
            </Field>
            <PillButton
              variant="destructive"
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...details,
                  locations: details.locations.filter((_, i) => i !== index),
                })
              }
            >
              <Trash2 className="size-4" />
              Remove location
            </PillButton>
          </CardContent>
        </Card>
      ))}
      <PillButton
        variant="secondary"
        disabled={disabled || details.locations.length >= 30}
        onClick={() =>
          onChange({
            ...details,
            locations: [...details.locations, { address: {}, details: "" }],
          })
        }
      >
        <Plus className="size-4" />
        Add location
      </PillButton>
    </FieldGroup>
  );
}
/** Restores the repeatable add/remove editor from c037d313^ organization-section. */
export function IntakeRelatedEntities({
  details,
  onChange,
  disabled = false,
}: Props) {
  const choice =
    details.hasRelatedEntities ||
    (details.relatedEntities.length ||
    (details.relatedEntitiesNote.trim() &&
      !/^(no|none)$/i.test(details.relatedEntitiesNote.trim()))
      ? "yes"
      : /^(no|none)$/i.test(details.relatedEntitiesNote.trim())
        ? "no"
        : "");
  return (
    <FieldGroup>
      <IntakeRadioChoices
        label="Are there related companies we should know about?"
        value={choice === "yes" ? "Yes" : choice === "no" ? "No" : ""}
        choices={["Yes", "No"]}
        disabled={disabled}
        onChange={(value) =>
          onChange({
            ...details,
            hasRelatedEntities: value === "Yes" ? "yes" : "no",
            relatedEntities:
              value === "Yes" && !details.relatedEntities.length
                ? [{ legalName: "", relationship: "", insured: "" }]
                : details.relatedEntities,
          })
        }
      />
      {choice === "yes" && (
        <>
          {details.relatedEntitiesNote && (
            <Field>
              <FieldLabel
                htmlFor="related-entity-note"
                className={typeStyle("body.root")}
              >
                Existing related-entity notes
              </FieldLabel>
              <Textarea
                id="related-entity-note"
                placeholder="Add related company details"
                value={details.relatedEntitiesNote}
                readOnly={disabled}
                onChange={(event) =>
                  onChange({
                    ...details,
                    relatedEntitiesNote: event.target.value,
                  })
                }
              />
            </Field>
          )}
          {details.relatedEntities.map((entity, index) => {
            const update = (patch: Partial<typeof entity>) =>
              onChange({
                ...details,
                relatedEntities: details.relatedEntities.map((row, i) =>
                  i === index ? { ...row, ...patch } : row,
                ),
              });
            return (
              <Card key={index}>
                <CardContent className="space-y-5">
                  <Field>
                    <FieldLabel
                      htmlFor={`entity-name-${index}`}
                      className={typeStyle("body.root")}
                    >
                      Legal name
                    </FieldLabel>
                    <Input
                      placeholder="Enter the company’s legal name"
                      id={`entity-name-${index}`}
                      className={`h-12 ${typeStyle("body.root")}`}
                      value={entity.legalName}
                      readOnly={disabled}
                      onChange={(event) =>
                        update({ legalName: event.target.value })
                      }
                    />
                  </Field>
                  <Choice
                    id={`entity-relation-${index}`}
                    label="Relationship"
                    value={entity.relationship}
                    choices={[
                      UNKNOWN_ANSWER,
                      "Parent",
                      "Subsidiary",
                      "Affiliate",
                      "Operating company",
                      "Property company",
                      "DBA / trading name",
                      "Former name",
                      "Other",
                    ]}
                    disabled={disabled}
                    onChange={(relationship) => update({ relationship })}
                  />
                  <Choice
                    id={`entity-scope-${index}`}
                    label="Should this entity be insured?"
                    value={
                      entity.insured === "include"
                        ? "Include"
                        : entity.insured === "exclude"
                          ? "Exclude"
                          : entity.insured === "unsure"
                            ? UNKNOWN_ANSWER
                            : ""
                    }
                    choices={[UNKNOWN_ANSWER, "Include", "Exclude"]}
                    disabled={disabled}
                    onChange={(choice) =>
                      update({
                        insured:
                          choice === "Include"
                            ? "include"
                            : choice === "Exclude"
                              ? "exclude"
                              : "unsure",
                      })
                    }
                  />
                  <PillButton
                    variant="destructive"
                    disabled={disabled}
                    onClick={() =>
                      onChange({
                        ...details,
                        relatedEntities: details.relatedEntities.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    <Trash2 className="size-4" />
                    Remove entity
                  </PillButton>
                </CardContent>
              </Card>
            );
          })}
          <Button
            variant="outline"
            className={`min-h-16 w-full rounded-lg ${typeStyle("body.root")}`}
            disabled={disabled || details.relatedEntities.length >= 30}
            onClick={() =>
              onChange({
                ...details,
                relatedEntities: [
                  ...details.relatedEntities,
                  {
                    legalName: "",
                    relationship: "",
                    insured: "",
                  },
                ],
              })
            }
          >
            <Plus className="size-4" />
            Add entity
          </Button>
        </>
      )}
    </FieldGroup>
  );
}

const additionalExamples: Partial<Record<CoverageId, string>> = {
  property: "flood or earthquake",
  commercial_auto: "hired or non-owned auto",
  general_liability: "umbrella or excess liability",
  professional_liability: "cyber liability",
  cyber: "social engineering or contingent business interruption",
  workers_compensation: "commercial auto or general liability",
  umbrella: "additional underlying liability coverage",
};
export function IntakeAdditionalCoverages({ details, onChange }: Props) {
  return (
    <FieldGroup>
      {!!details.additionalNote && (
        <Textarea
          aria-label="Previous additional coverage details"
          placeholder="Previous additional coverage details"
          value={details.additionalNote}
          onChange={(event) =>
            onChange({ ...details, additionalNote: event.target.value })
          }
        />
      )}
      {details.coverages.map((line, index) => (
        <Field key={line.coverage}>
          <FieldLabel
            htmlFor={`additional-${line.coverage}`}
            className={details.coverages.length === 1 ? "sr-only" : undefined}
          >
            {coverageOption(line.coverage).label}
          </FieldLabel>
          <Textarea
            id={`additional-${line.coverage}`}
            value={line.additionalCoverages ?? ""}
            placeholder={`List any additional coverages${additionalExamples[line.coverage] ? `, such as ${additionalExamples[line.coverage]}` : " you might need"}`}
            onChange={(event) =>
              onChange({
                ...details,
                coverages: details.coverages.map((row, i) =>
                  i === index
                    ? { ...row, additionalCoverages: event.target.value }
                    : row,
                ),
              })
            }
          />
        </Field>
      ))}
    </FieldGroup>
  );
}
export function IntakeCoverageScope({ details, onChange }: Props) {
  return (
    <FieldGroup>
      {!!details.scopeNote && (
        <Textarea
          aria-label="Previous scope details"
          placeholder="Previous scope details"
          value={details.scopeNote}
          onChange={(event) =>
            onChange({ ...details, scopeNote: event.target.value })
          }
        />
      )}
      {details.coverages.map((line, index) => {
        const update = (patch: Partial<typeof line>) =>
          onChange({
            ...details,
            coverages: details.coverages.map((row, i) =>
              i === index ? { ...row, ...patch } : row,
            ),
          });
        if (
          !["property", "commercial_auto", "other", "unknown"].includes(
            line.coverage,
          )
        )
          return null;
        return (
          <div key={line.coverage} className="space-y-4">
            <h2 className={`text-wrap-pretty ${typeStyle("heading.section")}`}>
              {coverageOption(line.coverage).label}
            </h2>
            {line.coverage === "property" ? (
              <IntakeLocations
                details={{ ...details, locations: line.properties ?? [] }}
                onChange={(next) => update({ properties: next.locations })}
              />
            ) : line.coverage === "commercial_auto" ? (
              <FieldGroup>
                {(line.vehicles ?? []).map((vehicle, vehicleIndex) => (
                  <Card key={vehicleIndex}>
                    <CardContent className="space-y-4">
                      {(["year", "make", "model", "vin"] as const).map(
                        (key) => (
                          <Field key={key}>
                            <FieldLabel
                              htmlFor={`vehicle-${index}-${vehicleIndex}-${key}`}
                            >
                              {key === "vin"
                                ? "VIN"
                                : key[0].toUpperCase() + key.slice(1)}
                            </FieldLabel>
                            <Input
                              id={`vehicle-${index}-${vehicleIndex}-${key}`}
                              placeholder={`Enter vehicle ${key}`}
                              aria-invalid={
                                key === "vin"
                                  ? !!vehicle.vin &&
                                    !/^[A-HJ-NPR-Z0-9]{17}$/i.test(vehicle.vin)
                                  : key === "year"
                                    ? !!vehicle.year &&
                                      !/^\d{4}$/.test(vehicle.year)
                                    : undefined
                              }
                              maxLength={
                                key === "vin"
                                  ? 17
                                  : key === "year"
                                    ? 4
                                    : undefined
                              }
                              value={vehicle[key]}
                              onChange={(event) =>
                                update({
                                  vehicles: line.vehicles!.map((row, i) =>
                                    i === vehicleIndex
                                      ? {
                                          ...row,
                                          [key]:
                                            key === "year"
                                              ? event.target.value
                                                  .replace(/\D/g, "")
                                                  .slice(0, 4)
                                              : key === "vin"
                                                ? event.target.value
                                                    .toUpperCase()
                                                    .replace(
                                                      /[^A-HJ-NPR-Z0-9]/g,
                                                      "",
                                                    )
                                                    .slice(0, 17)
                                                : event.target.value,
                                        }
                                      : row,
                                  ),
                                })
                              }
                            />
                          </Field>
                        ),
                      )}
                      <PillButton
                        variant="destructive"
                        onClick={() =>
                          update({
                            vehicles: line.vehicles!.filter(
                              (_, i) => i !== vehicleIndex,
                            ),
                          })
                        }
                      >
                        Remove vehicle
                      </PillButton>
                    </CardContent>
                  </Card>
                ))}
                <PillButton
                  variant="secondary"
                  disabled={(line.vehicles?.length ?? 0) >= 30}
                  onClick={() =>
                    update({
                      vehicles: [
                        ...(line.vehicles ?? []),
                        { year: "", make: "", model: "", vin: "" },
                      ],
                    })
                  }
                >
                  <Plus />
                  Add vehicle
                </PillButton>
              </FieldGroup>
            ) : (
              <Textarea
                aria-label={`What to insure for ${coverageOption(line.coverage).label}`}
                placeholder="Describe what you are looking to get insured"
                value={line.scopeDescription ?? ""}
                onChange={(event) =>
                  update({ scopeDescription: event.target.value })
                }
              />
            )}
          </div>
        );
      })}
    </FieldGroup>
  );
}

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
export function IntakeRegistration({ details, onChange }: Props) {
  return (
    <Field>
      <FieldLabel
        htmlFor="registration-address"
        className={typeStyle("body.root")}
      >
        Registered business address
      </FieldLabel>
      <AddressAutofillInput
        id="registration-address"
        className={`h-12 ${typeStyle("body.root")}`}
        value={details.registrationAddress ?? {}}
        showMap
        onChange={(address) => {
          const country = address.country
            ? /^[A-Za-z]{2}$/.test(address.country)
              ? countryNames.of(address.country.toUpperCase()) ||
                address.country
              : address.country
            : "";
          const stateName = Object.entries(US_STATE_ABBREVIATIONS).find(
            ([, code]) => code === address.state,
          )?.[0];
          onChange({
            ...details,
            registrationAddress: address,
            registrationCountry: country,
            registrationState: stateName
              ? stateName.replace(/\b\w/g, (letter) => letter.toUpperCase())
              : address.state || "",
            ...(details.mailingSameAsRegistered === "yes"
              ? { mailingAddress: address }
              : {}),
          });
        }}
      />
    </Field>
  );
}
