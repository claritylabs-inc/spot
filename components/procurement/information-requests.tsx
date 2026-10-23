"use client";
import { useState, useRef, useEffect, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  informationApplicability,
  neededInformationQuestions,
  informationCoverageGroups,
  informationFormTitle,
} from "@/lib/procurement-information";
import { toast } from "sonner";
import dayjs from "dayjs";
import {
  Plus,
  Mail,
  Link2,
  FileQuestion,
  RefreshCw,
  Search,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { COVERAGE_OPTIONS } from "@/lib/insurance-intake-details";
import {
  formatIntakeFollowupAnswer,
  personalizeIntakeQuestion,
  type IntakeFollowupQuestion,
} from "@/lib/intake-followups";
import { formatDisplayDate } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import {
  InlineFieldCard,
  InlineFieldRow,
  InlineFieldList,
} from "@/components/ui/inline-fields";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { RemoveButton } from "@/components/ui/remove-button";
import { ChatAttachmentChip } from "@/components/chat/attachment-chip";
import { IntakeValueInput } from "@/components/insurance-intake/details-fields";
import { RouteInput } from "@/components/ui/route-input";
import { InlineFieldsContext } from "@/components/ui/inline-fields";
import { emptyRouteValue, parseRouteValue } from "@/lib/route-input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupInput,
} from "@claritylabs-inc/ui/components/input-group";
import { Checkbox } from "@claritylabs-inc/ui/components/checkbox";
import { Input } from "@claritylabs-inc/ui/components/input";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import {
  OperationalPanel,
  OperationalItem,
  OperationalSkeletonList,
} from "@claritylabs-inc/ui/components/operational-panel";
import { EmptyStateCard } from "@claritylabs-inc/ui/components/empty-state-card";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

type Panel = FunctionReturnType<typeof api.procurementInformation.panel>;
type Question = Panel["questions"][number];
const KINDS: IntakeFollowupQuestion["kind"][] = [
  "short_text",
  "long_text",
  "yes_no",
  "number",
  "currency",
  "date",
  "dropdown",
  "routes",
];
const KIND_LABELS = {
  short_text: "Short answer",
  long_text: "Long answer",
  yes_no: "Yes / No",
  number: "Number",
  currency: "Amount",
  date: "Date",
  dropdown: "Choose an option",
  routes: "Routes",
};
function coverageLabel(id: string) {
  return COVERAGE_OPTIONS.find((c) => c.id === id)?.label ?? "Other coverage";
}
function invitationQuestions(
  questions: {
    questionId: string;
    question: IntakeFollowupQuestion;
    scope?: { coverage: string };
  }[],
  businessName?: string,
) {
  const ordered = questions.every((q) => q.scope)
    ? informationCoverageGroups(
        questions as ((typeof questions)[number] & {
          scope: { coverage: string };
        })[],
      ).flatMap((group) => group.questions)
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
function displaySubject(q: Question) {
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
function Choice({
  value,
  onChange,
  options,
  label,
  disabled = false,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <Select
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
async function attempt(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    toast.error(
      getUserFacingErrorMessage(error, "Could not update information request"),
    );
  }
}
type DrawerTarget = {
  kind: "add";
  questionId?: Question["_id"];
  mode?: "email";
};
type Actions = {
  requestId: Id<"procurementRequests">;
  readOnly: boolean;
  onAskClient: (
    id: Id<"procurementInformationForms">,
    questions: string[],
    title?: string,
  ) => void;
  onRightPanel: (panel: ReactNode) => void;
  inboxHref: string;
  selectedForm?: string | null;
};

export function InformationRequestActions(props: Actions) {
  const { requestId, readOnly, onRightPanel } = props;
  const panel = useQuery(api.procurementInformation.panel, { requestId });
  const syncInbox = useMutation(api.procurementInformation.syncInbox);
  const [syncing, setSyncing] = useState(false);
  const open = (target: DrawerTarget) =>
    onRightPanel(
      <InformationDrawer
        key={JSON.stringify(target)}
        {...props}
        target={target}
        onClose={() => onRightPanel(null)}
      />,
    );
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
    <>
      <div className="flex flex-wrap items-center gap-2">
        <PillButton
          variant="icon"
          label="Sync latest provider and client replies"
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
          <RefreshCw className="size-3.5" />
        </PillButton>
        <PillButton
          variant="secondary"
          onClick={() => open({ kind: "add", mode: "email" })}
        >
          <Mail className="size-3.5" />
          From email
        </PillButton>
        <PillButton variant="secondary" onClick={() => open({ kind: "add" })}>
          <Plus className="size-3.5" />
          Add question
        </PillButton>
      </div>
    </>
  );
}

export function InformationRequests(props: Actions) {
  const { requestId, readOnly, onRightPanel } = props;
  const panel = useQuery(api.procurementInformation.panel, { requestId });
  const archive = useMutation(api.procurementInformation.archiveQuestion);
  const [search, setSearch] = useState("");
  const open = (target: DrawerTarget) =>
    onRightPanel(
      <InformationDrawer
        key={JSON.stringify(target)}
        {...props}
        target={target}
        onClose={() => onRightPanel(null)}
      />,
    );
  if (!panel)
    return (
      <OperationalPanel>
        <OperationalSkeletonList rows={3} />
      </OperationalPanel>
    );
  const openForms = panel.forms.filter((f) => f.status === "open");
  const applicableQuestions = panel.questions.filter(
    (q) => informationApplicability(q, panel.questions) !== "not_applicable",
  );
  const visible = applicableQuestions.filter((q) =>
    q.question.label.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {applicableQuestions.length > 0 && (
          <InputGroup className="w-full sm:w-72">
            <InputGroupAddon>
              <Search aria-hidden="true" className="size-4" />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              aria-label="Search questions"
              placeholder="Search questions"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </InputGroup>
        )}
      </div>
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
      {!applicableQuestions.length ? (
        <EmptyStateCard
          icon={<FileQuestion className="size-6" />}
          title="Keep quote questions in one place"
          description="Add what a provider needs, combine overlapping questions, and send your client one short form."
          actionLabel={readOnly ? undefined : "Add a question"}
          onAction={() => open({ kind: "add" })}
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
              const requested = openForms.some((f) =>
                f.questions.some((item) => item.questionId === q._id),
              );
              const applicability = informationApplicability(
                q,
                panel.questions,
              );
              const answered =
                !!q.answer && !q.answer.unsure && applicability === "applies";
              return (
                <InlineFieldCard
                  key={q._id}
                  title={
                    <span className="block min-w-0 py-0.5">
                      <span className="flex flex-wrap items-start justify-between gap-2">
                        <span className="min-w-0 flex-1">
                          {q.question.label}
                        </span>
                        <StatusTag tone={answered ? "success" : "warning"}>
                          {answered
                            ? "Answered"
                            : requested
                              ? "Waiting for client"
                              : "Needs answer"}
                        </StatusTag>
                      </span>
                      <span
                        className={`mt-1 block text-muted-foreground ${typeStyle("caption.default")}`}
                      >
                        {[
                          displaySubject(q),
                          q.scope.period !== "current" ? q.scope.period : null,
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
                    />
                  </InlineFieldRow>
                  <InlineFieldRow label="Requested by">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-2">
                      <InformationProviders panel={panel} questionId={q._id} />
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
        <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
          Showing the latest 50 email threads and 500 delivery records. Older
          correspondence remains in the inbox.
        </p>
      )}
    </div>
  );
}

function InformationProviders({
  panel,
  questionId,
}: {
  panel: Panel;
  questionId: string;
}) {
  const requirements = panel.requirements.filter(
    (requirement) => requirement.questionId === questionId,
  );
  return (
    <>
      {Array.from(new Set(requirements.map((r) => r.outreachId))).map(
        (outreachId) => {
          const provider = panel.outreaches.find((o) => o._id === outreachId);
          const requirement = requirements.find(
            (r) => r.outreachId === outreachId,
          )!;
          return (
            <span
              key={outreachId}
              className="inline-flex min-w-0 items-center gap-2"
            >
              <OrgBrandIcon
                name={provider?.brokerName}
                iconUrl={provider?.iconUrl}
                website={provider?.website}
                size="xs"
              />
              <span>
                {provider?.brokerName ?? "Provider"}
                {requirement.carrier ? ` · ${requirement.carrier}` : ""}
              </span>
            </span>
          );
        },
      )}
    </>
  );
}

function InformationAttachments({
  ids,
  files,
}: {
  ids: readonly string[];
  files: Panel["files"];
}) {
  if (!ids.length) return null;
  return (
    <div
      className="flex flex-wrap gap-2 px-3 pb-2 pt-1"
      aria-label="Supporting documents"
    >
      {ids.map((id) => {
        const file = files.find((file) => file.id === id);
        return file ? <InformationAttachment key={id} file={file} /> : null;
      })}
    </div>
  );
}

function InformationAttachment({ file }: { file: Panel["files"][number] }) {
  const url = useQuery(api.clientFiles.getUrl, {
    clientFileId: file.clientFileId,
  });
  return (
    <ChatAttachmentChip
      attachment={{ filename: file.name, contentType: file.contentType }}
      url={url}
      isLoading={url === undefined}
      className="min-h-9 border border-border px-3"
    />
  );
}

type InformationForm = Panel["forms"][number];

function InformationFormActions(
  props: Actions & { form: InformationForm; businessName?: string },
) {
  const cancel = useMutation(api.procurementInformation.cancelForm);
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
      ) : form.status === "open" && !form.email ? (
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
      <div className="flex flex-wrap items-center gap-3">
        <h2 className={typeStyle("heading.item")}>{form.title}</h2>
        <StatusTag
          tone={
            form.status === "submitted"
              ? "success"
              : form.status === "open"
                ? "warning"
                : "neutral"
          }
        >
          {form.status === "submitted"
            ? "Submitted"
            : form.status === "open"
              ? form.email
                ? "Waiting for client"
                : "Ready to send"
              : "Cancelled"}
        </StatusTag>
      </div>
      <InlineFieldCard>
        <InlineFieldRow label="Created">
          {formatDisplayDate(form.createdAt)}
        </InlineFieldRow>
        <InlineFieldRow label="Questions">
          {form.questions.length}
        </InlineFieldRow>
        <InlineFieldRow label="Email">
          {form.email
            ? `${form.email.deliveryStatus === "sent" ? "Sent" : ({ active: "Queued", reply_check: "Checking reply", responded: "Reply received", completed: "Complete", stopped: "Follow-ups stopped", failed: "Needs attention" }[form.email.status])} · ${form.email.recipient}`
            : "Not sent"}
        </InlineFieldRow>
        {form.email && (
          <InlineFieldRow label="Subject">{form.email.subject}</InlineFieldRow>
        )}
      </InlineFieldCard>
      {informationCoverageGroups(form.questions).map((group) => (
        <section
          key={group.coverage}
          data-operator-inline-fields
          className="space-y-4"
          aria-label={coverageLabel(group.coverage)}
        >
          <h3 className={typeStyle("heading.item")}>
            {coverageLabel(group.coverage)}
          </h3>
          {group.questions.map((item) => {
            const response = form.responses.find(
              (r) => r.questionId === item.questionId,
            );
            const fact = panel.questions.find((q) => q._id === item.questionId);
            const answer =
              form.status === "submitted" ? response : fact?.answer;
            const answered = !!answer?.answer && !answer.unsure;
            return (
              <InlineFieldCard
                key={item.questionId}
                title={
                  <span className="block min-w-0 py-0.5">
                    <span className="flex flex-wrap items-start justify-between gap-2">
                      <span className="min-w-0 flex-1">
                        {item.question.label}
                      </span>
                      <StatusTag tone={answered ? "success" : "warning"}>
                        {answered
                          ? "Answered"
                          : form.status === "open"
                            ? "Waiting for client"
                            : "Needs answer"}
                      </StatusTag>
                    </span>
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
                  {form.status === "open" && fact ? (
                    <InlineInformationAnswer
                      question={fact}
                      files={panel.files}
                      currency={panel.currency}
                      disabled={
                        props.readOnly ||
                        informationApplicability(fact, panel.questions) !==
                          "applies"
                      }
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
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-2">
                    <InformationProviders
                      panel={panel}
                      questionId={item.questionId}
                    />
                    {!panel.requirements.some(
                      (requirement) =>
                        requirement.questionId === item.questionId,
                    ) && (
                      <span className="px-3 text-muted-foreground">
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

function InformationDrawer({
  target,
  onClose,
  ...props
}: Actions & { target: DrawerTarget; onClose: () => void }) {
  const panel = useQuery(api.procurementInformation.panel, {
    requestId: props.requestId,
  });
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

function PublishForm({
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
  const publish = useMutation(api.procurementInformation.publishForm);
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
  const [selected, setSelected] = useState<string[]>(() =>
    candidates.map((q) => q._id),
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
        description="Add questions in Information Needed, or finish an open batch before creating another form for those questions."
      />
    );

  return (
    <div className="space-y-4">
      <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
        Choose the questions for this batch. The client can answer by email or
        complete its form. Questions in another open form stay in that batch.
      </p>
      <InlineFieldList>
        <InlineFieldRow label="Form name">{title}</InlineFieldRow>
      </InlineFieldList>
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
      <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
        {needed.length} unanswered{" "}
        {needed.length === 1 ? "question" : "questions"} selected for this form.
        Unanswered prerequisites are included with dependent questions.
      </p>
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
function RequirementComposer({
  requestId,
  panel,
  onDone,
  initialQuestionId,
  mode,
}: {
  requestId: Id<"procurementRequests">;
  panel: Panel;
  onDone: () => void;
  initialQuestionId?: Question["_id"];
  mode?: "email";
}) {
  const add = useMutation(api.procurementInformation.addRequirement);
  const extract = useMutation(api.procurementInformation.startExtraction);
  const [outreachId, setOutreachId] = useState("");
  const [reuse, setReuse] = useState(initialQuestionId ?? "new");
  const [label, setLabel] = useState("");
  const [kind, setKind] =
    useState<IntakeFollowupQuestion["kind"]>("short_text");
  const [options, setOptions] = useState("");
  const [subject, setSubject] = useState("company");
  const [period, setPeriod] = useState("current");
  const [coverage, setCoverage] = useState("");
  const [currency, setCurrency] = useState(panel.currency);
  const [parentId, setParentId] = useState("");
  const [parentAnswer, setParentAnswer] = useState("Yes");
  const [carrier, setCarrier] = useState("");
  const [threadId, setThreadId] = useState("");
  const [messageId, setMessageId] = useState("");
  const [quote, setQuote] = useState("");
  const [existing, setExisting] = useState<string | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
  const [extractionId, setExtractionId] =
    useState<Id<"procurementInformationExtractions"> | null>(null);
  const extraction = useQuery(
    api.procurementInformation.extraction,
    extractionId ? { extractionId } : "skip",
  );
  const proposals = extraction?.questions ?? [];
  const extracting = extraction?.status === "running";
  const [busy, setBusy] = useState(false);
  const messages = useQuery(
    api.procurementInformation.messages,
    threadId
      ? { requestId, threadId: threadId as Id<"teamEmailThreads"> }
      : "skip",
  );
  const selectedMessage = messages?.find((m) => m.id === messageId);
  function resetSource() {
    setMessageId("");
    setQuote("");
    setExtractionId(null);
    setExisting(null);
  }
  return (
    <InlineFieldList>
      <InlineFieldRow label="Provider">
        <Choice
          label="Provider"
          value={outreachId}
          onChange={(v) => {
            setOutreachId(v);
            setThreadId("");
            resetSource();
          }}
          options={panel.outreaches.map((o) => ({
            value: o._id,
            label: o.brokerName,
          }))}
        />
      </InlineFieldRow>
      <InlineFieldRow label="Carrier (if known)">
        <Input
          aria-label="Carrier"
          value={carrier}
          onChange={(e) => setCarrier(e.target.value)}
        />
      </InlineFieldRow>
      <InlineFieldRow
        label={mode === "email" ? "Provider email" : "Source email (optional)"}
      >
        <Choice
          label="Source email thread"
          value={threadId || (mode === "email" ? "" : "manual")}
          onChange={(v) => {
            setThreadId(v === "manual" ? "" : v);
            resetSource();
          }}
          options={[
            ...(mode === "email"
              ? []
              : [{ value: "manual", label: "Manual / phone request" }]),
            ...panel.threads
              .filter((t) => t.outreachId === outreachId)
              .map((t) => ({ value: t.id, label: t.subject })),
          ]}
        />
      </InlineFieldRow>
      {threadId && (
        <>
          <InlineFieldRow label="Provider message">
            <Choice
              label="Provider message"
              value={messageId}
              onChange={(v) => {
                setMessageId(v);
                setQuote("");
                setExtractionId(null);
              }}
              options={(messages ?? [])
                .filter((m) => m.direction === "inbound")
                .map((m) => ({
                  value: m.id,
                  label: m.text.slice(0, 100) || "Empty message",
                }))}
            />
          </InlineFieldRow>
          {selectedMessage && (
            <InlineFieldRow label="Email text">
              <p className="max-h-64 overflow-y-auto whitespace-pre-wrap">
                {selectedMessage.text}
              </p>
            </InlineFieldRow>
          )}
          <InlineFieldRow label="Exact supporting quote">
            <Textarea
              aria-label="Exact provider quote"
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
            />
          </InlineFieldRow>
          <InlineFieldRow label="Extract questions">
            <PillButton
              disabled={
                !messageId ||
                busy ||
                extracting ||
                extraction?.status === "failed"
              }
              variant="secondary"
              onClick={() =>
                void attempt(async () => {
                  setBusy(true);
                  try {
                    const rows = await extract({
                      requestId,
                      messageId: messageId as Id<"teamEmailMessages">,
                    });
                    setExtractionId(rows);
                  } finally {
                    setBusy(false);
                  }
                })
              }
            >
              {busy || extracting
                ? "Extracting…"
                : "Extract requested information"}
            </PillButton>
          </InlineFieldRow>
          {extraction?.status === "failed" && (
            <InlineFieldRow label="Extraction unavailable">
              <p role="alert">
                We couldn’t extract these questions. You can add them manually;
                this email will not be processed again automatically.
              </p>
              <PillButton
                variant="secondary"
                onClick={() => setManualEntry(true)}
              >
                Add manually
              </PillButton>
            </InlineFieldRow>
          )}
          {extraction?.status === "complete" && !proposals.length && (
            <InlineFieldRow label="No questions found">
              No explicit information requests were found in this message.
            </InlineFieldRow>
          )}
          {proposals.map((p, i) => (
            <InlineFieldRow key={i} label={p.label}>
              <div className="space-y-2">
                <p className="text-muted-foreground">“{p.quote}”</p>
                <PillButton
                  variant="secondary"
                  onClick={() => {
                    setReuse("new");
                    setLabel(p.label);
                    setKind(p.kind);
                    setCurrency(p.currency ?? panel.currency);
                    setOptions(p.options.join("\n"));
                    setSubject(p.subject);
                    setPeriod(p.period);
                    setCoverage(p.coverage);
                    setQuote(p.quote);
                    setExisting(p.existingAnswer);
                  }}
                >
                  Review this question
                </PillButton>
              </div>
            </InlineFieldRow>
          ))}
        </>
      )}
      <InlineFieldRow label="Question">
        <Choice
          label="New or existing question"
          value={reuse}
          onChange={setReuse}
          options={[
            { value: "new", label: "New question" },
            ...panel.questions.map((q) => ({
              value: q._id,
              label: `${q.question.label} · ${q.scope.period}`,
            })),
          ]}
        />
      </InlineFieldRow>
      {reuse === "new" &&
        (mode !== "email" || !!label.trim() || manualEntry) && (
          <>
            <InlineFieldRow label="Client wording">
              <Textarea
                aria-label="Client question"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </InlineFieldRow>
            <InlineFieldRow label="Input">
              <Choice
                label="Input type"
                value={kind}
                onChange={(v) => setKind(v as typeof kind)}
                options={KINDS.map((k) => ({
                  value: k,
                  label: KIND_LABELS[k],
                }))}
              />
            </InlineFieldRow>
            {kind === "currency" && (
              <InlineFieldRow label="Currency">
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
                  ].map((code) => ({ value: code, label: code }))}
                />
              </InlineFieldRow>
            )}
            {kind === "dropdown" && (
              <InlineFieldRow label="Options (one per line)">
                <Textarea
                  aria-label="Dropdown options"
                  value={options}
                  onChange={(e) => setOptions(e.target.value)}
                />
              </InlineFieldRow>
            )}
            <InlineFieldRow label="Coverage">
              <Choice
                label="Coverage"
                value={coverage}
                onChange={setCoverage}
                options={COVERAGE_OPTIONS.map((c) => ({
                  value: c.id,
                  label: c.label,
                }))}
              />
            </InlineFieldRow>
            <InlineFieldRow label="Ask only when">
              <Choice
                label="Prerequisite question"
                value={parentId || "always"}
                onChange={(v) => setParentId(v === "always" ? "" : v)}
                options={[
                  { value: "always", label: "Always" },
                  ...panel.questions
                    .filter((q) => q.question.kind === "yes_no")
                    .map((q) => ({ value: q._id, label: q.question.label })),
                ]}
              />
            </InlineFieldRow>
            {parentId && (
              <InlineFieldRow label="Prerequisite answer">
                <Choice
                  label="Prerequisite answer"
                  value={parentAnswer}
                  onChange={setParentAnswer}
                  options={[
                    { value: "Yes", label: "Yes" },
                    { value: "No", label: "No" },
                  ]}
                />
              </InlineFieldRow>
            )}
            <InlineFieldRow label="Subject">
              <Input
                aria-label="Question subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </InlineFieldRow>
            <InlineFieldRow label="Reporting period">
              <Input
                aria-label="Reporting period"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
            </InlineFieldRow>
          </>
        )}
      {existing && (
        <InlineFieldRow label="Possible existing answer">
          <p>
            {existing} — verify its scope against the accepted application
            before recording it.
          </p>
        </InlineFieldRow>
      )}
      <InlineFieldRow label="">
        <PillButton
          disabled={
            busy ||
            !outreachId ||
            (reuse === "new" && (!label.trim() || !coverage.trim())) ||
            (!!threadId && (!messageId || !quote.trim()))
          }
          onClick={() =>
            void attempt(async () => {
              setBusy(true);
              try {
                await add({
                  requestId,
                  outreachId: outreachId as Id<"procurementBrokerOutreaches">,
                  questionId:
                    reuse === "new"
                      ? undefined
                      : (reuse as Id<"procurementInformationQuestions">),
                  question: {
                    id: "provider_question",
                    conditions: parentId
                      ? [{ questionId: parentId, answer: parentAnswer }]
                      : undefined,
                    section: "additional",
                    label,
                    kind,
                    options:
                      kind === "dropdown"
                        ? options
                            .split("\n")
                            .map((s) => s.trim())
                            .filter(Boolean)
                        : [],
                  },
                  scope: {
                    subject,
                    period,
                    coverage,
                    currency: kind === "currency" ? currency : undefined,
                  },
                  carrier: carrier.trim() || undefined,
                  sourceMessageId: messageId
                    ? (messageId as Id<"teamEmailMessages">)
                    : undefined,
                  sourceQuote: quote || undefined,
                });
                setLabel("");
                setExisting(null);
                toast.success("Requirement added");
                onDone();
              } finally {
                setBusy(false);
              }
            })
          }
        >
          {initialQuestionId ? "Add provider" : "Add question"}
        </PillButton>
      </InlineFieldRow>
    </InlineFieldList>
  );
}

function InlineInformationAnswer({
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
