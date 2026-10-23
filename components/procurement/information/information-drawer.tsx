"use client";
import { useState, useRef, useId } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { COVERAGE_OPTIONS } from "@/lib/insurance-intake-details";
import { type IntakeFollowupQuestion } from "@/lib/intake-followups";
import { typeStyle } from "@/lib/typography";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@claritylabs-inc/ui/components/field";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import { OperationalSkeletonList } from "@claritylabs-inc/ui/components/operational-panel";
import {
  type Panel,
  type Actions,
  type InformationDrawerTarget,
  KINDS,
  KIND_LABELS,
  Choice,
  attempt,
} from "./shared";
import { RequirementComposer } from "./requirement-composer";

export function InformationDrawer({
  target,
  onClose,
  ...props
}: {
  requestId: Id<"procurementRequests">;
  target: InformationDrawerTarget;
  onClose: () => void;
}) {
  const panel = useQuery(api.procurementInformation.panel, {
    requestId: props.requestId,
  });
  if (panel && !target.mode && !target.questionId)
    return (
      <AddQuestionDrawer
        requestId={props.requestId}
        panel={panel}
        onClose={onClose}
      />
    );
  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={
        target.questionId
          ? "Add a provider"
          : target.mode === "email"
            ? "Questions from email"
            : "Add a question"
      }
    >
      {panel ? (
        <RequirementComposer
          requestId={props.requestId}
          panel={panel}
          onDone={onClose}
          initialQuestionId={target.questionId}
          mode={target.mode}
        />
      ) : (
        <OperationalSkeletonList rows={3} />
      )}
    </SettingsDrawer>
  );
}

function AddQuestionDrawer({
  requestId,
  panel,
  onClose,
}: {
  requestId: Actions["requestId"];
  panel: Panel;
  onClose: () => void;
}) {
  const add = useMutation(api.procurementInformation.addRequirement);
  const formId = useId();
  const [label, setLabel] = useState("");
  const [kind, setKind] =
    useState<IntakeFollowupQuestion["kind"]>("short_text");
  const [coverage, setCoverage] = useState(() => {
    const coverages = new Set(panel.questions.map((q) => q.scope.coverage));
    return coverages.size === 1 ? [...coverages][0] : "";
  });
  const [outreachId, setOutreachId] = useState<
    Id<"procurementBrokerOutreaches"> | ""
  >(panel.outreaches.length === 1 ? panel.outreaches[0]._id : "");
  const [currency, setCurrency] = useState(panel.currency);
  const [options, setOptions] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const choices = options
    .split("\n")
    .map((option) => option.trim())
    .filter(Boolean);
  const canAdd =
    !!label.trim() &&
    !!coverage &&
    !!outreachId &&
    (kind !== "dropdown" || (choices.length >= 2 && choices.length <= 12));
  return (
    <SettingsDrawer
      open
      title="Add a question"
      onOpenChange={(open) => !open && onClose()}
      footer={
        <>
          <PillButton variant="ghost" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton type="submit" form={formId} disabled={busy || !canAdd}>
            {busy ? "Adding…" : "Add question"}
          </PillButton>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          if (!canAdd || saving.current) return;
          saving.current = true;
          setBusy(true);
          void attempt(async () => {
            try {
              await add({
                requestId,
                outreachId,
                question: {
                  id: "provider_question",
                  section: "additional",
                  label: label.trim(),
                  kind,
                  options: kind === "dropdown" ? choices : [],
                },
                scope: {
                  subject: "company",
                  period: "current",
                  coverage,
                  currency: kind === "currency" ? currency : undefined,
                },
              });
              toast.success("Question added");
              onClose();
            } finally {
              saving.current = false;
              setBusy(false);
            }
          });
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${formId}-question`}>Question</FieldLabel>
            <Textarea
              id={`${formId}-question`}
              placeholder="What do you need to know?"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={500}
              rows={3}
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel>Answer type</FieldLabel>
            <Choice
              label="Answer type"
              value={kind}
              onChange={setKind}
              options={KINDS.map((value) => ({
                value,
                label: KIND_LABELS[value],
              }))}
            />
          </Field>
          {kind === "currency" && (
            <Field>
              <FieldLabel>Currency</FieldLabel>
              <Choice
                label="Answer currency"
                value={currency}
                onChange={setCurrency}
                options={[
                  "USD",
                  "CAD",
                  "EUR",
                  "GBP",
                  "AUD",
                  "NZD",
                  "CHF",
                  "JPY",
                ].map((value) => ({ value, label: value }))}
              />
            </Field>
          )}
          {kind === "dropdown" && (
            <Field>
              <FieldLabel htmlFor={`${formId}-options`}>Options</FieldLabel>
              <Textarea
                id={`${formId}-options`}
                placeholder="One option per line"
                rows={3}
                value={options}
                onChange={(event) => setOptions(event.target.value)}
              />
            </Field>
          )}
          <Field>
            <FieldLabel>Coverage</FieldLabel>
            <Choice
              label="Coverage"
              value={coverage}
              onChange={setCoverage}
              placeholder="Select coverage"
              options={COVERAGE_OPTIONS.map((item) => ({
                value: item.id,
                label: item.label,
              }))}
            />
          </Field>
          <Field>
            <FieldLabel>Requested by</FieldLabel>
            <Choice
              label="Requested by"
              value={outreachId}
              onChange={setOutreachId}
              placeholder="Select provider"
              options={panel.outreaches.map((item) => ({
                value: item._id,
                label: item.brokerName,
              }))}
            />
          </Field>
          {!panel.outreaches.length && (
            <p
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Add a provider to this request first.
            </p>
          )}
        </FieldGroup>
      </form>
    </SettingsDrawer>
  );
}
