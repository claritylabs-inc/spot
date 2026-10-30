"use client";

import { useCallback, useEffect, useState } from "react";
import {
  useAction,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@claritylabs-inc/ui/components/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@claritylabs-inc/ui/components/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@claritylabs-inc/ui/components/collapsible";
import { SearchableSelect } from "@claritylabs-inc/ui/components/searchable-select";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import { InlineFieldCard, InlineFieldRow } from "@/components/ui/inline-fields";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { PillButton } from "@/components/ui/pill-button";
import { RemoveButton } from "@/components/ui/remove-button";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { ChatAttachmentChip } from "@/components/chat/attachment-chip";
import { usePageContextLayer } from "@/hooks/use-page-context";
import { useFollowedState } from "@/hooks/use-followed-state";
import {
  PROVIDER_ACORD_LOB_CODES,
  lobLabel,
} from "@/convex/lib/linesOfBusiness";
import { useCachedOperatorBrokers } from "@/lib/sync/operator-cached-queries";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";

type SubmissionDefault = NonNullable<
  FunctionReturnType<typeof api.providerSubmissionDefaults.get>
>;
type Requirement = { question: string; guidance: string };
type SubmissionDraft = {
  revision: number;
  instructions: string;
  requirements: Requirement[];
  error: string | null;
};
export type SubmissionDefaultSource = {
  threadId: Id<"teamEmailThreads">;
  messageId: Id<"teamEmailMessages">;
  attachment?: {
    clientFileId?: Id<"clientFiles">;
    storageId?: Id<"_storage">;
    name: string;
  };
  text?: string;
};

const coverageOptions = PROVIDER_ACORD_LOB_CODES.map((value) => ({
  value,
  label: lobLabel(value),
})).sort((a, b) => a.label.localeCompare(b.label));
const body = typeStyle("body.default");
const caption = typeStyle("caption.default");

export function ProviderSubmissionDefaults({
  brokerOrgId,
  brokerName,
}: {
  brokerOrgId: Id<"organizations">;
  brokerName: string;
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.providerSubmissionDefaults.listPage,
    { brokerOrgId },
    { initialNumItems: 10 },
  );
  const loading = status === "LoadingFirstPage";
  const [editing, setEditing] = useFollowedState<string | null>(
    `provider:${brokerOrgId}:submission-defaults:editing`,
    null,
  );
  usePageContextLayer(
    editing === null
      ? null
      : {
          pageType: "operator_broker",
          entityId: brokerOrgId,
          summary: `Insurance provider ${brokerName}; ${
            editing
              ? `editing ${lobLabel(editing)} (${editing}) submission defaults`
              : "adding coverage submission defaults"
          }`,
        },
  );
  return (
    <div className="space-y-4">
      <ListToolbar
        followKey={`provider:${brokerOrgId}:submission-defaults`}
        actions={
          <PillButton
            size="compact"
            disabled={loading}
            onClick={() => setEditing("")}
          >
            <Plus /> Add coverage defaults
          </PillButton>
        }
      />
      <p className={`text-muted-foreground ${body}`}>
        The standard application forms, submission process and minimum
        information needed for each coverage line.
      </p>
      {loading ? (
        <p className={`text-muted-foreground ${body}`} role="status">
          Loading submission defaults…
        </p>
      ) : !results.length ? (
        <p className={`text-muted-foreground ${body}`}>
          No submission defaults yet. Add a coverage line, or right-click a form
          in an email to save it here.
        </p>
      ) : (
        results.map((item) => (
          <SubmissionDefaultCard
            key={item._id}
            item={item}
            onEdit={() => setEditing(item.coverageCode)}
          />
        ))
      )}
      {(status === "CanLoadMore" || status === "LoadingMore") && (
        <ListToolbar
          followKey={`provider:${brokerOrgId}:submission-defaults:pagination`}
          actions={
            <PillButton
              variant="secondary"
              size="compact"
              disabled={status === "LoadingMore"}
              onClick={() => loadMore(10)}
            >
              {status === "LoadingMore"
                ? "Loading…"
                : "Load more coverage defaults"}
            </PillButton>
          }
        />
      )}
      {editing !== null && (
        <SubmissionDefaultDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          defaultBrokerOrgId={brokerOrgId}
          defaultBrokerName={brokerName}
          defaultCoverageCode={editing}
        />
      )}
    </div>
  );
}

function SubmissionDefaultCard({
  item,
  onEdit,
}: {
  item: SubmissionDefault;
  onEdit: () => void;
}) {
  const removeForm = useMutation(api.providerSubmissionDefaults.removeForm);
  const remove = useMutation(api.providerSubmissionDefaults.remove);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useFollowedState(
    `provider-default:${item._id}:remove-open`,
    false,
  );
  async function deleteForm(storageId: Id<"_storage">) {
    setBusy(storageId);
    try {
      await removeForm({
        defaultId: item._id,
        expectedRevision: item.revision,
        storageId,
      });
      toast.success("Application form removed");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Could not remove the application form",
        ),
      );
    } finally {
      setBusy(null);
    }
  }
  async function deleteDefault() {
    setBusy("delete");
    try {
      await remove({ defaultId: item._id, expectedRevision: item.revision });
      toast.success("Submission defaults removed");
      setConfirmRemove(false);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Could not remove submission defaults",
        ),
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <InlineFieldCard
        title={lobLabel(item.coverageCode)}
        actions={
          <div className="flex items-center gap-2">
            <PillButton
              variant="secondary"
              size="compact"
              disabled={!!busy}
              onClick={onEdit}
            >
              Edit
            </PillButton>
            <RemoveButton
              label={`Remove ${lobLabel(item.coverageCode)} defaults`}
              disabled={!!busy}
              onClick={() => setConfirmRemove(true)}
            />
          </div>
        }
      >
        <InlineFieldRow label="Application forms">
          <div className="space-y-1 py-1" data-inline-multiline>
            {!item.forms.length && (
              <p className="py-1 text-muted-foreground">
                No standard forms saved.
              </p>
            )}
            {item.forms.map((form) => (
              <div
                key={form.storageId}
                className="flex min-w-0 items-center gap-2"
              >
                <ChatAttachmentChip
                  attachment={{
                    filename: form.name,
                    contentType: form.contentType,
                  }}
                  url={form.url}
                  pdfSource={{
                    kind: "submissionDefaultForm",
                    defaultId: item._id,
                    storageId: form.storageId,
                    filename: form.name,
                  }}
                />
                <RemoveButton
                  label={`Remove ${form.name}`}
                  busy={busy === form.storageId}
                  disabled={!!busy}
                  onClick={() => void deleteForm(form.storageId)}
                />
              </div>
            ))}
          </div>
        </InlineFieldRow>
        <InlineFieldRow label="Submission process / provider notes">
          <p className="whitespace-pre-wrap py-2" data-inline-multiline>
            {item.instructions || "No process recorded."}
          </p>
        </InlineFieldRow>
        <InlineFieldRow label="Minimum information">
          <div className="space-y-3 py-2" data-inline-multiline>
            {!item.requirements.length && (
              <p className="text-muted-foreground">
                No follow-up questions recorded.
              </p>
            )}
            {item.requirements.map((requirement, index) => (
              <div key={index} className="space-y-1">
                <p className={typeStyle("body.medium")}>
                  {requirement.question}
                </p>
                {requirement.guidance && (
                  <p className="whitespace-pre-wrap text-muted-foreground">
                    {requirement.guidance}
                  </p>
                )}
              </div>
            ))}
          </div>
        </InlineFieldRow>
        {item.sourceThreadId && (
          <InlineFieldRow label="Source conversation">
            <PillButton
              href={`/operator/inbox/${item.sourceThreadId}`}
              variant="ghost"
              size="compact"
            >
              Open conversation
            </PillButton>
          </InlineFieldRow>
        )}
      </InlineFieldCard>
      <AlertDialog
        open={confirmRemove}
        onOpenChange={(open) => {
          if (!busy) setConfirmRemove(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {lobLabel(item.coverageCode)} defaults?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the saved process, questions and reusable forms for
              this coverage line. Source emails are retained.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <PillButton
              variant="secondary"
              disabled={!!busy}
              onClick={() => setConfirmRemove(false)}
            >
              Cancel
            </PillButton>
            <PillButton
              variant="destructive"
              disabled={!!busy}
              onClick={() => void deleteDefault()}
            >
              {busy ? "Removing…" : "Remove defaults"}
            </PillButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function SubmissionDefaultDialog({
  open,
  onOpenChange,
  source,
  defaultBrokerOrgId,
  defaultBrokerName,
  defaultCoverageCode = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source?: SubmissionDefaultSource;
  defaultBrokerOrgId?: Id<"organizations">;
  defaultBrokerName?: string;
  defaultCoverageCode?: string;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
        showCloseButton={!saving}
      >
        <DialogHeader>
          <DialogTitle>
            {source?.attachment
              ? "Save as a standard application form"
              : "Provider submission defaults"}
          </DialogTitle>
          <DialogDescription>
            {source?.attachment
              ? `${source.attachment.name} · Choose the provider and coverage this form applies to.`
              : "Save the standard process and minimum information needed for this coverage line."}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <SubmissionDefaultSelection
            source={source}
            defaultBrokerOrgId={defaultBrokerOrgId}
            defaultBrokerName={defaultBrokerName}
            defaultCoverageCode={defaultCoverageCode}
            saving={saving}
            setSaving={setSaving}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SubmissionDefaultSelection({
  source,
  defaultBrokerOrgId,
  defaultBrokerName,
  defaultCoverageCode,
  saving,
  setSaving,
  onDone,
}: {
  source?: SubmissionDefaultSource;
  defaultBrokerOrgId?: Id<"organizations">;
  defaultBrokerName?: string;
  defaultCoverageCode: string;
  saving: boolean;
  setSaving: (saving: boolean) => void;
  onDone: () => void;
}) {
  const brokers = useCachedOperatorBrokers();
  const [brokerOrgId, setBrokerOrgId] = useState<string>(
    defaultBrokerOrgId ?? "",
  );
  const [coverageCode, setCoverageCode] = useState(defaultCoverageCode);
  const [drafts, setDrafts] = useState<Record<string, SubmissionDraft>>({});
  const selectionKey = `${brokerOrgId}:${coverageCode}`;
  const rememberDraft = useCallback(
    (draft: SubmissionDraft) => {
      setDrafts((current) => ({ ...current, [selectionKey]: draft }));
    },
    [selectionKey],
  );
  const result = useQuery(
    api.providerSubmissionDefaults.get,
    brokerOrgId && coverageCode
      ? { brokerOrgId: brokerOrgId as Id<"organizations">, coverageCode }
      : "skip",
  );
  const brokerOptions = (brokers ?? []).map((broker) => ({
    value: String(broker._id),
    label: broker.name,
    icon: <OrgBrandIcon {...broker} size="xs" />,
  }));
  if (
    defaultBrokerOrgId &&
    !brokerOptions.some((option) => option.value === defaultBrokerOrgId)
  ) {
    brokerOptions.push({
      value: defaultBrokerOrgId,
      label: defaultBrokerName ?? "Provider",
      icon: <OrgBrandIcon name={defaultBrokerName ?? "Provider"} size="xs" />,
    });
  }
  return (
    <>
      <InlineFieldCard>
        <InlineFieldRow label="Provider">
          <SearchableSelect
            typographyRole="control.menu"
            ariaLabel="Provider"
            placeholder="Choose provider"
            options={brokerOptions}
            value={brokerOrgId}
            disabled={saving || (!!defaultBrokerOrgId && !source)}
            onChange={(value) => {
              if (value) setBrokerOrgId(value);
            }}
          />
        </InlineFieldRow>
        <InlineFieldRow label="Coverage line">
          <SearchableSelect
            typographyRole="control.menu"
            ariaLabel="Coverage line"
            placeholder="Choose coverage line"
            options={coverageOptions}
            value={coverageCode}
            disabled={saving || (!!defaultCoverageCode && !source)}
            onChange={(value) => {
              if (value) setCoverageCode(value);
            }}
          />
        </InlineFieldRow>
      </InlineFieldCard>
      {brokerOrgId && coverageCode && result !== undefined ? (
        <SubmissionDefaultForm
          key={selectionKey}
          initialDraft={drafts[selectionKey]}
          onDraftChange={rememberDraft}
          brokerOrgId={brokerOrgId as Id<"organizations">}
          coverageCode={coverageCode}
          existing={result ?? undefined}
          source={source}
          saving={saving}
          setSaving={setSaving}
          onDone={onDone}
        />
      ) : (
        <>
          {brokerOrgId && coverageCode && result === undefined && (
            <p role="status" className={`text-muted-foreground ${body}`}>
              Loading saved defaults…
            </p>
          )}
          <DialogFooter>
            <PillButton variant="secondary" onClick={onDone}>
              Cancel
            </PillButton>
            <PillButton disabled>Save defaults</PillButton>
          </DialogFooter>
        </>
      )}
    </>
  );
}

function SubmissionDefaultForm({
  brokerOrgId,
  coverageCode,
  existing,
  source,
  saving,
  setSaving,
  onDone,
  initialDraft,
  onDraftChange,
}: {
  brokerOrgId: Id<"organizations">;
  coverageCode: string;
  initialDraft?: SubmissionDraft;
  onDraftChange: (draft: SubmissionDraft) => void;
  existing?: SubmissionDefault;
  source?: SubmissionDefaultSource;
  saving: boolean;
  setSaving: (saving: boolean) => void;
  onDone: () => void;
}) {
  const save = useMutation(api.providerSubmissionDefaults.save);
  const saveFromAttachment = useAction(
    api.providerSubmissionDefaults.saveFromAttachment,
  );
  const [revision, setRevision] = useState(
    initialDraft?.revision ?? existing?.revision ?? 0,
  );
  const [instructions, setInstructions] = useState(
    initialDraft?.instructions ?? existing?.instructions ?? "",
  );
  const [requirements, setRequirements] = useState<Requirement[]>(
    () =>
      initialDraft?.requirements ?? [
        ...(existing?.requirements ?? []),
        ...(source?.text && !source.attachment
          ? [{ question: "", guidance: "" }]
          : []),
      ],
  );
  const [error, setError] = useState<string | null>(
    initialDraft?.error ?? null,
  );
  const [sourceOpen, setSourceOpen] = useFollowedState(
    `provider-default:${brokerOrgId}:${coverageCode}:source:${source?.messageId ?? "none"}`,
    false,
  );
  useEffect(() => {
    onDraftChange({ revision, instructions, requirements, error });
  }, [revision, instructions, requirements, error, onDraftChange]);
  const changedOnServer = revision !== (existing?.revision ?? 0);
  const invalidQuestion = requirements.some(
    (item) => !item.question.trim() || item.question.length > 1000,
  );
  const setRequirement = (index: number, patch: Partial<Requirement>) =>
    setRequirements((current) =>
      current.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  async function submit() {
    if (saving || invalidQuestion || changedOnServer) return;
    setSaving(true);
    setError(null);
    try {
      const args = {
        brokerOrgId,
        coverageCode,
        expectedRevision: revision,
        instructions,
        requirements,
        ...(source
          ? {
              sourceThreadId: source.threadId,
              sourceMessageId: source.messageId,
            }
          : {}),
      };
      if (source?.attachment) {
        await saveFromAttachment({
          ...args,
          attachment: {
            threadId: source.threadId,
            messageId: source.messageId,
            ...(source.attachment.clientFileId
              ? { clientFileId: source.attachment.clientFileId }
              : { storageId: source.attachment.storageId }),
          },
        });
      } else await save(args);
      toast.success("Provider submission defaults saved");
      onDone();
    } catch (caught) {
      setError(
        getUserFacingErrorMessage(
          caught,
          "Could not save submission defaults. Your changes are still here.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {source?.text && (
        <Collapsible open={sourceOpen} onOpenChange={setSourceOpen}>
          <CollapsibleTrigger
            render={<PillButton type="button" variant="ghost" size="compact" />}
          >
            View source email
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <Textarea
              aria-label="Source email reference"
              readOnly
              value={source.text}
              className="min-h-40 max-h-48 overflow-y-auto"
            />
            <p className={`mt-2 text-muted-foreground ${caption}`}>
              Use this as a reference to write the reusable question and
              information needed below.
            </p>
          </CollapsibleContent>
        </Collapsible>
      )}
      {existing && (
        <p className={`text-muted-foreground ${caption}`}>
          Editing this coverage’s saved defaults. Its {existing.forms.length}{" "}
          saved application{" "}
          {existing.forms.length === 1 ? "form is" : "forms are"} retained.
        </p>
      )}
      <InlineFieldCard>
        <InlineFieldRow label="Submission process / provider notes">
          <Textarea
            aria-label="Submission process / provider notes"
            value={instructions}
            maxLength={16000}
            disabled={saving}
            placeholder="Complete the standard application form, then email it to the primary outreach contact. Include…"
            onChange={(event) => setInstructions(event.target.value)}
          />
        </InlineFieldRow>
      </InlineFieldCard>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className={typeStyle("body.medium")}>
            Minimum information / follow-up questions
          </span>
          <PillButton
            type="button"
            size="compact"
            variant="secondary"
            disabled={saving || requirements.length >= 40}
            onClick={() =>
              setRequirements((current) => [
                ...current,
                { question: "", guidance: "" },
              ])
            }
          >
            <Plus /> Add question
          </PillButton>
        </div>
        <p className={`text-muted-foreground ${caption}`}>
          Record reusable questions and what a complete answer needs. Keep
          client-specific answers clearly labeled as examples.
        </p>
        {!requirements.length && (
          <p className={`text-muted-foreground ${body}`}>
            No follow-up questions saved.
          </p>
        )}
        {requirements.map((requirement, index) => (
          <InlineFieldCard
            key={index}
            title={`Question ${index + 1}`}
            actions={
              <RemoveButton
                label={`Remove question ${index + 1}`}
                disabled={saving}
                onClick={() =>
                  setRequirements((current) =>
                    current.filter((_, i) => i !== index),
                  )
                }
              />
            }
          >
            <InlineFieldRow label="Question / required information">
              <Textarea
                aria-label={`Question ${index + 1}`}
                value={requirement.question}
                maxLength={1000}
                disabled={saving}
                placeholder="Describe the ridesharing business and its operations."
                onChange={(event) =>
                  setRequirement(index, { question: event.target.value })
                }
              />
            </InlineFieldRow>
            <InlineFieldRow label="Guidance / information provided">
              <Textarea
                aria-label={`Guidance / information provided ${index + 1}`}
                value={requirement.guidance}
                maxLength={4000}
                disabled={saving}
                placeholder="Include the service, driver arrangements and territory. Example provided: …"
                onChange={(event) =>
                  setRequirement(index, { guidance: event.target.value })
                }
              />
            </InlineFieldRow>
          </InlineFieldCard>
        ))}
      </div>
      {changedOnServer && (
        <div role="alert" className={`space-y-2 ${body}`}>
          <p>
            These defaults changed while you were editing. Your draft is still
            here. Reload the saved version before saving again.
          </p>
          <PillButton
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={() => {
              setRevision(existing?.revision ?? 0);
              setInstructions(existing?.instructions ?? "");
              setRequirements(existing?.requirements ?? []);
              setError(null);
            }}
          >
            Reload saved version
          </PillButton>
        </div>
      )}
      {requirements.some((item) => item.question.length > 1000) && (
        <p role="alert" className={`text-destructive ${body}`}>
          Shorten each question to 1,000 characters or fewer. Move supporting
          information into its guidance field.
        </p>
      )}
      {error && (
        <p role="alert" className={`text-destructive ${body}`}>
          {error}
        </p>
      )}
      <DialogFooter>
        <PillButton
          type="button"
          variant="secondary"
          disabled={saving}
          onClick={onDone}
        >
          Cancel
        </PillButton>
        <PillButton
          type="submit"
          disabled={saving || invalidQuestion || changedOnServer}
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          {saving ? "Saving…" : "Save defaults"}
        </PillButton>
      </DialogFooter>
    </form>
  );
}
