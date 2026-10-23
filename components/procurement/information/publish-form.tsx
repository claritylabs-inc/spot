"use client";
import { useState } from "react";
import { useFollowedState } from "@/hooks/use-followed-state";
import { useMutation } from "convex/react";
import {
  neededInformationQuestions,
  informationCoverageGroups,
  informationFormTitle,
} from "@/lib/procurement-information";
import { toast } from "sonner";
import dayjs from "dayjs";
import { Mail, FileQuestion } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { typeStyle } from "@/lib/typography";
import { PillButton } from "@/components/ui/pill-button";
import { Checkbox } from "@claritylabs-inc/ui/components/checkbox";
import {
  OperationalPanel,
  OperationalItem,
} from "@claritylabs-inc/ui/components/operational-panel";
import { EmptyStateCard } from "@claritylabs-inc/ui/components/empty-state-card";
import {
  type Panel,
  type Question,
  type Actions,
  coverageLabel,
  invitationQuestions,
  attempt,
} from "./shared";

export function PublishForm({
  requestId,
  panel,
  onDone,
}: {
  requestId: Actions["requestId"];
  panel: Panel;
  onDone: (
    id: Id<"procurementInformationForms">,
    questions: string[],
    title?: string,
  ) => void;
}) {
  const publish = useMutation(api.procurementInformationForms.publishForm);
  const assigned = new Set(
    panel.forms
      .filter((form) => form.status === "open")
      .flatMap((form) => form.questions.map((q) => String(q.questionId))),
  );
  const available = neededInformationQuestions(
    panel.questions,
    panel.requirements,
  );
  const eligible = (q: Question, path = new Set<string>()): boolean => {
    if (assigned.has(q._id) || path.has(q._id)) return false;
    const next = new Set(path).add(q._id);
    return (q.question.conditions ?? []).every((condition) => {
      const parent = available.find(
        (item) => item._id === condition.questionId,
      );
      return !parent || eligible(parent, next);
    });
  };
  const candidates = available.filter((q) => eligible(q));
  const [selected, setSelected] = useFollowedState<string[]>(
    `procurement:${requestId}:information:new-form:selected`,
    () => candidates.map((q) => q._id),
  );
  const selectedIds = new Set(selected);
  const addParents = (q: Question) => {
    for (const condition of q.question.conditions ?? []) {
      const parent = candidates.find(
        (item) => item._id === condition.questionId,
      );
      if (parent && !selectedIds.has(parent._id)) {
        selectedIds.add(parent._id);
        addParents(parent);
      }
    }
  };
  candidates.filter((q) => selectedIds.has(q._id)).forEach(addParents);
  const needed = candidates.filter((q) => selectedIds.has(q._id));
  function toggle(id: string, checked: boolean) {
    if (checked) {
      setSelected([...selectedIds, id]);
      return;
    }
    const removed = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const q of candidates)
        if (
          !removed.has(q._id) &&
          q.question.conditions?.some((condition) =>
            removed.has(condition.questionId),
          )
        ) {
          removed.add(q._id);
          changed = true;
        }
    }
    setSelected([...selectedIds].filter((value) => !removed.has(value)));
  }
  const [createdAt] = useState(() => dayjs().valueOf());
  const title = informationFormTitle({ _id: "new", createdAt }, panel.forms);
  const [busy, setBusy] = useState(false);
  if (!candidates.length)
    return (
      <EmptyStateCard
        icon={<FileQuestion className="size-6" />}
        title="No questions ready for a new form"
        description="Add questions or finish the open form first."
      />
    );

  return (
    <div className="space-y-4">
      {informationCoverageGroups(candidates).map((group) => (
        <section key={group.coverage} className="space-y-3">
          <h3 className={typeStyle("heading.item")}>
            {coverageLabel(group.coverage)}
          </h3>
          <OperationalPanel>
            {group.questions.map((q) => (
              <OperationalItem key={q._id}>
                <label className="flex cursor-pointer items-start gap-3">
                  <Checkbox
                    aria-label={`Include ${q.question.label}`}
                    checked={selectedIds.has(q._id)}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      toggle(q._id, checked === true)
                    }
                  />
                  <span className={typeStyle("body.medium")}>
                    {q.question.label}
                  </span>
                </label>
              </OperationalItem>
            ))}
          </OperationalPanel>
        </section>
      ))}
      <PillButton
        disabled={busy || !needed.length || needed.length > 40}
        onClick={() =>
          void attempt(async () => {
            setBusy(true);
            try {
              const id = await publish({
                requestId,
                title,
                questionIds: needed.map((q) => q._id),
              });
              toast.success("Client form ready");
              onDone(
                id,
                invitationQuestions(
                  needed.map((q) => ({
                    questionId: q._id,
                    question: q.question,
                    scope: q.scope,
                  })),
                  panel.businessName,
                ),
                title,
              );
            } finally {
              setBusy(false);
            }
          })
        }
      >
        <Mail className="size-3.5" />
        {busy ? "Creating form…" : "Create form & draft email"}
      </PillButton>
    </div>
  );
}
