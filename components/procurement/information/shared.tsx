"use client";
import type { FunctionReturnType } from "convex/server";
import { informationCoverageGroups } from "@/lib/procurement-information";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { COVERAGE_OPTIONS } from "@/lib/insurance-intake-details";
import {
  personalizeIntakeQuestion,
  type IntakeFollowupQuestion,
} from "@/lib/intake-followups";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

export type Panel = FunctionReturnType<typeof api.procurementInformation.panel>;
export type Question = Panel["questions"][number];
export type Suggestion = FunctionReturnType<
  typeof api.procurementInformationSuggestions.listForRequest
>["suggestions"][number];
export const KINDS: IntakeFollowupQuestion["kind"][] = [
  "short_text",
  "long_text",
  "yes_no",
  "number",
  "currency",
  "date",
  "dropdown",
  "routes",
];
export const KIND_LABELS = {
  short_text: "Short answer",
  long_text: "Long answer",
  yes_no: "Yes / No",
  number: "Number",
  currency: "Amount",
  date: "Date",
  dropdown: "Choose an option",
  routes: "Routes",
};
export function coverageLabel(id: string) {
  return COVERAGE_OPTIONS.find((c) => c.id === id)?.label ?? "Other coverage";
}
export function invitationQuestions(
  questions: {
    questionId: string;
    question: IntakeFollowupQuestion;
    scope?: { coverage: string };
  }[],
  businessName?: string,
) {
  const scoped = questions.filter(
    (q): q is (typeof questions)[number] & { scope: { coverage: string } } =>
      !!q.scope,
  );
  const ordered =
    scoped.length === questions.length
      ? informationCoverageGroups(scoped).flatMap((group) => group.questions)
      : questions;
  return ordered.map((item) => {
    const conditions = (item.question.conditions ?? []).flatMap((condition) => {
      const parent = questions.find(
        (parent) => parent.questionId === condition.questionId,
      );
      return parent
        ? [
            `If your answer to “${personalizeIntakeQuestion(parent.question.label, businessName)}” is ${condition.answer}`,
          ]
        : [];
    });
    return [
      personalizeIntakeQuestion(item.question.label, businessName),
      ...conditions,
    ].join("\n");
  });
}
export function displaySubject(q: Question) {
  const words = q.scope.subject
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3);
  return q.scope.subject === "company" ||
    (words.length > 0 &&
      words.every((word) => q.question.label.toLowerCase().includes(word)))
    ? null
    : q.scope.subject;
}
export function Choice<V extends string>({
  value,
  onChange,
  options,
  label,
  disabled = false,
  placeholder,
}: {
  value: V | "";
  onChange: (v: V) => void;
  options: { value: V; label: string }[];
  label: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <Select<V>
      value={value || null}
      onValueChange={(v) => v && onChange(v)}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder={placeholder ?? label}>
          {options.find((o) => o.value === value)?.label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export async function attempt(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    toast.error(
      getUserFacingErrorMessage(error, "Could not update information request"),
    );
  }
}
export type InformationDrawerTarget = {
  kind: "add";
  questionId?: Question["_id"];
  mode?: "email";
};
export type Actions = {
  requestId: Id<"procurementRequests">;
  readOnly: boolean;
  onAskClient: (
    id: Id<"procurementInformationForms">,
    questions: string[],
    title?: string,
  ) => void;
  onOpenDrawer: (target: InformationDrawerTarget) => void;
  inboxHref: string;
  selectedForm?: string | null;
};
