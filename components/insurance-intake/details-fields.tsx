"use client";
import { IntakeUnknownRow } from "./unknown-choice";
import { IntakeRadioChoices } from "./radio-choices";
export { IntakeRadioChoices } from "./radio-choices";
import { RemoveButton } from "@/components/ui/remove-button";
import {
  InlineFieldCard,
  InlineFieldRow,
  InlineFieldsContext,
  InlineCollectionActionsContext,
} from "@/components/ui/inline-fields";
import { X } from "lucide-react";
import dayjs from "dayjs";
import { IntakeVehicleUnderwritingFields } from "./vehicle-underwriting-fields";
import { vehicleUnderwritingValues } from "@/lib/intake-vehicle-underwriting";
import { IntakeVehicleFields } from "./vehicle-fields";
import {
  DateField,
  parseDateText,
} from "@claritylabs-inc/ui/components/date-field";
import { useState, useContext, type ReactNode } from "react";
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
import { NumberField } from "@base-ui/react/number-field";
import { GroupedNumberInput } from "@/components/ui/grouped-number-input";
import { Button } from "@claritylabs-inc/ui/components/button";
import { Checkbox } from "@claritylabs-inc/ui/components/checkbox";
import { Input } from "@claritylabs-inc/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupButton,
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
  coverageRequestLabel,
  UNKNOWN_ANSWER,
  coverageOption,
  newCoverage,
  type CoverageId,
  type IntakeDetails,
} from "@/lib/insurance-intake-details";
import { typeStyle } from "@/lib/typography";
import { Plus, ChevronDown, ChevronUp, CircleHelp } from "lucide-react";

function formatDollarInput(value: string) {
  const [whole, fraction] = value.replace(/[,$\s]/g, "").split(".");
  return (
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
    (fraction !== undefined ? `.${fraction}` : "")
  );
}

export function IntakeValueInput({
  id,
  label,
  value,
  placeholder,
  monetary = true,
  disabled = false,
  onValueChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  monetary?: boolean;
  disabled?: boolean;
  onValueChange: (value: string) => void;
}) {
  return (
    <InputGroupInput
      id={id}
      aria-label={label}
      className="min-w-0 h-12"
      inputMode={monetary ? "decimal" : "text"}
      value={monetary ? formatDollarInput(value) : value}
      placeholder={placeholder}
      readOnly={disabled}
      onChange={(event) => {
        const input = event.currentTarget;
        const next = input.value;
        if (!monetary) {
          onValueChange(next);
          return;
        }
        if (!/^[\d,]*(?:\.\d{0,2})?$/.test(next)) return;
        let raw = next.replace(/,/g, "");
        let position = next
          .slice(0, input.selectionStart ?? next.length)
          .replace(/,/g, "").length;
        const previous = formatDollarInput(value);
        const inputType = (event.nativeEvent as InputEvent).inputType;
        // Deleting a separator should remove the adjacent digit, not trap the caret.
        if (
          raw === previous.replace(/,/g, "") &&
          next.length < previous.length
        ) {
          if (inputType === "deleteContentBackward" && position > 0) {
            raw = raw.slice(0, position - 1) + raw.slice(position);
            position--;
          } else if (inputType === "deleteContentForward") {
            raw = raw.slice(0, position) + raw.slice(position + 1);
          }
        }
        const formatted = formatDollarInput(raw);
        onValueChange(formatted);
        let caret = 0;
        let characters = 0;
        while (caret < formatted.length && characters < position) {
          if (formatted[caret] !== ",") characters++;
          caret++;
        }
        requestAnimationFrame(() => {
          if (document.activeElement === input)
            input.setSelectionRange(caret, caret);
        });
      }}
      onBlur={() => {
        const amount = Number(value.replace(/[,$\s]/g, ""));
        if (monetary && value.trim() && Number.isFinite(amount))
          onValueChange(
            amount.toLocaleString("en-US", {
              maximumFractionDigits: 2,
            }),
          );
      }}
    />
  );
}

export function IntakeRevenueFields({ details, onChange }: Props) {
  const inline = useContext(InlineFieldsContext);
  const projected = details.revenueStep === "projected";
  const revenue = details.revenue ?? {
    annualPeriod: "",
    annualAmount: "",
    projectedPeriod: "",
    projectedAmount: "",
  };
  const periodKey = projected ? "projectedPeriod" : "annualPeriod";
  const amountKey = projected ? "projectedAmount" : "annualAmount";
  const year = dayjs().year();
  const fiscalPeriod = projected
    ? `This fiscal year (${year})`
    : `Last fiscal year (${year - 1})`;
  const periods = projected
    ? ["Next 12 months", fiscalPeriod]
    : ["Trailing 12 months", fiscalPeriod];
  const legacyFiscalPeriod = projected
    ? /^(?:Next|Current|This) fiscal year(?: \(\d{4}\))?$/.test(
        revenue[periodKey],
      ) && !revenue[periodKey].startsWith("This fiscal year (")
    : revenue[periodKey] === "Last fiscal year";
  const selectedPeriod = legacyFiscalPeriod ? fiscalPeriod : revenue[periodKey];
  const label = projected ? "Projected annual revenue" : "Annual revenue";
  if (inline)
    return (
      <>
        <InlineFieldRow label={`${label} reporting period`}>
          <Select
            value={selectedPeriod || null}
            onValueChange={(value) =>
              onChange({
                ...details,
                revenue: { ...revenue, [periodKey]: value ?? "" },
              })
            }
          >
            <SelectTrigger
              aria-label={`${label} reporting period`}
              className="w-full"
            >
              <SelectValue>{selectedPeriod || "Not provided"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {[
                ...new Set([
                  ...periods,
                  ...(selectedPeriod ? [selectedPeriod] : []),
                ]),
              ].map((period) => (
                <SelectItem key={period} value={period}>
                  {period}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </InlineFieldRow>
        <InlineFieldRow label={label}>
          <Input
            aria-label={label}
            inputMode="decimal"
            placeholder="Not provided"
            value={
              revenue[amountKey]
                ? `$ ${formatDollarInput(revenue[amountKey])}`
                : ""
            }
            onChange={(event) =>
              onChange({
                ...details,
                revenue: {
                  ...revenue,
                  [amountKey]: event.target.value.replace(/[^0-9.]/g, ""),
                },
              })
            }
          />
        </InlineFieldRow>
      </>
    );

  return (
    <FieldGroup>
      <Field>
        <FieldLabel className={typeStyle("body.root")}>
          Reporting period
        </FieldLabel>
        <IntakeRadioChoices
          label="Reporting period"
          choices={periods}
          value={selectedPeriod}
          onChange={(value) =>
            onChange({
              ...details,
              revenue: { ...revenue, [periodKey]: value },
            })
          }
        />
      </Field>
      {!!revenue[periodKey] && (
        <Field>
          <FieldLabel
            htmlFor={`intake-revenue-${projected ? "projected" : "annual"}`}
            className="sr-only"
          >
            {label}
          </FieldLabel>
          <InputGroup className={`h-12 ${typeStyle("body.root")}`}>
            <InputGroupAddon>
              <InputGroupText>$</InputGroupText>
            </InputGroupAddon>
            <IntakeValueInput
              id={`intake-revenue-${projected ? "projected" : "annual"}`}
              label={label}
              value={revenue[amountKey]}
              placeholder={
                projected ? "Enter estimated revenue" : "Enter revenue"
              }
              onValueChange={(value) =>
                onChange({
                  ...details,
                  revenue: {
                    ...revenue,
                    [periodKey]: selectedPeriod,
                    [amountKey]: value,
                  },
                })
              }
            />
          </InputGroup>
        </Field>
      )}
    </FieldGroup>
  );
}

export function IntakeCountInput({
  id,
  label,
  value,
  placeholder,
  onChange,
  onBlur,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  return (
    <NumberField.Root
      locale="en-US"
      id={id}
      min={0}
      step={1}
      smallStep={1}
      value={value === "" ? null : Number(value)}
      onValueChange={(next) => onChange(next === null ? "" : String(next))}
      format={{ maximumFractionDigits: 0, useGrouping: true }}
      render={<InputGroup className="h-12" />}
    >
      <GroupedNumberInput
        aria-label={label}
        placeholder={placeholder}
        onBlur={onBlur}
        render={
          <InputGroupInput className={`min-w-0 ${typeStyle("body.root")}`} />
        }
      />
      <InputGroupAddon
        align="inline-end"
        className="flex-col gap-0 py-0 pr-2 opacity-0 pointer-events-none group-focus-within/input-group:opacity-100 group-focus-within/input-group:pointer-events-auto"
      >
        <NumberField.Decrement
          aria-label={`Decrease ${label.toLowerCase()}`}
          render={
            <InputGroupButton
              size="icon-sm"
              variant="ghost"
              className="h-5 w-6 text-muted-foreground"
            />
          }
        >
          <ChevronDown className="size-3.5" />
        </NumberField.Decrement>
        <NumberField.Increment
          className="-order-1"
          aria-label={`Increase ${label.toLowerCase()}`}
          render={
            <InputGroupButton
              size="icon-sm"
              variant="ghost"
              className="h-5 w-6 text-muted-foreground"
            />
          }
        >
          <ChevronUp className="size-3.5" />
        </NumberField.Increment>
      </InputGroupAddon>
    </NumberField.Root>
  );
}

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
      {choices.length < 8 ? (
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
          <SelectTrigger
            id={id}
            className={`min-h-12 w-full ${typeStyle("body.root")}`}
          >
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
      className={`cursor-pointer rounded-lg border border-border bg-card p-0 [&>[data-slot=field]]:px-4 [&>[data-slot=field]]:py-3 transition-colors hover:bg-accent/50 has-data-checked:border-primary has-data-checked:bg-primary/5 ${className}`}
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
  const inlineFields = useContext(InlineFieldsContext);
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
    const declined=new Set(details.declinedRequirementCoverages ?? []);
    if(id==="unknown"){for(const line of current)if(line.coverage!=="unknown")declined.add(line.coverage);}
    else if(current.some(line=>line.coverage===id))declined.add(id);
    else declined.delete(id);
    onChange({
      ...details,
      coverages: next,
      declinedRequirementCoverages:[...declined],
      coverageIndex: 0,
    });
  }
  if (inlineFields)
    return (
      <div className="flex flex-wrap items-center gap-3">
        {details.coverages.map((line) => (
          <span
            key={line.coverage}
            className={`inline-flex items-center gap-2 ${typeStyle("body.default")}`}
          >
            {coverageRequestLabel(line)}
            <button
              type="button"
              aria-label={`Remove ${coverageRequestLabel(line)}`}
              disabled={disabled}
              onClick={() => toggle(line.coverage)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        <Select
          value={null}
          disabled={disabled}
          onValueChange={(next) => {
            if (next) toggle(next as CoverageId);
          }}
        >
          <SelectTrigger aria-label="Add coverage">
            <SelectValue>Add coverage</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {COVERAGE_OPTIONS.filter(
              (option) =>
                !details.coverages.some((line) => line.coverage === option.id),
            ).map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
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
      {details.coverages.some((line) => line.coverage === "other") && (
        <Field>
          <FieldLabel
            htmlFor="other-coverage-type"
            className={typeStyle("body.root")}
          >
            What type of insurance do you need?
          </FieldLabel>
          <Input
            id="other-coverage-type"
            className={`h-12 ${typeStyle("body.root")}`}
            placeholder="Enter the type of insurance"
            disabled={disabled}
            value={
              details.coverages.find((line) => line.coverage === "other")
                ?.limits.coverage_description === UNKNOWN_ANSWER
                ? ""
                : details.coverages.find((line) => line.coverage === "other")
                    ?.limits.coverage_description || ""
            }
            onChange={(event) =>
              onChange({
                ...details,
                coverages: details.coverages.map((line) =>
                  line.coverage === "other"
                    ? {
                        ...line,
                        limits: {
                          ...line.limits,
                          coverage_description: event.target.value,
                        },
                      }
                    : line,
                ),
              })
            }
          />
        </Field>
      )}
    </FieldGroup>
  );
}
export function IntakeCoverageLimits({
  details,
  onChange,
  disabled = false,
}: Props) {
  const inline = useContext(InlineFieldsContext);
  const LimitRow = inline ? InlineFieldRow : Field;
  const [openHelp, setOpenHelp] = useState<Record<string, boolean>>({});
  const help: Record<string, string> = {
    each_occurrence: "The maximum coverage for one covered incident.",
    aggregate:
      "The total limit for covered claims subject to this aggregate during the policy period.",
    building: "The amount of coverage needed for the insured building.",
    contents:
      "The amount of coverage needed for business personal property, such as equipment, furniture, and inventory.",
    business_income:
      "Coverage for lost business income during a covered interruption.",
    statutory:
      "Workers’ compensation benefits required by the applicable jurisdiction.",
    each_accident:
      "The employers’ liability limit for bodily injury arising from one accident.",
    disease_policy:
      "The total employers’ liability limit for bodily injury by disease during the policy period.",
    disease_employee:
      "The employers’ liability limit for bodily injury by disease for one employee.",
    combined_single:
      "One combined bodily-injury and property-damage liability limit for each covered auto accident.",
    physical_damage:
      "The insured value of vehicles requiring physical damage coverage.",
    each_claim: "The maximum coverage for one covered claim.",
    each_incident:
      "The maximum coverage for one covered cyber incident or claim, depending on the policy wording.",
    coverage_description: "Describe the type of insurance you need.",
    policy_limit:
      "The maximum coverage requested for a covered claim, loss, or policy period, as applicable.",
  };
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
  if (inline)
    return (
      <>
        {option.limits
          .filter((limit) => limit.key !== "coverage_description")
          .map((limit) => {
            const value = line.limits[limit.key] ?? "";
            const unknown = value === UNKNOWN_ANSWER;
            const monetary = limit.key !== "statutory";
            return (
              <InlineFieldRow key={limit.key} label={limit.label}>
                <div className="flex min-h-9 items-center gap-3">
                  {!unknown && (
                    <Input
                      aria-label={`${coverageRequestLabel(line)} ${limit.label}`}
                      placeholder="Not provided"
                      disabled={disabled}
                      value={
                        value && monetary
                          ? `$ ${formatDollarInput(value)}`
                          : value
                      }
                      onChange={(event) =>
                        setLimit(
                          limit.key,
                          event.target.value.replace(/[$,]/g, "").trimStart(),
                        )
                      }
                    />
                  )}
                  {(!value.trim() || unknown) && (
                    <label
                      className={`flex h-9 shrink-0 items-center gap-2 px-3 ${typeStyle("body.default")}`}
                    >
                      <Checkbox
                        aria-label={`${coverageRequestLabel(line)} ${limit.label}: ${UNKNOWN_ANSWER}`}
                        checked={unknown}
                        disabled={disabled}
                        onCheckedChange={(checked) =>
                          setLimit(limit.key, checked ? UNKNOWN_ANSWER : "")
                        }
                      />
                      {UNKNOWN_ANSWER}
                    </label>
                  )}
                </div>
              </InlineFieldRow>
            );
          })}
      </>
    );
  return (
    <FieldGroup
      data-intake-coverage-limits
      className={
        inline ? "flex! flex-col! gap-0! divide-y divide-border" : undefined
      }
    >
      {option.limits.length ? (
        option.limits
          .filter((limit) => limit.key !== "coverage_description")
          .map((limit) => {
            const value = line.limits[limit.key] ?? "";
            const unknown = value === UNKNOWN_ANSWER;
            const monetary = !["statutory", "coverage_description"].includes(
              limit.key,
            );
            return (
              <LimitRow
                key={limit.key}
                label={inline ? limit.label : undefined}
              >
                <div className={inline ? "sr-only" : "flex items-center gap-2"}>
                  <FieldLabel
                    htmlFor={`limit-${line.coverage}-${limit.key}`}
                    className={typeStyle("body.root")}
                  >
                    {limit.label}
                  </FieldLabel>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label={`Help with ${limit.label.toLowerCase()}`}
                    aria-expanded={!!openHelp[`${line.coverage}:${limit.key}`]}
                    aria-controls={`limit-help-${line.coverage}-${limit.key}`}
                    onClick={() =>
                      setOpenHelp((current) => ({
                        ...current,
                        [`${line.coverage}:${limit.key}`]:
                          !current[`${line.coverage}:${limit.key}`],
                      }))
                    }
                  >
                    <CircleHelp className="size-4" />
                  </Button>
                </div>
                <IntakeUnknownRow label={limit.label} value={value} disabled={disabled} onChange={next=>setLimit(limit.key,next)}>
                <InputGroup
                  className={`${inline ? "min-h-9 h-9" : "min-h-12 h-auto"} ${typeStyle(inline ? "body.default" : "body.root")} ${unknown ? "bg-primary/5" : ""}`}
                >
                  {!unknown && monetary && (
                    <InputGroupAddon>
                      <InputGroupText>$</InputGroupText>
                    </InputGroupAddon>
                  )}
                  {!unknown && (
                    <IntakeValueInput
                      id={`limit-${line.coverage}-${limit.key}`}
                      label={`${limit.label}${monetary ? " amount" : ""}`}
                      value={value}
                      placeholder={
                        monetary
                          ? "Enter amount"
                          : limit.key === "statutory"
                            ? "Enter statutory coverage requirements"
                            : "Describe the coverage"
                      }
                      monetary={monetary}
                      disabled={disabled}
                      onValueChange={(next) => setLimit(limit.key, next)}
                    />
                  )}
                </InputGroup>
                </IntakeUnknownRow>
                {openHelp[`${line.coverage}:${limit.key}`] && (
                  <FieldDescription
                    id={`limit-help-${line.coverage}-${limit.key}`}
                  >
                    {line.coverage === "general_liability" &&
                    limit.key === "aggregate"
                      ? "The total limit for covered claims subject to the general aggregate during the policy period. Products and completed-operations claims have a separate aggregate."
                      : help[limit.key]}
                  </FieldDescription>
                )}
              </LimitRow>
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
      minDate={dayjs().format("YYYY-MM-DD")}
      id="effective-date"
      label="Desired effective date"
      value={value}
      inputValue={details.dateInput}
      onInputChange={(text) => {
        const parsed = parseDateText(text);
        const date =
          parsed && parsed >= dayjs().format("YYYY-MM-DD")
            ? dayjs(parsed)
            : null;
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
  const inline = useContext(InlineFieldsContext);
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
        showMap={!inline}
        id="mailing-address"
        className={
          inline ? typeStyle("body.default") : `h-12 ${typeStyle("body.root")}`
        }
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
  defaultActivities = "",
  identityOnly = false,
}: Props & { defaultActivities?: string; identityOnly?: boolean }) {
  const inline = useContext(InlineFieldsContext);
  const externalActions = useContext(InlineCollectionActionsContext);
  if (inline)
    return (
      <div className="space-y-4">
        {!externalActions && (
          <div className="flex justify-end">
            <PillButton
              variant="secondary"
              size="compact"
              disabled={disabled || details.locations.length >= 30}
              onClick={() =>
                onChange({
                  ...details,
                  locations: [
                    ...details.locations,
                    {
                      address: {},
                      details: defaultActivities,
                      activitiesPrefilled: !!defaultActivities,
                    },
                  ],
                })
              }
            >
              <Plus className="size-4" />
              Add location
            </PillButton>
          </div>
        )}
        {!details.locations.length && (
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            No locations
          </p>
        )}
        {details.locations.map((location, index) => {
          const update = (patch: Partial<typeof location>) =>
            onChange({
              ...details,
              locations: details.locations.map((row, i) =>
                i === index ? { ...row, ...patch } : row,
              ),
            });
          return (
            <div key={index} className="min-w-0">
              <div className="min-w-0 flex-1">
                <InlineFieldCard>
                  <InlineFieldRow label="Location name">
                    <Input
                      aria-label={`Location ${index + 1} name`}
                      value={location.name ?? ""}
                      disabled={disabled}
                      placeholder="Not provided"
                      onChange={(event) => update({ name: event.target.value })}
                    />
                  </InlineFieldRow>
                  <InlineFieldRow label="Address">
                    <AddressAutofillInput
                      id={`inline-location-address-${index}`}
                      value={location.address}
                      disabled={disabled}
                      showMap={false}
                      onChange={(address) => update({ address })}
                    />
                  </InlineFieldRow>
                  <InlineFieldRow label="Activities">
                    <Textarea
                      aria-label={`Location ${index + 1} activities`}
                      value={location.details ?? ""}
                      disabled={disabled}
                      placeholder="Not provided"
                      onChange={(event) =>
                        update({
                          details: event.target.value,
                          activitiesPrefilled: false,
                        })
                      }
                    />
                  </InlineFieldRow>
                  <InlineFieldRow label="Owned or leased">
                    <Select
                      value={location.ownership || null}
                      disabled={disabled}
                      onValueChange={(value) =>
                        update({ ownership: value as "owned" | "leased" })
                      }
                    >
                      <SelectTrigger
                        aria-label={`Location ${index + 1} ownership`}
                        className="w-full"
                      >
                        <SelectValue>
                          {location.ownership === "owned"
                            ? "Owned"
                            : location.ownership === "leased"
                              ? "Leased"
                              : "Not provided"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="owned">Owned</SelectItem>
                        <SelectItem value="leased">Leased</SelectItem>
                      </SelectContent>
                    </Select>
                  </InlineFieldRow>
                  <InlineFieldRow label="Staff">
                    <Input
                      aria-label={`Location ${index + 1} staff count`}
                      inputMode="numeric"
                      value={location.staff ?? ""}
                      disabled={disabled}
                      placeholder="Not provided"
                      onChange={(event) =>
                        update({
                          staff: event.target.value.replace(/[^0-9]/g, ""),
                        })
                      }
                    />
                  </InlineFieldRow>
                  <div className="flex justify-end px-4 py-2">
                    <RemoveButton
                      aria-label={`Remove location ${index + 1}`}
                      title="Remove location"
                      disabled={disabled}
                      onClick={() =>
                        onChange({
                          ...details,
                          locations: details.locations.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                      label="Remove location"
                    />
                  </div>
                </InlineFieldCard>
              </div>
            </div>
          );
        })}
      </div>
    );
  return (
    <FieldGroup>
      {details.locations.map((location, index) => (
        <Card
          key={index}
          className="gap-0 border border-border py-0 shadow-none ring-0"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <span className={typeStyle("heading.item")}>
              Location {index + 1}
            </span>
            <RemoveButton
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...details,
                  locations: details.locations.filter((_, i) => i !== index),
                })
              }
              label="Remove location"
            />
          </div>
          <CardContent
            data-location-fields
            className="space-y-5 p-4"
          >
            <Field>
              <FieldLabel
                htmlFor={`location-name-${index}`}
                className={typeStyle("body.root")}
              >
                Location name
              </FieldLabel>
              <Input
                id={`location-name-${index}`}
                className={`h-12 ${typeStyle("body.root")}`}
                placeholder="e.g. Headquarters or Main office"
                value={location.name ?? ""}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...details,
                    locations: details.locations.map((row, i) =>
                      i === index ? { ...row, name: event.target.value } : row,
                    ),
                  })
                }
              />
            </Field>
            <Field>
              <FieldLabel
                htmlFor={`location-${index}`}
                className={typeStyle("body.root")}
              >
                Address
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
            {!identityOnly && <>
            <Field>
              <FieldLabel
                htmlFor={`location-details-${index}`}
                className={typeStyle("body.root")}
              >
                What activities are done here?
              </FieldLabel>
              <Textarea
                id={`location-details-${index}`}
                placeholder="Describe the activities at this location"
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
            <Field>
              <FieldLabel className={typeStyle("body.root")}>
                Is this location owned or leased?
              </FieldLabel>
              <Select
                value={location.ownership ?? null}
                disabled={disabled}
                onValueChange={(value) => {
                  if (!value) return;
                  onChange({
                    ...details,
                    locations: details.locations.map((row, i) =>
                      i === index
                        ? { ...row, ownership: value as "owned" | "leased" }
                        : row,
                    ),
                  });
                }}
              >
                <SelectTrigger
                  aria-label={`Location ${index + 1} ownership`}
                  className={`h-12 w-full ${typeStyle("body.root")}`}
                >
                  <SelectValue placeholder="Select ownership">
                    {location.ownership === "owned"
                      ? "Owned"
                      : location.ownership === "leased"
                        ? "Leased"
                        : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owned">Owned</SelectItem>
                  <SelectItem value="leased">Leased</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel
                htmlFor={`location-staff-${index}`}
                className={typeStyle("body.root")}
              >
                How many staff work here?
              </FieldLabel>
              <IntakeCountInput
                id={`location-staff-${index}`}
                label={`Location ${index + 1} staff count`}
                value={location.staff ?? ""}
                placeholder="Number of staff at this location"
                onBlur={() => {}}
                onChange={(value) =>
                  onChange({
                    ...details,
                    locations: details.locations.map((row, i) =>
                      i === index ? { ...row, staff: value } : row,
                    ),
                  })
                }
              />
            </Field>
            </>}
          </CardContent>
        </Card>
      ))}
      <PillButton
        size="compact"
        className="w-fit"
        variant="secondary"
        disabled={disabled || details.locations.length >= 30}
        onClick={() =>
          onChange({
            ...details,
            locations: [
              ...details.locations,
              {
                address: {},
                details: defaultActivities,
                activitiesPrefilled: !!defaultActivities,
              },
            ],
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
  const inline = useContext(InlineFieldsContext);
  const externalActions = useContext(InlineCollectionActionsContext);
  if (inline) {
    const add = () =>
      onChange({
        ...details,
        hasRelatedEntities: "yes",
        relatedEntities: [
          ...details.relatedEntities,
          { legalName: "", relationship: "", insured: "" },
        ],
      });
    return (
      <div className="space-y-4">
        {!externalActions && (
          <div className="flex justify-end">
            <PillButton
              variant="secondary"
              size="compact"
              disabled={disabled || details.relatedEntities.length >= 30}
              onClick={add}
            >
              <Plus className="size-4" />
              Add entity
            </PillButton>
          </div>
        )}
        {!details.relatedEntities.length && (
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            No related entities
          </p>
        )}
        {details.relatedEntities.map((entity, index) => {
          const update = (patch: Partial<typeof entity>) =>
            onChange({
              ...details,
              relatedEntities: details.relatedEntities.map((row, i) =>
                i === index ? { ...row, ...patch } : row,
              ),
            });
          const select = (
            label: string,
            value: string,
            options: string[],
            change: (value: string) => void,
          ) => (
            <Select
              value={value || null}
              disabled={disabled}
              onValueChange={(value) => change(value ?? "")}
            >
              <SelectTrigger aria-label={label} className="w-full">
                <SelectValue>{value || "Not provided"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
          return (
            <div key={index} className="min-w-0">
              <div className="min-w-0 flex-1">
                <InlineFieldCard>
                  <InlineFieldRow label="Legal name">
                    <Input
                      aria-label={`Entity ${index + 1} legal name`}
                      value={entity.legalName}
                      placeholder="Not provided"
                      disabled={disabled}
                      onChange={(event) =>
                        update({ legalName: event.target.value })
                      }
                    />
                  </InlineFieldRow>
                  <InlineFieldRow label="Relationship">
                    {select(
                      "Relationship",
                      entity.relationship,
                      [
                        UNKNOWN_ANSWER,
                        "Parent",
                        "Subsidiary",
                        "Affiliate",
                        "Operating company",
                        "Property company",
                        "DBA / trading name",
                        "Former name",
                        "Other",
                      ],
                      (relationship) => update({ relationship }),
                    )}
                  </InlineFieldRow>
                  <InlineFieldRow label="Insurance coverage">
                    {select(
                      "Insurance coverage",
                      entity.insured === "include"
                        ? "Include"
                        : entity.insured === "exclude"
                          ? "Exclude"
                          : entity.insured === "unsure"
                            ? UNKNOWN_ANSWER
                            : "",
                      [UNKNOWN_ANSWER, "Include", "Exclude"],
                      (value) =>
                        update({
                          insured:
                            value === "Include"
                              ? "include"
                              : value === "Exclude"
                                ? "exclude"
                                : "unsure",
                        }),
                    )}
                  </InlineFieldRow>
                  <div className="flex justify-end px-4 py-2">
                    <RemoveButton
                      aria-label={`Remove entity ${index + 1}`}
                      title="Remove entity"
                      disabled={disabled}
                      onClick={() =>
                        onChange({
                          ...details,
                          relatedEntities: details.relatedEntities.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                      label="Remove entity"
                    />
                  </div>
                </InlineFieldCard>
              </div>
            </div>
          );
        })}
        {details.relatedEntitiesNote && (
          <InlineFieldCard>
            <InlineFieldRow label="Related entity notes">
              <Textarea
                aria-label="Related entity notes"
                value={details.relatedEntitiesNote}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...details,
                    relatedEntitiesNote: event.target.value,
                  })
                }
              />
            </InlineFieldRow>
          </InlineFieldCard>
        )}
      </div>
    );
  }
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
              <Card key={index} className="border border-border">
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
                  <RemoveButton
                    disabled={disabled}
                    onClick={() =>
                      onChange({
                        ...details,
                        relatedEntities: details.relatedEntities.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                    label="Remove entity"
                  />
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
            {coverageRequestLabel(line)}
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
export function IntakeCoverageScope({ details, onChange, activeCoverageIndex, disabled = false }: Props & { activeCoverageIndex?: number }) {
  const inline = useContext(InlineFieldsContext);
  if (inline)
    return (
      <>
        {details.coverages.map((line, index) => {
          const update = (patch: Partial<typeof line>) =>
            onChange({
              ...details,
              coverages: details.coverages.map((row, i) =>
                i === index ? { ...row, ...patch } : row,
              ),
            });
          if (line.coverage === "property")
            return (
              <div
                key={line.coverage}
                className={
                  line.properties?.length ? "space-y-3 p-4" : "contents"
                }
              >
                {!line.properties?.length && (
                  <InlineFieldRow label="Locations to insure">
                    <div className="px-3 py-2 text-muted-foreground">
                      No locations added
                    </div>
                  </InlineFieldRow>
                )}
                {(line.properties ?? []).map((property, i) => {
                  const change = (patch: Partial<typeof property>) =>
                    update({
                      properties: (line.properties ?? []).map((row, j) =>
                        i === j ? { ...row, ...patch } : row,
                      ),
                    });
                  return (
                    <InlineFieldCard
                      key={i}
                      title={property.name?.trim() || `Location ${i + 1}`}
                      actions={
                        <RemoveButton
                          onClick={() =>
                            update({
                              properties: (line.properties ?? []).filter(
                                (_, j) => j !== i,
                              ),
                            })
                          }
                          label={`Remove location ${i + 1}`}
                        />
                      }
                    >
                      <InlineFieldRow label="Location name">
                        <Input
                          aria-label={`Insured location ${i + 1} name`}
                          value={property.name ?? ""}
                          placeholder="Not provided"
                          onChange={(event) =>
                            change({ name: event.target.value })
                          }
                        />
                      </InlineFieldRow>
                      <InlineFieldRow label="Address">
                        <AddressAutofillInput
                          id={`insured-location-${i}`}
                          showMap={false}
                          value={property.address}
                          onChange={(address) => change({ address })}
                        />
                      </InlineFieldRow>
                      <InlineFieldRow label="Activities">
                        <Textarea
                          aria-label={`Insured location ${i + 1} activities`}
                          rows={1}
                          placeholder="Not provided"
                          value={property.details ?? ""}
                          onChange={(event) =>
                            change({
                              details: event.target.value,
                              activitiesPrefilled: false,
                            })
                          }
                        />
                      </InlineFieldRow>
                      <InlineFieldRow label="Owned or leased">
                        <Select
                          value={property.ownership || null}
                          onValueChange={(value) =>
                            change({ ownership: value as "owned" | "leased" })
                          }
                        >
                          <SelectTrigger
                            aria-label={`Insured location ${i + 1} ownership`}
                          >
                            <SelectValue>
                              {property.ownership === "owned"
                                ? "Owned"
                                : property.ownership === "leased"
                                  ? "Leased"
                                  : "Not provided"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="owned">Owned</SelectItem>
                            <SelectItem value="leased">Leased</SelectItem>
                          </SelectContent>
                        </Select>
                      </InlineFieldRow>
                      <InlineFieldRow label="Staff">
                        <Input
                          aria-label={`Insured location ${i + 1} staff`}
                          inputMode="numeric"
                          value={property.staff ?? ""}
                          placeholder="Not provided"
                          onChange={(event) =>
                            change({
                              staff: event.target.value.replace(/[^0-9]/g, ""),
                            })
                          }
                        />
                      </InlineFieldRow>
                    </InlineFieldCard>
                  );
                })}
              </div>
            );
          if (line.coverage === "commercial_auto")
            return (
              <div
                key={line.coverage}
                className={line.vehicles?.length ? "space-y-3 p-4" : "contents"}
              >
                {!line.vehicles?.length && (
                  <InlineFieldRow label="Vehicles to insure">
                    <div className="px-3 py-2 text-muted-foreground">
                      No vehicles added
                    </div>
                  </InlineFieldRow>
                )}
                {(line.vehicles ?? []).map((vehicle, i) => (
                  <InlineFieldCard
                    key={i}
                    title={`Vehicle ${i + 1}`}
                    actions={
                      <RemoveButton
                        onClick={() =>
                          update({
                            vehicles: (line.vehicles ?? []).filter(
                              (_, j) => i !== j,
                            ),
                          })
                        }
                        label={`Remove vehicle ${i + 1}`}
                      />
                    }
                  >
                    <IntakeVehicleFields
                      country={details.registrationCountry}
                      id={`insured-vehicle-${i}`}
                      vehicle={vehicle}
                      onChange={(next) =>
                        update({
                          vehicles: (line.vehicles ?? []).map((row, j) =>
                            i === j ? next : row,
                          ),
                        })
                      }
                    />
                    <IntakeVehicleUnderwritingFields id={`vehicle-details-${i}`} values={vehicleUnderwritingValues(vehicle,i,details.followups)} onChange={underwriting=>update({vehicles:(line.vehicles ?? []).map((row,j)=>j===i?{...row,underwriting}:row)})}/>
                  </InlineFieldCard>
                ))}
              </div>
            );
          if (["other", "unknown"].includes(line.coverage))
            return (
              <InlineFieldRow key={line.coverage} label="What to insure">
                <Textarea
                  disabled={disabled}
                aria-label={line.coverage === "unknown" ? "What are you looking to get insured?" : `What to insure for ${coverageRequestLabel(line)}`}
                  rows={1}
                  placeholder="Not provided"
                  value={line.scopeDescription ?? ""}
                  onChange={(event) =>
                    update({ scopeDescription: event.target.value })
                  }
                />
              </InlineFieldRow>
            );
          return null;
        })}
      </>
    );
  return (
    <FieldGroup>
      {details.coverages.map((line, index) => {
        if (activeCoverageIndex !== undefined && index !== activeCoverageIndex) return null;
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
            {activeCoverageIndex === undefined && <h2 className={`text-wrap-pretty ${typeStyle("heading.section")}`}>
              {coverageRequestLabel(line)}
            </h2>}
            {line.coverage === "property" ? (
              <IntakeLocations
                identityOnly
                details={{ ...details, locations: line.properties ?? [] }}
                onChange={(next) => update({ properties: next.locations })}
              />
            ) : line.coverage === "commercial_auto" ? (
              <FieldGroup>
                {(
                  line.vehicles ?? [{ year: "", make: "", model: "", vin: "" }]
                ).map((vehicle, vehicleIndex) => (
                  <Card key={vehicleIndex} className="border border-border">
                    <CardContent className="space-y-4">
                      <IntakeVehicleFields
                      country={details.registrationCountry}
                        vehicle={vehicle}
                        id={`vehicle-${index}-${vehicleIndex}`}
                        onChange={(next) =>
                          update({
                            vehicles: (
                              line.vehicles ?? [
                                { year: "", make: "", model: "", vin: "" },
                              ]
                            ).map((row, i) =>
                              i === vehicleIndex ? next : row,
                            ),
                          })
                        }
                      />
                      <RemoveButton
                        onClick={() =>
                          update({
                            vehicles: (line.vehicles ?? []).filter(
                              (_, i) => i !== vehicleIndex,
                            ),
                          })
                        }
                        label="Remove vehicle"
                      />
                    </CardContent>
                  </Card>
                ))}
                <PillButton
                  size="large"
                  className="w-full"
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
                disabled={disabled}
                aria-label={line.coverage === "unknown" ? "What are you looking to get insured?" : `What to insure for ${coverageRequestLabel(line)}`}
                placeholder={line.coverage === "unknown" ? "Describe what you want to protect in your own words. We’ll help work out the coverage." : "Describe what you are looking to get insured"}
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
  const inline = useContext(InlineFieldsContext);
  return (
    <Field>
      <FieldLabel
        htmlFor="registration-address"
        className={inline ? "sr-only" : typeStyle("body.root")}
      >
        Registered business address
      </FieldLabel>
      <AddressAutofillInput
        id="registration-address"
        className={
          inline ? typeStyle("body.default") : `h-12 ${typeStyle("body.root")}`
        }
        value={details.registrationAddress ?? {}}
        showMap={!inline}
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
