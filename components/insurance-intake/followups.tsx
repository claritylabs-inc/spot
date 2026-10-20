"use client";
import { WorkJurisdictionsInput } from "./work-jurisdictions-input";
import { PayrollInput } from "./payroll-input";
import { intakeApplicantQuestion } from "@/lib/intake-applicant-wording";
import { IntakeLoadingState } from "./loading-state";
import { RouteInput } from "@/components/ui/route-input";
import { VehicleUnitInput, type VehicleNumberField } from "./vehicle-unit-input";
import { IntakeUnknownChoice, INTAKE_UNSURE } from "./unknown-choice";
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
          dateInput={item.kind === "date" || dateQuestionIds.includes(item.id)}
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
  question,
  dateInput,
  businessName,
  industry,
  grouped,
  answer,
  onChange,
}: {
  question: IntakeFollowupQuestion;
  dateInput: boolean;
  businessName?: string;
  industry?: string;
  grouped: boolean;
  answer: string;
  onChange: (question: IntakeFollowupQuestion, answer: string) => void;
}) {
  const id = `followup-${question.id}`;
  const numericVehicleField = (question.source?.endsWith(" · eo.services.largest_client_share") ? "percentage" : question.section === "acord" && /^(vehicle_base_|catalog2_auto_vehicle_)/.test(question.id)
    ? question.id.match(/_(annual_distance|gross_vehicle_weight|seats)(?:_s[a-z0-9]+)?$/)?.[1] as VehicleNumberField | undefined : undefined) ?? (question.kind === "number" ? "number" : undefined);
  const presentation = intakeApplicantQuestion(question, industry);
  const clientIndustries = question.source?.endsWith(" · eo.services.client_industries");
  const industryValues = answer === INTAKE_UNSURE ? [INTAKE_UNSURE] : answer.split(";").map(value => value.trim()).filter(Boolean);
  const unknown = answer === INTAKE_UNSURE;
  const unknownInput = ((!question.source?.endsWith(" · shared.operations.annual_payroll") && !question.source?.endsWith(" · wc.terms.covered_jurisdictions")) || unknown) && !clientIndustries && !numericVehicleField && !["yes_no", "dropdown"].includes(question.kind);
  const choiceOptions = question.kind === "yes_no" ? ["Yes", "No", INTAKE_UNSURE] : [...new Set([...question.options.map(intakeFollowupOptionLabel), INTAKE_UNSURE])];
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
  const placeholder = question.id.startsWith("cyber_document_") ? "https://yourwebsite.com/…" : presentation.placeholder ?? (
    fieldKey === "gross_vehicle_weight"
      ? "e.g. 26,000 lb"
      : fieldKey === "annual_distance"
        ? "e.g. 40,000 miles"
        : fieldKey === "radius"
          ? "e.g. 250 miles"
          : question.kind === "number" ? "Enter a number" : question.kind === "long_text" ? "Describe the details" : "Enter your answer");
  return (
    <div className="space-y-6">
      <Field>
        <FieldLabel
          htmlFor={question.kind === "yes_no" && !grouped ? undefined : id}
          className={grouped ? typeStyle("body.root") : "sr-only"}
        >
          {label}
        </FieldLabel>
        <div className={`relative ${unknownInput && !answer.trim() ? "[&_input]:pr-40 [&_textarea]:pr-40" : ""}`}>
        {unknownInput && unknown ? <InputGroup className="h-12" /> : question.source?.endsWith(" · wc.terms.covered_jurisdictions") ? <WorkJurisdictionsInput value={answer} onChange={value=>onChange(question,value)}/> : question.source?.endsWith(" · shared.operations.annual_payroll") ? <PayrollInput value={answer} onChange={value=>onChange(question,value)}/> : clientIndustries ? (
          <div className="[&_button]:min-h-12"><SearchableMultiSelect ariaLabel={fullLabel}
            options={[...new Set([...INDUSTRIES.map(industry => industry.label), ...industryValues, INTAKE_UNSURE])].map(value => ({ value, label: value }))}
            value={industryValues} placeholder="Choose your clients’ industries" maxSelected={20}
            onChange={values => onChange(question, values.includes(INTAKE_UNSURE) && !industryValues.includes(INTAKE_UNSURE) ? INTAKE_UNSURE : values.filter(value => value !== INTAKE_UNSURE).join("; "))} /></div>
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
        ) : question.kind === "currency" ? (
          <InputGroup className="h-12">
            <InputGroupAddon>
              <InputGroupText>$</InputGroupText>
            </InputGroupAddon>
            <IntakeValueInput
              id={id}
              label={label}
              value={answer}
              placeholder="Enter amount"
              onValueChange={(value) => onChange(question, value)}
            />
          </InputGroup>
        ) : question.id.startsWith("cyber_document_") ? (
          <InputGroup className="h-12">
            <InputGroupAddon><LinkIcon aria-hidden="true" className="size-4" /></InputGroupAddon>
            <InputGroupInput id={id} type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              className={typeStyle("body.root")} placeholder={placeholder} value={answer} maxLength={2000}
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
            className={`h-12 ${typeStyle("body.root")}`}
            type={question.kind === "number" ? "number" : "text"}
            placeholder={placeholder}
            value={answer}
            maxLength={2000}
            onChange={(event) => onChange(question, event.target.value)}
          />
        )}
        {unknownInput && (!answer.trim() || unknown) && <div className={`absolute right-4 top-2 ${unknown ? "left-3" : ""}`}>
          <IntakeUnknownChoice label={label} checked={unknown} alignTop={question.kind === "long_text" && !unknown} onChange={checked => onChange(question, checked ? INTAKE_UNSURE : "")} />
        </div>}
        </div>
      </Field>
    </div>
  );
}
