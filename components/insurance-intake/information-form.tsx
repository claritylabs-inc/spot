"use client";
import { useEffect, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { IntakeFrame } from "./frame";
import { COVERAGE_ICONS } from "./application-section-nav";
import { IntakeFollowups } from "./followups";
import {
  followupQuestionVisible,
  personalizeIntakeQuestion,
  type IntakeFollowupAnswer,
  formatIntakeFollowupAnswer,
} from "@/lib/intake-followups";
import { PillButton } from "@/components/ui/pill-button";
import { SuggestionSources } from "@/components/procurement/information/suggestion";
import { IntakeCheckboxCard } from "./details-fields";
import { Checkbox } from "@claritylabs-inc/ui/components/checkbox";
import { FileDropZone } from "@claritylabs-inc/ui/components/file-drop";
import { useBackgroundTasks } from "@claritylabs-inc/ui/components/background-tasks";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { COVERAGE_OPTIONS } from "@/lib/insurance-intake-details";
import { IntakeReviewRows } from "./company-review";
import { ReviewSection } from "./review-section";
import { IntakeSectionIntroduction } from "./section-introduction";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import { typeStyle } from "@/lib/typography";
import {
  informationCoverageGroups,
  orderInformationQuestions,
} from "@/lib/procurement-information";
import { ArrowRight, ChevronLeft, Paperclip } from "lucide-react";
import { toast } from "sonner";
import {
  useFollowedState,
  useIsFollowing,
  useLeaderOnly,
} from "@/hooks/use-followed-state";

type Form = FunctionReturnType<
  typeof api.procurementInformationForms.clientForm
>;
function coverageGroupLabel(coverage: string) {
  if (coverage === "unknown") return "Additional details";
  return (
    COVERAGE_OPTIONS.find((option) => option.id === coverage)?.label ??
    "Additional details"
  );
}

/** Unanswered questions start with their public-research suggestion; submitting confirms it. */
function prefillSuggestions(form: Form, responses: Form["responses"]) {
  const prefilled = form.questions.flatMap((q) => {
    const row = responses.find((r) => r.questionId === q.questionId);
    const answered =
      !!row && (row.answer.trim() || row.unsure || row.fileItemIds.length);
    return q.suggestion && !answered
      ? [
          {
            questionId: q.questionId,
            answer: q.suggestion.answer,
            unsure: false,
            fileItemIds: row?.fileItemIds ?? [],
          },
        ]
      : [];
  });
  return [
    ...responses.filter(
      (r) => !prefilled.some((p) => p.questionId === r.questionId),
    ),
    ...prefilled,
  ];
}

export function InformationForm({
  formId,
}: {
  formId: Id<"procurementInformationForms">;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const following = useIsFollowing();
  const viewer = useQuery(api.users.viewer, isAuthenticated ? {} : "skip");
  const needsLogin = !isLoading && (!isAuthenticated || viewer === null);
  const form = useQuery(
    api.procurementInformationForms.clientForm,
    isAuthenticated && viewer ? { formId } : "skip",
  );
  useEffect(() => {
    if (needsLogin)
      router.replace(
        `/login?next=${encodeURIComponent(`/intake/information/${formId}`)}`,
      );
  }, [needsLogin, router, formId]);
  if (!form)
    return (
      <IntakeFrame showSteps={false}>
        <p role="status">Loading your questions…</p>
      </IntakeFrame>
    );
  return (
    <FormEditor
      key={`${form.id}:${form.editDraft ? "editing" : form.status}:${following ? "following" : "own"}`}
      form={form}
    />
  );
}

function FormEditor({ form }: { form: Form }) {
  const router = useRouter();
  const [started, setStarted] = useFollowedState(
    `information-form:${form.id}:started`,
    !!form.editDraft,
  );
  const edit = useLeaderOnly(
    useMutation(api.procurementInformationForms.editForm),
  );
  const save = useLeaderOnly(
    useMutation(api.procurementInformationForms.saveForm),
  );
  const [responses, setResponses] = useState(() =>
    prefillSuggestions(form, form.editDraft?.responses ?? form.responses),
  );
  const [showFiles, setShowFiles] = useFollowedState(
    `information-form:${form.id}:files-open`,
    false,
  );
  const { tasks } = useBackgroundTasks();
  const uploading =
    tasks.get(`information-file:${form.id}`)?.status === "running";
  const revision = useRef(form.revision);
  const [step, setStep] = useFollowedState(
    `information-form:${form.id}:step`,
    0,
  );
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submitted = form.status === "submitted" && !form.editDraft;
  const displayedResponses = submitted ? form.responses : responses;
  const orderedQuestions = orderInformationQuestions(form.questions);
  const history: IntakeFollowupAnswer[] = orderedQuestions.map((q) => {
    const response = displayedResponses.find(
      (r) => r.questionId === q.questionId,
    );
    return {
      ...q.question,
      answer: response?.unsure ? "I'm not sure" : (response?.answer ?? ""),
    };
  });
  const visible = orderedQuestions.filter((q) =>
    followupQuestionVisible(q.question, history),
  );
  const current = visible[Math.min(step, visible.length - 1)];
  const reviewing = step >= visible.length;
  const firstUnanswered = visible.findIndex(
    (q) =>
      !responses.some(
        (r) =>
          r.questionId === q.questionId &&
          (r.answer.trim() || r.unsure || r.fileItemIds.length),
      ),
  );
  const reachableStep = firstUnanswered < 0 ? visible.length : firstUnanswered;
  const coverageGroups = informationCoverageGroups(visible);
  const autosave = useLocalFirstAutoSave({
    mutationName: "procurementInformationForms.saveForm",
    resetKey: form.id,
    args: responses,
    enabled: form.status === "open" || !!form.editDraft,
    canSave: !submitting,
    flush: async (rows) => {
      const next = await save({
        formId: form.id,
        revision: revision.current,
        responses: rows,
        submit: false,
      });
      revision.current = next;
      return next;
    },
    onError: (err) =>
      setError(
        getUserFacingErrorMessage(
          err,
          "Could not save. Your edits remain visible. Try again before leaving.",
        ),
      ),
    onFlushed: () => setError(""),
  });
  useEffect(() => {
    if (submitted || form.status === "cancelled" || autosave.status === "saved")
      return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [form.status, submitted, autosave.status]);
  const row =
    current && responses.find((r) => r.questionId === current.questionId);
  function change(
    questionId: Id<"procurementInformationQuestions">,
    answer: string,
    fileItemIds?: Id<"procurementFileItems">[],
  ) {
    setConfirmed(false);
    setResponses((rows) => {
      const prior = rows.find((r) => r.questionId === questionId);
      const next = {
        questionId,
        answer: answer === "I'm not sure" ? "" : answer,
        unsure: answer === "I'm not sure",
        fileItemIds: fileItemIds ?? prior?.fileItemIds ?? [],
      };
      return [...rows.filter((r) => r.questionId !== questionId), next];
    });
  }
  async function navigate(next: number) {
    if (await autosave.saveNow()) setStep(next);
  }
  async function submit() {
    if (!confirmed || !(await autosave.saveNow())) return;
    setSubmitting(true);
    setError("");
    try {
      revision.current = await save({
        formId: form.id,
        revision: revision.current,
        responses,
        submit: true,
        confirmed,
      });
    } catch (err) {
      setError(getUserFacingErrorMessage(err, "Could not submit your answers"));
    } finally {
      setSubmitting(false);
    }
  }
  if (form.status === "cancelled")
    return (
      <IntakeFrame
        showSteps={false}
        footer={
          <PillButton
            href={`/intake?request=${form.requestId}`}
            variant="ghost"
            size="large"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            Back to application
          </PillButton>
        }
      >
        <h1 className={typeStyle("heading.page")}>
          This form is no longer needed
        </h1>
        <p>
          Some details may have been updated. Spot will send a new form if more
          information is needed. Your previously saved responses remain on
          record.
        </p>
      </IntakeFrame>
    );
  if (!submitted && !started)
    return (
      <IntakeSectionIntroduction
        section={0}
        savings={false}
        showSteps={false}
        status="Saved"
        disabled={false}
        continueLabel="Continue"
        content={{
          title: "We have a few more questions to help get you better quotes",
          description:
            "Your insurance providers need a little more information. Answer what you can, then review your details before sending them to Spot. Your progress saves as you go.",
          topics: coverageGroups.map((group) => {
            const Icon =
              COVERAGE_ICONS[group.coverage as keyof typeof COVERAGE_ICONS] ??
              COVERAGE_ICONS.unknown;
            return {
              label:
                coverageGroupLabel(group.coverage),
              icon: (
                <Icon
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                />
              ),
            };
          }),
        }}
        onContinue={() => setStarted(true)}
        onBack={() => router.push(`/intake?request=${form.requestId}`)}
        onSection={() => {}}
      />
    );
  return (
    <IntakeFrame
      showSteps={!submitted}
      section={reviewing ? visible.length : step}
      steps={[
        ...visible.map((q, index) => ({
          label: personalizeIntakeQuestion(q.question.label, form.businessName),
          id: index,
          step: index,
          disabled: index > reachableStep,
        })),
        {
          label: "Review",
          id: visible.length,
          step: visible.length,
          disabled: reachableStep < visible.length,
        },
      ]}
      disabled={submitting || uploading}
      onSection={(next) => void navigate(next)}
      status={
        submitted
          ? "Submitted"
          : autosave.status === "error"
            ? "Needs attention"
            : autosave.status === "saving"
              ? "Saving…"
              : "Saved"
      }
      footer={
        submitted ? (
          <PillButton
            size="large"
            disabled={submitting}
            onClick={() => {
              setSubmitting(true);
              setError("");
              void edit({ formId: form.id, revision: revision.current })
                .catch((cause) =>
                  setError(
                    getUserFacingErrorMessage(cause, "Could not edit answers"),
                  ),
                )
                .finally(() => setSubmitting(false));
            }}
          >
            Edit answers
            <ArrowRight aria-hidden="true" className="size-4" />
          </PillButton>
        ) : (
          <>
            <PillButton
              variant="ghost"
              size="large"
              disabled={submitting || uploading}
              onClick={() => {
                if (step === 0 && form.editDraft) {
                  setSubmitting(true);
                  void autosave
                    .saveNow()
                    .then(async (saved) => {
                      if (saved)
                        await edit({
                          formId: form.id,
                          revision: revision.current,
                          discard: true,
                        });
                    })
                    .catch((cause) =>
                      setError(
                        getUserFacingErrorMessage(
                          cause,
                          "Could not cancel edits",
                        ),
                      ),
                    )
                    .finally(() => setSubmitting(false));
                } else if (step === 0) setStarted(false);
                else void navigate(step - 1);
              }}
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
              {step === 0 && form.editDraft ? "Cancel edits" : "Back"}
            </PillButton>
            {reviewing ? (
              <PillButton
                size="large"
                disabled={!confirmed || submitting || uploading}
                onClick={() => void submit()}
              >
                {submitting
                  ? "Submitting…"
                  : form.editDraft
                    ? "Resubmit answers"
                    : "Submit answers"}
              </PillButton>
            ) : (
              <PillButton
                size="large"
                disabled={
                  submitting ||
                  uploading ||
                  (!row?.answer.trim() &&
                    !row?.unsure &&
                    !row?.fileItemIds.length)
                }
                onClick={() => void navigate(step + 1)}
              >
                Continue
                <ArrowRight aria-hidden="true" className="size-4" />
              </PillButton>
            )}
          </>
        )
      }
    >
      <div className="space-y-6">
        {submitted && (
          <StatusTag tone="success" indicator="complete">
            Complete
          </StatusTag>
        )}
        {!submitted && !reviewing && current && (
          <div className="space-y-1">
            <p className={typeStyle("heading.item")}>
              {COVERAGE_OPTIONS.find((c) => c.id === current.scope.coverage)
                ?.label ?? "Additional details"}
            </p>
          </div>
        )}
        <h1 className={`text-wrap-pretty ${typeStyle("heading.display")}`}>
          {submitted
            ? "Your answers have been submitted"
            : reviewing
              ? "Review your additional details"
              : personalizeIntakeQuestion(
                  current?.question.label,
                  form.businessName,
                ) || form.title}
        </h1>
        {submitted && (
          <p className="text-muted-foreground">
            Spot will use these details to continue your insurance request.
          </p>
        )}
        {error && (
          <div role="alert">
            <p className="text-destructive">{error}</p>
            <PillButton
              variant="secondary"
              onClick={() => void autosave.saveNow({ force: true })}
            >
              Retry saving
            </PillButton>
          </div>
        )}
        {submitted || reviewing ? (
          <>
            <div data-review-content className="divide-y divide-border">
              {coverageGroups.map((group) => (
                <ReviewSection
                  key={group.coverage}
                  collapsible={coverageGroups.length > 1}
                  title={
                    coverageGroupLabel(group.coverage)
                  }
                  step={visible.findIndex(
                    (q) => q.questionId === group.questions[0].questionId,
                  )}
                  onEdit={submitted ? undefined : (next) => void navigate(next)}
                  complete={group.questions.every((q) =>
                    displayedResponses.some(
                      (r) =>
                        r.questionId === q.questionId &&
                        (!!r.answer.trim() ||
                          r.unsure ||
                          !!r.fileItemIds.length),
                    ),
                  )}
                >
                  <IntakeReviewRows
                    rows={group.questions.map((q) => {
                      const answer = displayedResponses.find(
                        (r) => r.questionId === q.questionId,
                      );
                      return {
                        label: personalizeIntakeQuestion(
                          q.question.label,
                          form.businessName,
                        ),
                        value: (
                          <div className="space-y-1">
                            <div>
                              {answer?.unsure
                                ? "I'm not sure"
                                : answer?.answer
                                  ? formatIntakeFollowupAnswer(
                                      { ...q.question, answer: answer.answer },
                                      q.scope.currency ?? form.currency,
                                    )
                                  : answer?.fileItemIds.length
                                    ? "Supporting files provided"
                                    : "No answer"}
                            </div>
                            {answer?.fileItemIds.map((id) => (
                              <div key={id} className="text-muted-foreground">
                                {form.files.find((f) => f.id === id)?.name ??
                                  "Supporting file"}
                              </div>
                            ))}
                          </div>
                        ),
                      };
                    })}
                  />
                </ReviewSection>
              ))}
            </div>
            {!submitted && (
              <IntakeCheckboxCard
                id="supplement-confirmation"
                label="I confirm these additional answers are accurate to the best of my knowledge."
                checked={confirmed}
                onCheckedChange={setConfirmed}
              />
            )}
          </>
        ) : (
          current && (
            <>
              <div className="pt-4 sm:pt-6">
                <IntakeFollowups
                  question={current.question}
                  status="ready"
                  answers={history}
                  businessName={form.businessName}
                  answer={row?.unsure ? "I'm not sure" : (row?.answer ?? "")}
                  onChange={(_, value) => change(current.questionId, value)}
                />
                {current.suggestion &&
                  row?.answer === current.suggestion.answer && (
                    <div
                      className={`mt-3 space-y-1 text-muted-foreground ${typeStyle("caption.default")}`}
                    >
                      <p>Suggested from public sources</p>
                      <SuggestionSources
                        citations={current.suggestion.citations}
                      />
                    </div>
                  )}
              </div>
              <div className="space-y-3">
                <PillButton
                  variant="ghost"
                  onClick={() => setShowFiles((open) => !open)}
                  aria-expanded={showFiles}
                >
                  <Paperclip className="size-3.5" />
                  {row?.fileItemIds.length
                    ? `${row.fileItemIds.length} supporting ${row.fileItemIds.length === 1 ? "file" : "files"}`
                    : "Add supporting files (optional)"}
                </PillButton>
                {showFiles && (
                  <>
                    {form.files.map((file) => (
                      <label className="flex items-center gap-3" key={file.id}>
                        <Checkbox
                          checked={row?.fileItemIds.includes(file.id) ?? false}
                          onCheckedChange={(checked) =>
                            change(
                              current.questionId,
                              row?.unsure
                                ? "I'm not sure"
                                : (row?.answer ?? ""),
                              checked
                                ? [...(row?.fileItemIds ?? []), file.id]
                                : (row?.fileItemIds.filter(
                                    (id) => id !== file.id,
                                  ) ?? []),
                            )
                          }
                        />
                        {file.name}
                      </label>
                    ))}
                    <SupportingUpload
                      form={form}
                      onUploaded={(id) => {
                        setConfirmed(false);
                        setResponses((rows) => {
                          const previous = rows.find(
                            (r) => r.questionId === current.questionId,
                          );
                          return [
                            ...rows.filter(
                              (r) => r.questionId !== current.questionId,
                            ),
                            {
                              questionId: current.questionId,
                              answer: previous?.answer ?? "",
                              unsure: previous?.unsure ?? false,
                              fileItemIds: [
                                ...new Set([
                                  ...(previous?.fileItemIds ?? []),
                                  id,
                                ]),
                              ],
                            },
                          ];
                        });
                      }}
                    />
                  </>
                )}
              </div>
            </>
          )
        )}
      </div>
    </IntakeFrame>
  );
}

function SupportingUpload({
  form,
  onUploaded,
}: {
  form: Form;
  onUploaded: (id: Id<"procurementFileItems">) => void;
}) {
  const uploadUrl = useMutation(api.procurementInformationForms.uploadUrl);
  const attach = useMutation(api.procurementInformationForms.attachFile);
  const { run, tasks } = useBackgroundTasks();
  const taskId = `information-file:${form.id}`;
  return (
    <FileDropZone
      idleLabel="Add supporting file"
      hint="PDF, PNG, JPEG or DOCX, up to 20 MB."
      accept=".pdf,.png,.jpg,.jpeg,.docx"
      disabled={tasks.get(taskId)?.status === "running"}
      onFile={(file) => {
        if (file.size > 20 * 1024 * 1024) {
          toast.error("Choose a file up to 20 MB");
          return;
        }
        void run({
          id: taskId,
          title: "Adding supporting file",
          successTitle: "File added",
          errorTitle: "Could not add file",
          execute: async (report) => {
            report({ message: "Uploading file" });
            const intent = await uploadUrl({ formId: form.id });
            const result = await fetch(intent.url, {
              method: "POST",
              headers: {
                "Content-Type": file.type || "application/octet-stream",
              },
              body: file,
            });
            if (!result.ok) throw new Error("Upload failed");
            const { storageId } = (await result.json()) as {
              storageId: Id<"_storage">;
            };
            report({ message: "Attaching supporting file" });
            const attached = await attach({
              formId: form.id,
              intentId: intent.intentId,
              storageId,
              fileName: file.name,
            });
            onUploaded(attached.fileItemId);
          },
        });
      }}
    />
  );
}

export function ClientInformationForms({
  requestId,
}: {
  requestId: Id<"procurementRequests">;
}) {
  const forms = useQuery(api.procurementInformationForms.clientForms, {
    requestId,
  });
  const open = forms?.filter((f) => f.status === "open") ?? [];
  if (!open.length) return null;
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <p className={typeStyle("heading.item")}>
        A few more details are needed for your quotes
      </p>
      {open.map((f) => (
        <PillButton key={f.id} href={`/intake/information/${f.id}`}>
          {f.title}
        </PillButton>
      ))}
    </div>
  );
}
