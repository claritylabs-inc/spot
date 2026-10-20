"use client";
import { Input } from "@claritylabs-inc/ui/components/input";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import { Field, FieldLabel } from "@claritylabs-inc/ui/components/field";
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
  personalizeIntakeQuestion,
  intakeFollowupOptionLabel,
  type IntakeFollowupQuestion,
} from "@/lib/intake-followups";

/** Each generated question is one persisted step within its intake section. */
export function IntakeFollowups({
  question,
  businessName,
  answer,
  status,
  onChange,
}: {
  question?: IntakeFollowupQuestion;
  businessName?: string;
  answer: string;
  status?: "pending" | "ready" | "failed";
  onChange: (question: IntakeFollowupQuestion, answer: string) => void;
}) {
  if (!status || status === "pending")
    return (
      <p role="status" className="text-muted-foreground">
        Preparing questions for your business…
      </p>
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
        You’ve already covered what we need here. Continue to the next section.
      </p>
    );
  const id = `followup-${question.id}`;
  const label = personalizeIntakeQuestion(question.label,businessName);
  return (
    <div className="space-y-6">
      <Field>
        <FieldLabel
          htmlFor={question.kind === "yes_no" ? undefined : id}
          className="sr-only"
        >
          {label}
        </FieldLabel>
        {question.kind === "yes_no" ? (
          <IntakeRadioChoices
            label={label}
            value={answer}
            choices={["Yes", "No", "I'm not sure"]}
            onChange={(value) => onChange(question, value)}
          />
        ) : question.kind === "dropdown" ? (
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
              {question.options.map((option) => (
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
        ) : question.kind === "long_text" ? (
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
            value={answer}
            maxLength={2000}
            onChange={(event) => onChange(question, event.target.value)}
          />
        )}
      </Field>
    </div>
  );
}
