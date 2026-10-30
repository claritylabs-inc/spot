"use client";
import { useMutation, useQuery } from "convex/react";
import {
  informationApplicability,
  informationCoverageGroups,
} from "@/lib/procurement-information";
import { toast } from "sonner";
import { Mail, Link2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { formatIntakeFollowupAnswer } from "@/lib/intake-followups";
import { typeStyle } from "@/lib/typography";
import { InlineFieldCard, InlineFieldRow } from "@/components/ui/inline-fields";
import { PillButton } from "@/components/ui/pill-button";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import {
  OperationalPanel,
  OperationalSkeletonList,
} from "@claritylabs-inc/ui/components/operational-panel";
import { EmptyStateCard } from "@claritylabs-inc/ui/components/empty-state-card";
import {
  type Panel,
  type Actions,
  coverageLabel,
  invitationQuestions,
  attempt,
} from "./shared";
import { InformationProviders } from "./providers";
import { InformationAttachments } from "./attachments";
import { PublishForm } from "./publish-form";
import { InlineInformationAnswer } from "./inline-answer";
import { useInformationSuggestions } from "./suggestion";

type InformationForm = Panel["forms"][number];

export function InformationFormActions(
  props: Actions & { form: InformationForm; businessName?: string },
) {
  const cancel = useMutation(api.procurementInformationForms.cancelForm);
  const { form } = props;
  return (
    <>
      {form.status !== "cancelled" && (
        <PillButton
          variant="secondary"
          onClick={() =>
            void attempt(async () => {
              await navigator.clipboard.writeText(
                `${window.location.origin}/intake/information/${form._id}`,
              );
              toast.success("Form link copied");
            })
          }
        >
          <Link2 className="size-3.5" />
          Copy link
        </PillButton>
      )}
      {form.email?.threadId ? (
        <PillButton href={`${props.inboxHref}&thread=${form.email.threadId}`}>
          <Mail className="size-3.5" />
          View email
        </PillButton>
      ) : form.status !== "cancelled" && !form.email ? (
        <PillButton
          onClick={() =>
            props.onAskClient(
              form._id,
              invitationQuestions(form.questions, props.businessName),
              form.title,
            )
          }
        >
          <Mail className="size-3.5" />
          Email client
        </PillButton>
      ) : null}
      {form.status === "open" && (
        <PillButton
          variant="destructive"
          onClick={() =>
            void attempt(async () => {
              await cancel({ formId: form._id });
              toast.success("Form cancelled");
            })
          }
        >
          Cancel form
        </PillButton>
      )}
    </>
  );
}

export function InformationFormWorkspace(
  props: Actions & { selectedForm: string },
) {
  const panel = useQuery(api.procurementInformation.panel, {
    requestId: props.requestId,
  });
  const { suggestions } = useInformationSuggestions(
    props.requestId,
    props.readOnly,
  );
  if (!panel)
    return (
      <OperationalPanel>
        <OperationalSkeletonList rows={4} />
      </OperationalPanel>
    );
  if (props.selectedForm === "new")
    return props.readOnly ? null : (
      <div className="space-y-5">
        <h2 className={typeStyle("heading.item")}>Add form</h2>
        <PublishForm
          key={panel.forms.map((form) => form._id).join(":")}
          requestId={props.requestId}
          panel={panel}
          onDone={props.onAskClient}
        />
      </div>
    );
  const form = panel.forms.find((form) => form._id === props.selectedForm);
  if (!form)
    return (
      <EmptyStateCard
        title="Form not found"
        description="Select a form from Information needed to view its questions and email."
      />
    );
  return (
    <div className="space-y-6">
      {informationCoverageGroups(form.questions).map((group, index) => (
        <section
          key={group.coverage}
          data-operator-inline-fields
          className="space-y-4"
          aria-label={coverageLabel(group.coverage)}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className={typeStyle("heading.item")}>
              {coverageLabel(group.coverage)}
            </h3>
            {index === 0 && (
              <StatusTag
                tone={form.status === "submitted" ? "success" : "neutral"}
                indicator={
                  form.status === "submitted"
                    ? "complete"
                    : form.status === "cancelled"
                      ? "cancelled"
                      : "waiting"
                }
              >
                {form.status === "submitted"
                  ? "Submitted"
                  : form.status === "cancelled"
                    ? "Cancelled"
                    : "Awaiting submission"}
              </StatusTag>
            )}
          </div>
          {group.questions.map((item) => {
            const response = form.responses.find(
              (r) => r.questionId === item.questionId,
            );
            const fact = panel.questions.find((q) => q._id === item.questionId);
            const answer = fact?.answer ?? response;
            return (
              <InlineFieldCard
                key={item.questionId}
                title={
                  <span className="block min-w-0 py-0.5">
                    <span className="block">{item.question.label}</span>
                    {item.scope.period !== "current" && (
                      <span
                        className={`mt-1 block text-muted-foreground ${typeStyle("caption.default")}`}
                      >
                        {item.scope.period}
                      </span>
                    )}
                  </span>
                }
              >
                <InlineFieldRow label="Answer">
                  {form.status !== "cancelled" && fact ? (
                    <InlineInformationAnswer
                      question={fact}
                      files={panel.files}
                      currency={panel.currency}
                      disabled={
                        props.readOnly ||
                        informationApplicability(fact, panel.questions) !==
                          "applies"
                      }
                      suggestion={suggestions.get(fact._id)}
                    />
                  ) : (
                    <div className="min-w-0">
                      <div className="px-3 py-2 whitespace-pre-wrap break-words">
                        {answer?.unsure
                          ? "I'm not sure"
                          : answer?.answer
                            ? formatIntakeFollowupAnswer(
                                { ...item.question, answer: answer.answer },
                                item.scope.currency ?? panel.currency,
                              )
                            : "Awaiting answer"}
                      </div>
                      <InformationAttachments
                        ids={answer?.fileItemIds ?? []}
                        files={panel.files}
                      />
                    </div>
                  )}
                </InlineFieldRow>
                <InlineFieldRow label="Requested by">
                  <div className="flex min-h-9 flex-wrap items-center gap-x-8 gap-y-2 border border-transparent px-3 py-1">
                    <InformationProviders
                      panel={panel}
                      questionId={item.questionId}
                    />
                    {!panel.requirements.some(
                      (requirement) =>
                        requirement.questionId === item.questionId,
                    ) && (
                      <span className="text-muted-foreground">
                        No provider specified
                      </span>
                    )}
                  </div>
                </InlineFieldRow>
              </InlineFieldCard>
            );
          })}
        </section>
      ))}
    </div>
  );
}
