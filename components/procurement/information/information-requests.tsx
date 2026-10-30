"use client";
import { useState } from "react";
import { useFollowedState } from "@/hooks/use-followed-state";
import { useMutation, useQuery } from "convex/react";
import {
  informationApplicability,
  informationCoverageGroups,
} from "@/lib/procurement-information";
import { toast } from "sonner";
import { Plus, FileQuestion, RefreshCw } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { typeStyle } from "@/lib/typography";
import { InlineFieldCard, InlineFieldRow } from "@/components/ui/inline-fields";
import { PillButton } from "@/components/ui/pill-button";
import { RemoveButton } from "@/components/ui/remove-button";
import { ListToolbar } from "@/components/ui/list-toolbar";
import {
  OperationalPanel,
  OperationalSkeletonList,
} from "@claritylabs-inc/ui/components/operational-panel";
import { EmptyStateCard } from "@claritylabs-inc/ui/components/empty-state-card";
import { type Actions, coverageLabel, displaySubject, attempt } from "./shared";
import { InformationProviders } from "./providers";
import { InformationFormActions } from "./form-workspace";
import { InlineInformationAnswer } from "./inline-answer";
import {
  InformationResearchStatus,
  ResearchSourcesAction,
  useInformationSuggestions,
} from "./suggestion";

export function InformationRequestActions(props: Actions) {
  const { requestId, readOnly, onOpenDrawer: open } = props;
  const panel = useQuery(api.procurementInformation.panel, { requestId });
  const syncInbox = useMutation(api.procurementInformationEmail.syncInbox);
  const [syncing, setSyncing] = useState(false);
  if (readOnly || !panel) return null;
  if (props.selectedForm) {
    const form = panel.forms.find((form) => form._id === props.selectedForm);
    return form ? (
      <InformationFormActions
        {...props}
        form={form}
        businessName={panel.businessName}
      />
    ) : null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PillButton
        variant="secondary"
        disabled={syncing}
        onClick={() =>
          void attempt(async () => {
            setSyncing(true);
            try {
              const result = await syncInbox({ requestId });
              toast.success(
                `Checking ${result.checked} recent replies. New replies are processed automatically.`,
              );
            } finally {
              setSyncing(false);
            }
          })
        }
      >
        <RefreshCw className={`size-3.5${syncing ? " animate-spin" : ""}`} />
        Sync from email
      </PillButton>
      <ResearchSourcesAction requestId={requestId} />
      <PillButton variant="primary" onClick={() => open({ kind: "add" })}>
        <Plus className="size-3.5" />
        Add question
      </PillButton>
    </div>
  );
}

export function InformationRequests(props: Actions) {
  const { requestId, readOnly, onOpenDrawer: open } = props;
  const panel = useQuery(api.procurementInformation.panel, { requestId });
  const archive = useMutation(api.procurementInformation.archiveQuestion);
  const { suggestions } = useInformationSuggestions(requestId, readOnly);
  const [search, setSearch] = useFollowedState(
    `procurement:${requestId}:information:search`,
    "",
  );
  const [view, setView] = useFollowedState(
    `procurement:${requestId}:information:tab`,
    "draft",
  );
  if (!panel)
    return (
      <OperationalPanel>
        <OperationalSkeletonList rows={3} />
      </OperationalPanel>
    );
  const assignedQuestionIds = new Set(
    panel.forms
      .filter((form) => form.status !== "cancelled")
      .flatMap((form) => form.questions.map((item) => item.questionId)),
  );
  const applicableQuestions = panel.questions.filter(
    (q) => informationApplicability(q, panel.questions) !== "not_applicable",
  );
  const unassignedQuestions = applicableQuestions.filter(
    (q) => !assignedQuestionIds.has(q._id),
  );
  const tabQuestions =
    view === "all" ? applicableQuestions : unassignedQuestions;
  const visible = tabQuestions.filter((q) =>
    q.question.label.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="space-y-5">
      <ListToolbar
        followKey={`procurement:${requestId}:information`}
        search={applicableQuestions.length > 0 ? {
          value: search,
          onChange: setSearch,
          label: "Search questions",
          placeholder: "Search questions",
        } : undefined}
        filters={[{
          id: "status",
          label: "Status",
          inline: true,
          value: view === "all" ? [] : ["draft"],
          onChange: (value) => setView(value[0] ?? "all"),
          options: [{ value: "draft", label: "Draft" }],
        }]}
      />
      <div className="space-y-5">
        {(panel.emailActivity.running > 0 ||
          panel.emailActivity.needsReview > 0) && (
          <p
            role="status"
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            {panel.emailActivity.running > 0 ? "Reading recent replies… " : ""}
            {panel.emailActivity.needsReview > 0
              ? "Some replies need review. Check the inbox or add missing information manually."
              : ""}
            {panel.emailActivity.needsReview > 0 && (
              <PillButton href={props.inboxHref} variant="ghost" size="compact">
                Review inbox
              </PillButton>
            )}
          </p>
        )}
        {!readOnly && <InformationResearchStatus requestId={requestId} />}
        {!tabQuestions.length ? (
          <EmptyStateCard
            icon={<FileQuestion className="size-6" />}
            title={
              applicableQuestions.length
                ? "All questions are in forms"
                : "Keep quote questions in one place"
            }
            description={
              applicableQuestions.length
                ? "Open a form in the sidebar to view its questions, or add a new question here."
                : "Add what a provider needs, combine overlapping questions, and send your client one short form."
            }
          />
        ) : !visible.length ? (
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            No questions match your search.
          </p>
        ) : (
          informationCoverageGroups(visible).map((group) => (
            <section
              key={group.coverage}
              data-operator-inline-fields
              className="space-y-4"
              aria-label={coverageLabel(group.coverage)}
            >
              <h2 className={typeStyle("heading.item")}>
                {coverageLabel(group.coverage)}
              </h2>
              {group.questions.map((q) => {
                const applicability = informationApplicability(
                  q,
                  panel.questions,
                );
                return (
                  <InlineFieldCard
                    key={q._id}
                    title={
                      <span className="block min-w-0 py-0.5">
                        <span className="block">{q.question.label}</span>
                        <span
                          className={`mt-1 block text-muted-foreground ${typeStyle("caption.default")}`}
                        >
                          {[
                            displaySubject(q),
                            q.scope.period !== "current"
                              ? q.scope.period
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    }
                    actions={
                      !readOnly ? (
                        <div className="flex shrink-0 items-center gap-2">
                          <RemoveButton
                            label={`Remove ${q.question.label}`}
                            onClick={() =>
                              void attempt(async () => {
                                await archive({
                                  questionId: q._id,
                                  archive: true,
                                });
                                toast.success("Question removed", {
                                  action: {
                                    label: "Undo",
                                    onClick: () =>
                                      void attempt(() =>
                                        archive({
                                          questionId: q._id,
                                          archive: false,
                                        }),
                                      ),
                                  },
                                });
                              })
                            }
                          />
                        </div>
                      ) : undefined
                    }
                  >
                    <InlineFieldRow label="Answer">
                      <InlineInformationAnswer
                        key={q._id}
                        question={q}
                        files={panel.files}
                        currency={panel.currency}
                        disabled={readOnly || applicability !== "applies"}
                        suggestion={suggestions.get(q._id)}
                      />
                    </InlineFieldRow>
                    <InlineFieldRow label="Requested by">
                      <div className="flex min-h-9 flex-wrap items-center gap-x-8 gap-y-2 border border-transparent px-3 py-1">
                        <InformationProviders
                          panel={panel}
                          questionId={q._id}
                        />
                        {!readOnly && (
                          <PillButton
                            variant="ghost"
                            onClick={() =>
                              open({ kind: "add", questionId: q._id })
                            }
                          >
                            <Plus className="size-3.5" />
                            Add provider
                          </PillButton>
                        )}
                      </div>
                    </InlineFieldRow>
                  </InlineFieldCard>
                );
              })}
            </section>
          ))
        )}
        {(panel.threadsLimited || panel.deliveriesLimited) && (
          <p
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Showing the latest 50 email threads and 500 delivery records. Older
            correspondence remains in the inbox.
          </p>
        )}
      </div>
    </div>
  );
}
