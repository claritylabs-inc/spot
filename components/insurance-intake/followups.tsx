"use client";
import { useContext } from "react";
import { InlineFieldsContext } from "@/components/ui/inline-fields";
import { isIntakePercentageQuestion } from "@/lib/intake-percentages";
import { WorkforceProviderInput } from "./workforce-provider-input";
import { CredentialsInput } from "./credentials-input";
import { CountriesInput } from "./countries-input";
import { isWorkforceProviderSource } from "@/lib/intake-workforce-provider";
import { WorkJurisdictionsInput } from "./work-jurisdictions-input";
import type { PayrollPage } from "@/lib/intake-payroll";
import { PayrollInput } from "./payroll-input";
import { intakeApplicantQuestion } from "@/lib/intake-applicant-wording";
import { IntakeLoadingState } from "./loading-state";
import { RouteInput } from "@/components/ui/route-input";
import { VehicleUnitInput, type VehicleNumberField } from "./vehicle-unit-input";
import { IntakeUnknownRow, INTAKE_UNSURE } from "./unknown-choice";
import { SearchableMultiSelect } from "@claritylabs-inc/ui/components/searchable-select";
import { INDUSTRIES } from "@/lib/insurance-intake-industries";
import { emptyRouteValue, parseRouteValue } from "@/lib/route-input";
import { typeStyle } from "@/lib/typography";
import { Link as LinkIcon } from "lucide-react";
import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import { Input } from "@claritylabs-inc/ui/components/input";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import { DateField } from "@claritylabs-inc/ui/components/date-field";
import { parseCalendarDateInput } from "@/lib/date-format";
import dayjs from "dayjs";
import {
  Field,
  FieldLabel,
  FieldGroup,
} from "@claritylabs-inc/ui/components/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@claritylabs-inc/ui/components/select";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupInput,
} from "@claritylabs-inc/ui/components/input-group";
import { IntakeValueInput, IntakeRadioChoices } from "./details-fields";
import {
  intakeVehicleQuestionSubject,
  personalizeIntakeQuestion,
  intakeFollowupOptionLabel,
  type IntakeFollowupQuestion,
  type IntakeFollowupAnswer,
} from "@/lib/intake-followups";

/** Vehicle facts share one page; other follow-ups keep one question per page. */
export function IntakeFollowups({
  question,
  questions,
  answers = [],
  checking = false,
  payrollPage,
  defaultCountry,
  businessName,
  industry,
  answer,
  status,
  dateQuestionIds = [],
  onChange,
}: {
  question?: IntakeFollowupQuestion;
  questions?: IntakeFollowupQuestion[];
  answers?: IntakeFollowupAnswer[];
  checking?: boolean;
  payrollPage?: PayrollPage;
  defaultCountry?: string;
  businessName?: string;
  industry?: string;
  answer: string;
  status?: "pending" | "prepared" | "ready" | "failed";
  dateQuestionIds?: string[];
  onChange: (question: IntakeFollowupQuestion, answer: string) => void;
}) {
  if (
    !status ||
    status === "pending" ||
    status === "prepared" ||
    (!question && checking)
  )
    return (
      <IntakeLoadingState
        compact
        title="Checking your coverage details"
        description="Your answers are saved. We’re preparing the remaining questions."
      />
    );
  if (status === "failed" || !question) return null;
  const grouped = !question.id.startsWith("vehicle_base_") && !!intakeVehicleQuestionSubject(question);
  const fields = (
    <FieldGroup className="gap-6">
      {(questions ?? [question]).map((item) => (
        <IntakeFollowupField
          key={item.id}
          question={item}
          answers={answers}
          dateInput={item.kind === "date" || dateQuestionIds.includes(item.id)}
          payrollPage={payrollPage}
          defaultCountry={defaultCountry}
          businessName={businessName}
          industry={industry}
          grouped={grouped}
          answer={
            questions
              ? (answers.find((row) => row.id === item.id)?.answer ?? "")
              : answer
          }
          onChange={onChange}
        />
      ))}
      {checking && (
        <div
          role="status"
          aria-live="polite"
          className={`flex items-center gap-3 rounded-xl border bg-card p-4 text-muted-foreground ${typeStyle("body.default")}`}
        >
          <Spinner
            aria-hidden="true"
            className="size-4 motion-reduce:animate-none"
          />
          <span>Checking for any final details…</span>
        </div>
      )}
    </FieldGroup>
  );
  return fields;
}

function IntakeFollowupField({
  answers,
  question,
  dateInput,
  payrollPage,
  defaultCountry,
  businessName,
  industry,
  grouped,
  answer,
  onChange,
}: {
  answers: IntakeFollowupAnswer[];
  question: IntakeFollowupQuestion;
  dateInput: boolean;
  payrollPage?: PayrollPage;
  defaultCountry?: string;
  businessName?: string;
  industry?: string;
  grouped: boolean;
  answer: string;
  onChange: (question: IntakeFollowupQuestion, answer: string) => void;
}) {
  const id = `followup-${question.id}`;
  const inline = useContext(InlineFieldsContext);
  const control = inline ? "" : "h-12";
  const controlType = inline ? "" : typeStyle("body.root");
  const monetaryInput = question.kind === "currency" || question.source?.endsWith(" · auto.terms.hired_vehicle_cost");
  const credentialsInput = question.source?.endsWith(" · eo.services.credentials_list");
  const countryInput = question.source?.endsWith(" · auto.terms.foreign_travel_countries");
  const numericVehicleField = question.source?.endsWith(" · property.terms.restoration_period") ? "months" : (isIntakePercentageQuestion(question) ? "percentage" : question.section === "acord" && /^(vehicle_base_|catalog2_auto_vehicle_)/.test(question.id)
    ? question.id.match(/_(annual_distance|gross_vehicle_weight|seats)(?:_s[a-z0-9]+)?$/)?.[1] as VehicleNumberField | undefined : undefined) ?? (question.kind === "number" ? "number" : undefined);
  const presentation = intakeApplicantQuestion(question, industry, answers);
  const clientIndustries = question.source?.endsWith(" · eo.services.client_industries");
  const industryValues = answer === INTAKE_UNSURE ? [INTAKE_UNSURE] : answer.split(";").map(value => value.trim()).filter(Boolean);
  const unknown = answer === INTAKE_UNSURE;
  const unknownInput = !credentialsInput && !countryInput && !isWorkforceProviderSource(question.source) && !question.source?.endsWith(" · shared.operations.annual_payroll") && !question.source?.endsWith(" · wc.terms.covered_jurisdictions") && !clientIndustries && !numericVehicleField && ["short_text", "long_text", "number", "currency", "date"].includes(question.kind);
  const options = question.source?.endsWith(" · property.terms.valuation")
    ? question.options.filter(option => intakeFollowupOptionLabel(option) !== "Other")
    : question.options;
  const choiceOptions = question.kind === "yes_no" ? ["Yes", "No", INTAKE_UNSURE] : [...new Set([...options.map(intakeFollowupOptionLabel), INTAKE_UNSURE])];
  const fullLabel = question.section === "acord" ? presentation.title : personalizeIntakeQuestion(question.label, businessName);
  const vehicleField = question.id.replace(/^catalog2_auto_vehicle_/, "");
  const labels: Record<string, string> = {
    gross_vehicle_weight: "Gross vehicle weight rating (GVWR)",
    annual_distance: "Estimated annual distance",
    radius: "Typical travel radius from base",
    custom_equipment_detail: "Equipment description and replacement value",
    custom_equipment:
      "Does it have nonstandard permanently installed equipment?",
    use: "What is this vehicle used for?",
    seats: "Number of passenger seats",
    personal_use: "Is this vehicle used for personal trips?",
  };
  const fieldKey = Object.keys(labels).find((key) =>
    vehicleField.startsWith(`${key}_s`),
  );
  const label = grouped
    ? fieldKey
      ? labels[fieldKey]
      : fullLabel.replace(/^Vehicle \d+ \(.+\): /, "")
    : fullLabel;
  const compactText =
    grouped &&
    ["gross_vehicle_weight", "annual_distance", "radius"].includes(
      fieldKey ?? "",
    );
  const placeholder = inline ? "Not provided" : question.id.startsWith("cyber_document_") ? "https://yourwebsite.com/…" : presentation.placeholder ?? (
    fieldKey === "gross_vehicle_weight"
      ? "e.g. 26,000 lbs"
      : fieldKey === "annual_distance"
        ? "e.g. 40,000 miles"
        : fieldKey === "radius"
          ? "e.g. 250 miles"
          : question.kind === "number" ? "Enter a number" : question.kind === "long_text" ? "Describe the details" : "Enter your answer");
  return (
    <div className={inline ? "min-w-0" : "space-y-6"}>
      <Field>
        <FieldLabel
          htmlFor={question.kind === "yes_no" && !grouped ? undefined : id}
          className={grouped ? typeStyle("body.root") : "sr-only w-px! max-w-px!"}
        >
          {label}
        </FieldLabel>
        <IntakeUnknownRow enabled={unknownInput} placement={question.kind === "long_text" && !compactText && !monetaryInput && !dateInput && !question.id.startsWith("cyber_document_") ? "below" : "beside"} label={label} value={answer} onChange={value=>onChange(question,value)}>
        {credentialsInput ? <CredentialsInput value={answer} onChange={value=>onChange(question,value)}/> : isWorkforceProviderSource(question.source) ? <WorkforceProviderInput provider={question.source?.endsWith(" · wc.safety.leasing_details") ? "PEO" : "Staffing agency"} value={answer} onChange={value=>onChange(question,value)}/> : unknownInput && unknown ? <InputGroup className={control} /> : question.source?.endsWith(" · wc.terms.covered_jurisdictions") ? <WorkJurisdictionsInput defaultCountry={defaultCountry} value={answer} onChange={value=>onChange(question,value)}/> : question.source?.endsWith(" · shared.operations.annual_payroll") ? <PayrollInput page={payrollPage} value={answer} onChange={value=>onChange(question,value)}/> : clientIndustries ? (
          <div className={inline ? undefined : "[&_button]:min-h-12"}><SearchableMultiSelect ariaLabel={fullLabel}
            options={[...new Set([...INDUSTRIES.map(industry => industry.label), ...industryValues, INTAKE_UNSURE])].map(value => ({ value, label: value }))}
            value={industryValues} placeholder="Choose your clients’ industries" maxSelected={20}
            onChange={values => onChange(question, values.includes(INTAKE_UNSURE) && !industryValues.includes(INTAKE_UNSURE) ? INTAKE_UNSURE : values.filter(value => value !== INTAKE_UNSURE).join("; "))} /></div>
        ) : countryInput ? (
          <CountriesInput label={fullLabel} value={answer} onChange={value => onChange(question, value)} />
        ) : numericVehicleField ? (
          <VehicleUnitInput id={id} label={label} field={numericVehicleField} value={answer} onChange={value => onChange(question, value)} />
        ) : dateInput ? (
          <DateField
            id={id}
            label={label}
            hideLabel
            value={parseCalendarDateInput(answer)}
            inputValue={parseCalendarDateInput(answer) ? dayjs(parseCalendarDateInput(answer)).format("MM/DD/YYYY") : answer}
            onInputChange={value => onChange(question, value)}
            onChange={value => onChange(question, value)}
          />
        ) : question.kind === "routes" ? (
          <RouteInput
            value={
              parseRouteValue(answer) ?? emptyRouteValue()
            }
            onChange={(value) =>
              onChange(
                question,
                value.routes.every((route) => route.stops.every((stop) => !stop.name.trim())) &&
                  !value.legacyMaximumDistance?.trim()
                  ? ""
                  : JSON.stringify(value),
              )
            }
          />
        ) : question.kind === "yes_no" || (question.kind === "dropdown" && choiceOptions.length < 8) ? (
          <IntakeRadioChoices
            label={label}
            value={intakeFollowupOptionLabel(answer)}
            choices={choiceOptions}
            onChange={(value) => onChange(question, question.options.find(option => intakeFollowupOptionLabel(option) === value) ?? value)}
          />
        ) : question.kind === "dropdown" ? (
          <Select
            value={answer}
            onValueChange={(value) => onChange(question, value ?? "")}
          >
            <SelectTrigger
              id={id}
              className={grouped ? `h-12 ${typeStyle("body.root")}` : undefined}
            >
              <SelectValue placeholder="Choose an answer">
                {answer ? intakeFollowupOptionLabel(answer) : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {choiceOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {intakeFollowupOptionLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : monetaryInput ? (
          <InputGroup className={control}>
            <InputGroupAddon>
              <InputGroupText>$</InputGroupText>
            </InputGroupAddon>
            <IntakeValueInput
              id={id}
              label={label}
              value={answer}
              monetary
              placeholder={inline ? placeholder : "Enter amount"}
              onValueChange={(value) => onChange(question, value)}
            />
          </InputGroup>
        ) : question.id.startsWith("cyber_document_") ? (
          <InputGroup className={control}>
            <InputGroupAddon><LinkIcon aria-hidden="true" className="size-4" /></InputGroupAddon>
            <InputGroupInput id={id} type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              className={controlType} placeholder={placeholder} value={answer} maxLength={2000}
              onChange={event => onChange(question, event.target.value)} />
          </InputGroup>
        ) : question.kind === "long_text" && !compactText ? (
          <Textarea
            id={id}
            placeholder={placeholder}
            className={grouped ? typeStyle("body.root") : undefined}
            value={answer}
            maxLength={2000}
            onChange={(event) => onChange(question, event.target.value)}
          />
        ) : (
          <Input
            id={id}
            className={`${control} ${controlType}`}
            type={question.kind === "number" ? "number" : "text"}
            placeholder={placeholder}
            value={answer}
            maxLength={2000}
            onChange={(event) => onChange(question, event.target.value)}
          />
        )}
        </IntakeUnknownRow>
      </Field>
    </div>
  );
}
