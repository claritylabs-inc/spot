"use client";
import { typeStyle } from "@/lib/typography";
import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import { Input } from "@claritylabs-inc/ui/components/input";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
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
  answer,
  status,
  onChange,
}: {
  question?: IntakeFollowupQuestion;
  questions?: IntakeFollowupQuestion[];
  answers?: IntakeFollowupAnswer[];
  checking?: boolean;
  businessName?: string;
  answer: string;
  status?: "pending" | "prepared" | "ready" | "failed";
  onChange: (question: IntakeFollowupQuestion, answer: string) => void;
}) {
  if (
    !status ||
    status === "pending" ||
    status === "prepared" ||
    (!question && checking)
  )
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 text-muted-foreground"
      >
        <Spinner
          aria-hidden="true"
          className="size-4 shrink-0 motion-reduce:animate-none"
        />
        <span>Preparing questions for your business…</span>
      </div>
    );
  if (status === "failed")
    return (
      <p role="status" className="text-muted-foreground">
        We couldn’t prepare these questions. You can continue; your existing
        answers are saved.
      </p>
    );
  if (!question)
    return (
      <p className="text-muted-foreground">
        No additional questions for this section. Continue when you’re ready.
      </p>
    );
  const grouped = !!intakeVehicleQuestionSubject(question);
  return (
    <FieldGroup className="gap-6">
      {(questions ?? [question]).map((item) => (
        <IntakeFollowupField
          key={item.id}
          question={item}
          businessName={businessName}
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
          className={`flex items-center gap-2 text-muted-foreground ${typeStyle("body.default")}`}
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
}

function IntakeFollowupField({
  question,
  businessName,
  grouped,
  answer,
  onChange,
}: {
  question: IntakeFollowupQuestion;
  businessName?: string;
  grouped: boolean;
  answer: string;
  onChange: (question: IntakeFollowupQuestion, answer: string) => void;
}) {
  const id = `followup-${question.id}`;
  const fullLabel = personalizeIntakeQuestion(question.label, businessName);
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
  const placeholder =
    fieldKey === "gross_vehicle_weight"
      ? "e.g. 26,000 lb"
      : fieldKey === "annual_distance"
        ? "e.g. 40,000 miles"
        : fieldKey === "radius"
          ? "e.g. 250 miles"
          : undefined;
  return (
    <div className="space-y-6">
      <Field>
        <FieldLabel
          htmlFor={question.kind === "yes_no" && !grouped ? undefined : id}
          className={grouped ? undefined : "sr-only"}
        >
          {label}
        </FieldLabel>
        {question.kind === "yes_no" && !grouped ? (
          <IntakeRadioChoices
            label={label}
            value={answer}
            choices={["Yes", "No", "I'm not sure"]}
            onChange={(value) => onChange(question, value)}
          />
        ) : question.kind === "dropdown" || question.kind === "yes_no" ? (
          <Select
            value={answer}
            onValueChange={(value) => onChange(question, value ?? "")}
          >
            <SelectTrigger id={id}>
              <SelectValue placeholder="Choose an answer">
                {answer ? intakeFollowupOptionLabel(answer) : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(question.kind === "yes_no"
                ? ["Yes", "No", "I'm not sure"]
                : question.options
              ).map((option) => (
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
              placeholder="0"
              onValueChange={(value) => onChange(question, value)}
            />
          </InputGroup>
        ) : question.kind === "long_text" && !compactText ? (
          <Textarea
            id={id}
            value={answer}
            maxLength={2000}
            onChange={(event) => onChange(question, event.target.value)}
          />
        ) : (
          <Input
            id={id}
            type={question.kind === "number" ? "number" : "text"}
            placeholder={placeholder}
            value={answer}
            maxLength={2000}
            onChange={(event) => onChange(question, event.target.value)}
          />
        )}
      </Field>
    </div>
  );
}
