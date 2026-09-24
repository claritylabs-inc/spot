"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import dayjs from "dayjs";
import { Input } from "@claritylabs-inc/ui/components/input";
import { Label } from "@claritylabs-inc/ui/components/label";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import type {
  PresentationProps,
  PresentationReference,
} from "@/lib/chat-presentation";
import { typeStyle } from "@/lib/typography";
import { usePresentation } from "./context";

type FormField = PresentationProps<"ClarificationForm">["fields"][number];
const MAX_ANSWER_LENGTH = 2000;

export function buildClarificationFollowUp(
  fields: FormField[],
  values: Record<string, string>,
  references: Map<string, PresentationReference>,
  structuredReferences = false,
): {
  message: string;
  errors: Record<string, string>;
  selectedReferences?: PresentationReference[];
} {
  const errors = new Map<string, string>();
  const answers: string[] = [];
  const selectedReferences: PresentationReference[] = [];
  for (const field of fields) {
    const value = (
      Object.hasOwn(values, field.id) ? values[field.id] : ""
    ).trim();
    if (!value) {
      if (field.required) errors.set(field.id, "Enter a value.");
      continue;
    }
    if (value.length > MAX_ANSWER_LENGTH) {
      errors.set(field.id, `Use ${MAX_ANSWER_LENGTH} characters or fewer.`);
      continue;
    }
    let answer = value;
    if (
      field.type === "number" &&
      (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ||
        !Number.isFinite(Number(value)))
    ) {
      errors.set(field.id, "Enter a valid number.");
    } else if (
      field.type === "date" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !dayjs(value).isValid() ||
        dayjs(value).format("YYYY-MM-DD") !== value)
    ) {
      errors.set(field.id, "Enter a valid date.");
    } else if (field.type === "choice" || field.type === "record") {
      const option = field.options?.find(
        (candidate) => candidate.value === value,
      );
      const reference =
        field.type === "record" ? references.get(value) : undefined;
      if (!option || (field.type === "record" && !reference)) {
        errors.set(field.id, "Choose an available option.");
      } else if (
        reference &&
        structuredReferences &&
        (reference.kind === "policy" || reference.kind === "requirement")
      ) {
        answer = `@${reference.label}`;
        selectedReferences.push(reference);
      } else {
        answer = reference
          ? `${reference.label} (${reference.kind}: ${reference.recordId})`
          : option.label;
      }
    }
    answers.push(`${field.label}: ${answer}`);
  }
  return {
    message: answers.join("\n"),
    errors: Object.fromEntries(errors),
    ...(selectedReferences.length ? { selectedReferences } : {}),
  };
}

function followUpKey(
  message: string,
  selectedReferences?: PresentationReference[],
) {
  return JSON.stringify([
    message,
    selectedReferences?.map((reference) => [
      reference.kind,
      reference.recordId,
    ]) ?? [],
  ]);
}

function useFollowUpSubmission() {
  const { disabled, onFollowUp } = usePresentation();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const [sentKey, setSentKey] = useState<string>();
  const inFlight = useRef(false);
  const unavailable = disabled || !onFollowUp || sending;

  async function send(
    message: string,
    selectedReferences?: PresentationReference[],
  ) {
    const key = followUpKey(message, selectedReferences);
    if (unavailable || inFlight.current || key === sentKey || !onFollowUp)
      return;
    inFlight.current = true;
    setSending(true);
    setSendError(undefined);
    try {
      await onFollowUp(message, selectedReferences);
      setSentKey(key);
    } catch {
      setSendError("Your reply could not be sent. Try again.");
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return { send, sending, sendError, setSendError, sentKey, unavailable };
}

export function FollowUpButton({
  message,
  label,
}: {
  message: string;
  label: string;
}) {
  const submission = useFollowUpSubmission();
  const alreadySent = submission.sentKey === followUpKey(message);
  return (
    <div className="min-w-0 space-y-2">
      <PillButton
        variant="secondary"
        disabled={submission.unavailable || alreadySent}
        onClick={() => void submission.send(message)}
        className="max-w-full"
      >
        <span className="truncate">
          {submission.sending ? "Sending…" : alreadySent ? "Sent" : label}
        </span>
      </PillButton>
      {submission.sendError ? (
        <p
          role="alert"
          className={`text-destructive ${typeStyle("body.default")}`}
        >
          {submission.sendError}
        </p>
      ) : null}
    </div>
  );
}

function OptionLabel({
  label,
  reference,
}: {
  label: string;
  reference?: PresentationReference;
}) {
  return (
    <>
      {reference?.kind === "provider" || reference?.kind === "vendor" ? (
        <OrgBrandIcon name={reference.label} size="xs" />
      ) : null}
      <span className="min-w-0 truncate">{reference?.label ?? label}</span>
    </>
  );
}

function FollowUpForm({
  fields,
  submitLabel,
}: PresentationProps<"ClarificationForm">) {
  const { references, structuredReferences } = usePresentation();
  const { send, sending, sendError, setSendError, sentKey, unavailable } =
    useFollowUpSubmission();
  const id = useId();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.id, ""])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [composing, setComposing] = useState(false);
  const composingRef = useRef(false);
  const result = buildClarificationFollowUp(
    fields,
    values,
    references,
    structuredReferences,
  );
  const alreadySent =
    sentKey === followUpKey(result.message, result.selectedReferences);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (unavailable || composingRef.current || alreadySent) return;
    setErrors(result.errors);
    setSendError(undefined);
    const invalidField = fields.findIndex((field) =>
      Object.hasOwn(result.errors, field.id),
    );
    if (invalidField >= 0) {
      document.getElementById(`${id}-${invalidField}`)?.focus();
      return;
    }
    if (!result.message) {
      setSendError("Enter at least one answer.");
      return;
    }
    await send(result.message, result.selectedReferences);
  }

  function change(fieldId: string, value: string) {
    setValues((current) => ({ ...current, [fieldId]: value }));
    setErrors((current) => ({ ...current, [fieldId]: "" }));
    setSendError(undefined);
  }

  return (
    <form
      noValidate
      className="min-w-0 space-y-4"
      onSubmit={submit}
      onCompositionStart={() => {
        composingRef.current = true;
        setComposing(true);
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
        setComposing(false);
      }}
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          (event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229 ||
            composingRef.current)
        )
          event.preventDefault();
      }}
    >
      {fields.map((field, index) => {
        const fieldId = `${id}-${index}`;
        const value = Object.hasOwn(values, field.id) ? values[field.id] : "";
        const error = Object.hasOwn(errors, field.id)
          ? errors[field.id]
          : undefined;
        const options = (field.options ?? []).filter(
          (option) => field.type !== "record" || references.has(option.value),
        );
        const selected = options.find((option) => option.value === value);
        return (
          <div key={field.id} className="min-w-0 space-y-2">
            <Label htmlFor={fieldId} className="break-words">
              {field.label}
              {field.required ? <span aria-hidden="true">*</span> : null}
            </Label>
            {field.type === "choice" || field.type === "record" ? (
              <Select
                value={value || null}
                onValueChange={(value) => change(field.id, value ?? "")}
                disabled={unavailable}
                items={options.map((option) => ({
                  value: option.value,
                  label:
                    field.type === "record"
                      ? references.get(option.value)?.label
                      : option.label,
                }))}
              >
                <SelectTrigger
                  id={fieldId}
                  aria-required={field.required}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? `${fieldId}-error` : undefined}
                >
                  <SelectValue placeholder="Select an option">
                    {selected ? (
                      <OptionLabel
                        label={selected.label}
                        reference={
                          field.type === "record"
                            ? references.get(selected.value)
                            : undefined
                        }
                      />
                    ) : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {!field.required ? (
                    <SelectItem value="">No selection</SelectItem>
                  ) : null}
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <OptionLabel
                        label={option.label}
                        reference={
                          field.type === "record"
                            ? references.get(option.value)
                            : undefined
                        }
                      />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={fieldId}
                type={field.type === "date" ? "date" : "text"}
                inputMode={field.type === "number" ? "decimal" : undefined}
                required={field.required}
                maxLength={MAX_ANSWER_LENGTH}
                value={value}
                onChange={(event) => change(field.id, event.target.value)}
                disabled={unavailable}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${fieldId}-error` : undefined}
              />
            )}
            {error ? (
              <p
                id={`${fieldId}-error`}
                className={`text-destructive ${typeStyle("caption.default")}`}
                role="alert"
              >
                {error}
              </p>
            ) : null}
          </div>
        );
      })}
      {sendError ? (
        <p
          role="alert"
          className={`text-destructive ${typeStyle("body.default")}`}
        >
          {sendError}
        </p>
      ) : null}
      <PillButton
        type="submit"
        disabled={unavailable || composing || alreadySent}
        className="max-w-full"
      >
        <span className="truncate">
          {sending ? "Sending…" : alreadySent ? "Sent" : submitLabel}
        </span>
      </PillButton>
    </form>
  );
}

export function ChoiceGroup({
  label,
  options,
  submitLabel,
}: PresentationProps<"ChoiceGroup">) {
  return (
    <FollowUpForm
      fields={[
        { id: "choice", label, type: "choice", required: true, options },
      ]}
      submitLabel={submitLabel}
    />
  );
}

export function RecordSelector({
  label,
  referenceIds,
  submitLabel,
}: PresentationProps<"RecordSelector">) {
  const { references } = usePresentation();
  return (
    <FollowUpForm
      fields={[
        {
          id: "record",
          label,
          type: "record",
          required: true,
          options: referenceIds.flatMap((referenceId) => {
            const reference = references.get(referenceId);
            return reference
              ? [{ value: referenceId, label: reference.label }]
              : [];
          }),
        },
      ]}
      submitLabel={submitLabel}
    />
  );
}

export function ClarificationForm(
  props: PresentationProps<"ClarificationForm">,
) {
  return <FollowUpForm {...props} />;
}
