"use client";
import { useState, useRef, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { typeStyle } from "@/lib/typography";
import { PillButton } from "@/components/ui/pill-button";
import { IntakeValueInput } from "@/components/insurance-intake/details-fields";
import { RouteInput } from "@/components/ui/route-input";
import { InlineFieldsContext } from "@/components/ui/inline-fields";
import { emptyRouteValue, parseRouteValue } from "@/lib/route-input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
} from "@claritylabs-inc/ui/components/input-group";
import { Input } from "@claritylabs-inc/ui/components/input";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { type Panel, type Question, Choice } from "./shared";
import { InformationAttachments } from "./attachments";

export function InlineInformationAnswer({
  question: q,
  files,
  currency,
  disabled,
}: {
  question: Question;
  files: Panel["files"];
  currency: string;
  disabled: boolean;
}) {
  const record = useMutation(api.procurementInformation.recordAnswer);
  const canonical = q.answer?.unsure
    ? "I'm not sure"
    : (q.answer?.answer ?? "");
  const [answer, setAnswer] = useState(canonical);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = useRef(false);
  const baseline = useRef(q.answerId);
  const pending = useRef(false);
  useEffect(() => {
    if (!dirty.current && !busy) {
      setAnswer(canonical);
      baseline.current = q.answerId;
    }
  }, [canonical, q.answerId, busy]);
  function change(value: string) {
    if (!dirty.current) baseline.current = q.answerId;
    dirty.current = true;
    setAnswer(value);
    setError("");
  }
  async function save(value = answer) {
    if (disabled || pending.current || !dirty.current) return;
    if (value === canonical) {
      dirty.current = false;
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      baseline.current = await record({
        questionId: q._id,
        previousAnswerId: baseline.current,
        answer: value,
        provenance: "Operator answer on behalf of client",
        fileItemIds:
          q.answer?.fileItemIds.filter((id) =>
            files.some((file) => file.id === id),
          ) ?? [],
      });
      dirty.current = false;
      setError("");
    } catch (error) {
      setError(
        getUserFacingErrorMessage(
          error,
          "Could not save answer. Your edit remains visible.",
        ),
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const label = `Answer: ${q.question.label}`;
  const props = {
    "aria-label": label,
    value: answer === "I'm not sure" ? "" : answer,
    placeholder: answer === "I'm not sure" ? "I'm not sure" : "Enter an answer",
    disabled: disabled || busy,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => change(event.target.value),
    onBlur: () => void save(),
  };
  return (
    <div className="min-w-0 space-y-1">
      {q.question.kind === "yes_no" || q.question.kind === "dropdown" ? (
        <Choice
          placeholder="Choose an answer"
          label={label}
          value={answer}
          disabled={disabled || busy}
          options={[
            ...(q.question.kind === "yes_no"
              ? ["Yes", "No"]
              : (q.question.options ?? [])),
            "I'm not sure",
          ]
            .filter((value, index, values) => values.indexOf(value) === index)
            .map((value) => ({ value, label: value }))}
          onChange={(value) => {
            change(value);
            void save(value);
          }}
        />
      ) : q.question.kind === "routes" ? (
        <fieldset
          disabled={disabled || busy}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) void save();
          }}
        >
          <InlineFieldsContext.Provider value={true}>
            <RouteInput
              value={parseRouteValue(answer) ?? emptyRouteValue()}
              onChange={(value) => change(JSON.stringify(value))}
            />
          </InlineFieldsContext.Provider>
        </fieldset>
      ) : q.question.kind === "currency" ? (
        <InputGroup onBlur={() => void save()}>
          <InputGroupAddon>
            <InputGroupText>{q.scope.currency ?? currency}</InputGroupText>
          </InputGroupAddon>
          <IntakeValueInput
            id={`answer-${q._id}`}
            label={label}
            value={props.value}
            placeholder={props.placeholder}
            disabled={props.disabled}
            onValueChange={change}
          />
        </InputGroup>
      ) : q.question.kind === "long_text" ? (
        <Textarea {...props} />
      ) : (
        <Input
          {...props}
          type={
            q.question.kind === "number"
              ? "number"
              : q.question.kind === "date"
                ? "date"
                : "text"
          }
        />
      )}
      {busy && (
        <p
          role="status"
          className={`text-muted-foreground ${typeStyle("caption.default")}`}
        >
          Saving…
        </p>
      )}
      {error && (
        <div role="alert" className="text-destructive">
          <p>{error}</p>
          <PillButton variant="ghost" onClick={() => void save()}>
            Retry saving
          </PillButton>
        </div>
      )}
      <InformationAttachments ids={q.answer?.fileItemIds ?? []} files={files} />
    </div>
  );
}
