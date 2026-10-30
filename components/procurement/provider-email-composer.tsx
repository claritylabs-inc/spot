"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ChevronLeft, ChevronRight, Eye, Loader2, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import {
  EmailComposeInput,
  EmailComposeRow,
} from "@/components/email/compose-fields";
import { EmailComposerBar, type FollowUps } from "@/components/email/email-composer";
import { AddressPills, FromPicker } from "@/components/email/operator-address";
import { useMediaQuery } from "@/components/app-sidebar/utils";
import { AppShellPortal } from "@/components/app-shell-slots";
import { ReplyEditor } from "@/components/inbox/reply-editor";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { LogoIcon } from "@/components/ui/logo-icon";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { PillButton } from "@/components/ui/pill-button";
import { TagRemoveButton } from "@/components/ui/tag-remove-button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  APPLICATION_LINK,
  emailBlanks,
  MERGE_VARIABLES,
} from "@/convex/lib/providerOutreachMerge";
import type { ProviderCandidateView } from "@/convex/providerOutreach";
import { followedContentKey, useFollowedState, useLeaderOnly } from "@/hooks/use-followed-state";
import { usePageContext } from "@/hooks/use-page-context";
import { useSharedValue } from "@/hooks/use-shared-value";
import { useCachedOperatorCurrent } from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  launchSummary,
  ProviderContactPill,
  ProviderContactSelect,
  requestCadence,
} from "./provider-outreach-panel";

const PREVIEW_DELAY_MS = 450;

/** Who a provider email composer writes to: one provider, or a mail merge to several. */
export type ProviderEmailTarget = {
  brokerOrgIds: Id<"organizations">[];
  /** Contacts chosen in the Providers table, by provider. */
  contacts: Record<string, Id<"brokerContacts">>;
  /** Mail merge: one template sent to each provider individually. */
  merge: boolean;
};

type Email = { subject: string; body: string };
/** The email in the box and the text it was last filled with, to tell an edit from Spot's draft. */
type Draft = { email: Email; filled: string | null; filledKey: string | null };

// Unsent drafts survive closing the composer within the session.
const drafts = new Map<string, Draft>();
// Spot tailors each provider's email once per session; the server also never repeats it.
const tailorRequested = new Set<string>();

function useDebounced<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

const asText = (email: Email) => JSON.stringify([email.subject, email.body]);

/**
 * The first email to one provider, or a mail merge to several, in the shared
 * compose fields: From, To, Cc, Subject, and the reply editor with merge
 * variables and fill-in blanks. Spot's draft (tailored for one provider, or the
 * request's template) fills the box until the operator edits; the AI panel
 * revises the same drafts. Send launches exactly the previewed emails, one
 * individual email per provider, by the preview's fingerprint.
 */
export function ProviderEmailComposer(props: {
  requestId: Id<"procurementRequests">;
  requestTitle: string;
  target: ProviderEmailTarget;
  onClose: () => void;
}) {
  const operatorId = useCachedOperatorCurrent()?.user._id;
  if (!operatorId) return null;
  return <OperatorProviderEmailComposer key={operatorId} operatorId={operatorId as Id<"users">} {...props} />;
}

function OperatorProviderEmailComposer({
  operatorId,
  requestId,
  requestTitle,
  target,
  onClose,
}: {
  operatorId: Id<"users">;
  requestId: Id<"procurementRequests">;
  requestTitle: string;
  target: ProviderEmailTarget;
  onClose: () => void;
}) {
  const single = !target.merge && target.brokerOrgIds.length === 1;
  const scope = `provider-email:${requestId}:${single ? target.brokerOrgIds[0] : "all"}`;
  // A fresh selection must not inherit removed recipients or contact choices
  // from an earlier batch. The request's shared template still keeps its scope.
  const recipientScope = followedContentKey(scope, target.brokerOrgIds);
  const draftKey = `${operatorId}:${scope}`;
  const panel = useQuery(api.providerOutreach.getPanel, { requestId });
  const saved = useQuery(api.providerOutreachDrafts.get, {
    requestId,
    ...(single ? { brokerOrgId: target.brokerOrgIds[0] } : { brokerOrgIds: target.brokerOrgIds }),
  });
  const saveEdit = useLeaderOnly(useMutation(api.providerOutreachDrafts.saveEdit));
  const resetEdit = useLeaderOnly(useMutation(api.providerOutreachDrafts.resetEdit));
  const launch = useMutation(api.providerOutreach.launch);
  const requestTailored = useLeaderOnly(useMutation(api.providerOutreachDrafts.requestTailored));

  // Shared with teammates writing this email together.
  const [fromUserId, setFromUserId] = useState<Id<"users">>(operatorId);
  useSharedValue(`${scope}:from`, fromUserId, setFromUserId);
  const [removed, setRemoved] = useState<string[]>([]);
  useSharedValue(`${recipientScope}:removed`, removed, setRemoved);
  const [contacts, setContacts] = useState(target.contacts);
  useSharedValue(`${recipientScope}:contacts`, contacts, setContacts);
  const requestDefault = panel ? requestCadence(panel) : null;
  const [followUps, setFollowUps] = useState<FollowUps | null | undefined>(undefined);
  useSharedValue(`${scope}:follow-ups`, followUps ?? null, setFollowUps);
  const [draft, setDraftState] = useState<Draft | null>(() => drafts.get(draftKey) ?? null);
  useSharedValue(`${scope}:email`, draft, setDraftState);
  const setDraft = (next: Draft | null) => {
    if (next) drafts.set(draftKey, next);
    else drafts.delete(draftKey);
    setDraftState(next);
  };
  const [showFull, setShowFull] = useFollowedState(`${scope}:show-full`, false);
  const [previewFor, setPreviewFor] = useFollowedState<string | null>(`${recipientScope}:preview-for`, null);
  // A mail merge's per-provider emails edited in the preview, until each is saved as that provider's draft.
  const [edits, setEdits] = useState<Record<string, Email>>({});
  useSharedValue(`${recipientScope}:edits`, edits, setEdits);
  const [sending, setSending] = useState(false);

  // Spot's email for this box: one provider's own draft, else the request template.
  const own = single && saved?.draft?.status === "ready" && saved.draft.subject && saved.draft.body
    ? { email: { subject: saved.draft.subject, body: saved.draft.body }, key: `draft:${saved.draft.revision}` }
    : null;
  const source = own ?? (saved ? { email: { subject: saved.template.subject, body: saved.template.body }, key: `template:${asText(saved.template)}` } : null);
  const edited = draft !== null && asText(draft.email) !== draft.filled;
  const newer = source !== null && source.key !== draft?.filledKey;
  // An empty or unedited box takes Spot's latest draft; edits are never overwritten.
  const takeSource = () => {
    if (source) setDraft({ email: source.email, filled: asText(source.email), filledKey: source.key });
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (newer && !edited) takeSource();
  });
  const tailoring = single && saved?.draft?.status === "pending";
  useEffect(() => {
    if (!single || !saved || saved.draft || tailorRequested.has(scope)) return;
    tailorRequested.add(scope);
    void requestTailored({ requestId, brokerOrgId: target.brokerOrgIds[0] }).catch(() => {
      // The template stays in the box; tailoring is optional.
    });
  }, [requestId, requestTailored, saved, scope, single, target.brokerOrgIds]);

  const candidates = panel
    ? [...panel.candidates.matched, ...panel.candidates.unknown, ...panel.candidates.excluded]
    : [];
  const recipients = target.brokerOrgIds
    .filter((id) => !removed.includes(id))
    .flatMap((id) => candidates.find((candidate) => candidate.brokerOrgId === id) ?? []);
  const followValue = followUps === undefined ? (requestDefault?.cadence.followUpCount ? { cadence: null } : null) : followUps;
  const cadence = requestDefault
    ? !followValue
      ? { ...requestDefault.cadence, followUpCount: 0 }
      : followValue.cadence
        ? { ...requestDefault.cadence, ...followValue.cadence }
        : requestDefault.cadence
    : null;
  const cadenceSource = requestDefault
    ? !followValue || followValue.cadence
      ? { ...requestDefault.cadenceSource, followUpCount: "operator" as const, intervalBusinessDays: "operator" as const }
      : requestDefault.cadenceSource
    : null;

  const email = draft?.email ?? null;
  // Each provider's own email in a mail merge: unsaved edits here, else its saved edit (yours or the AI panel's).
  const savedEdits = new Map((saved?.edits ?? []).map((edit) => [edit.brokerOrgId as string, edit]));
  const ownEmail = (brokerOrgId: string): Email | null =>
    edits[brokerOrgId] ??
    (savedEdits.get(brokerOrgId)
      ? { subject: savedEdits.get(brokerOrgId)!.subject, body: savedEdits.get(brokerOrgId)!.body }
      : null);
  const overrides = single
    ? []
    : recipients.flatMap((row) => {
        const own = ownEmail(row.brokerOrgId);
        return own ? [{ brokerOrgId: row.brokerOrgId, ...own }] : [];
      });
  // Edits are saved as the provider's draft shortly after typing stops, so the AI panel sees them.
  const savedEditText = useRef<Record<string, string>>({});
  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const [brokerOrgId, edit] of Object.entries(edits)) {
        const text = asText(edit);
        if (savedEditText.current[brokerOrgId] === text || !edit.subject.trim() || !edit.body.trim()) continue;
        savedEditText.current[brokerOrgId] = text;
        void saveEdit({ requestId, brokerOrgId: brokerOrgId as Id<"organizations">, ...edit }).catch(() => {
          // The edit still sends from this composer; saving it only shares it.
        });
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [edits, requestId, saveEdit]);
  const editProvider = (brokerOrgId: string, next: Email) => setEdits({ ...edits, [brokerOrgId]: next });
  const revertToTemplate = (brokerOrgId: string) => {
    const next = { ...edits };
    delete next[brokerOrgId];
    delete savedEditText.current[brokerOrgId];
    setEdits(next);
    void resetEdit({ requestId, brokerOrgId: brokerOrgId as Id<"organizations"> }).catch(() => {});
  };
  const args =
    email && cadence && recipients.length
      ? {
          requestId,
          brokerOrgIds: recipients.map((row) => row.brokerOrgId),
          cadence,
          matchedOnly: !single,
          selectedContacts: recipients.flatMap((row) =>
            contacts[row.brokerOrgId]
              ? [{ brokerOrgId: row.brokerOrgId, contactId: contacts[row.brokerOrgId] }]
              : [],
          ),
          email,
          ...(overrides.length ? { overrides } : {}),
          ...(fromUserId === operatorId ? {} : { fromUserId }),
        }
      : null;
  const settled = useDebounced(args, PREVIEW_DELAY_MS);
  const result = useQuery(api.providerOutreach.previewLaunch, settled ?? "skip");
  const current = settled !== null && JSON.stringify(settled) === JSON.stringify(args);
  const preview = current && result?.ok ? result : null;
  // Headers stay put while the next preview loads; Send still needs the current one.
  const [lastPreview, setLastPreview] = useState<typeof preview>(null);
  if (preview && preview !== lastPreview) setLastPreview(preview);
  const shown = preview ?? lastPreview;
  const blanks = email ? emailBlanks(`${email.subject}\n${email.body}`) : [];
  const problem = blanks.length
    ? null
    : current && result
      ? result.ok
        ? result.problem
        : result.reason
      : null;
  const sends = shown?.providers.filter((provider) => provider.willSend) ?? [];
  const previewed =
    sends.find((provider) => provider.brokerOrgId === previewFor) ?? sends[0] ?? null;
  const previewIndex = previewed ? sends.indexOf(previewed) : 0;
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // The AI panel works on this email while it is open.
  const { pushPageContext } = usePageContext();
  const contextSummary = single
    ? `Composing the first email to provider ${recipients[0]?.name ?? ""} (brokerOrgId ${target.brokerOrgIds[0]}) on procurement request "${requestTitle.slice(0, 120)}" (${requestId}). Revise it with update_procurement_provider_emails using that brokerOrgId; read it with get_procurement_provider_emails.`
    : `Composing a mail-merge email to ${recipients.length} providers on procurement request "${requestTitle.slice(0, 120)}" (${requestId}), sent individually to each. Revise the template with update_procurement_provider_emails (omit brokerOrgId); read it with get_procurement_provider_emails.`;
  useEffect(
    () => pushPageContext({ pageType: "provider_email_draft", entityId: requestId, summary: contextSummary }),
    [contextSummary, pushPageContext, requestId],
  );

  async function send() {
    if (!preview?.fingerprint || !args || !cadenceSource || sending || blanks.length) return;
    setSending(true);
    try {
      const launched = await launch({ ...args, cadenceSource, expectedFingerprint: preview.fingerprint });
      const count = launched.launched.length;
      const skipped = launched.skipped.length;
      if (count) {
        drafts.delete(draftKey);
        toast.success(
          `${count === 1 ? "Email" : `${count} emails`} queued${skipped ? ` · ${skipped} skipped` : ""}`,
          { description: skipped ? launchSummary(launched.skipped) : undefined },
        );
        onClose();
      } else {
        toast.error(`No email sent · ${skipped} skipped`, {
          description: launchSummary(launched.skipped) || undefined,
        });
      }
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not send provider outreach"));
    } finally {
      setSending(false);
    }
  }

  const disabled = sending || !panel?.request.canLaunch;
  const title = single ? `Email ${recipients[0]?.name ?? "provider"}` : `Email ${recipients.length} provider${recipients.length === 1 ? "" : "s"}`;
  const sendCount = sends.length || recipients.length;
  const sendLabel = single ? "Send" : `Send ${sendCount} email${sendCount === 1 ? "" : "s"}`;

  return (
    <SettingsDrawer
      open
      title={title}
      actions={
        previewed?.email ? (
          <PillButton
            type="button"
            size="compact"
            variant={showFull ? "secondary" : "ghost"}
            aria-pressed={showFull}
            onClick={() => setShowFull(!showFull)}
          >
            <Eye className="size-3.5" />
            Preview
          </PillButton>
        ) : undefined
      }
      contentClassName="-mx-4 my-0 flex-1"
      onOpenChange={(open) => {
        if (!open && !sending) onClose();
      }}
      footer={
        <EmailComposerBar
          className="w-full"
          blanks={blanks.length}
          sending={sending}
          canSend={!!preview?.fingerprint && !disabled}
          onSend={() => void send()}
          sendLabel={sendLabel}
          followUps={{
            followKey: scope,
            value: followValue,
            disabled,
            onChange: setFollowUps,
            title: "Nudge each provider on its own thread until they reply",
            autoLabel: requestDefault
              ? `${requestDefault.cadence.followUpCount} · every ${requestDefault.cadence.intervalBusinessDays} days`
              : "Auto",
            note: "Spot uses this request's follow-up cadence, with a short nudge on the same thread each time.",
          }}
          note={problem ? <span role="alert">{problem}</span> : undefined}
          actions={
            <PillButton
              size="compact"
              type="button"
              variant="ghost"
              label="Discard email"
              aria-label="Discard email"
              disabled={sending}
              onClick={() => {
                setDraft(null);
                onClose();
              }}
            >
              <Trash2 className="size-3.5" />
            </PillButton>
          }
        />
      }
    >
      <div
        data-collab-scope={scope}
        className="flex min-h-full flex-1 flex-col"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void send();
          }
        }}
      >
        {panel?.request.closedReason ? (
          <p className={`border-b border-border px-4 py-2 text-muted-foreground ${typeStyle("caption.default")}`}>
            This request is closed, so outreach cannot be sent.
          </p>
        ) : null}
        <EmailComposeRow label="From">
          <FromPicker value={fromUserId} onChange={setFromUserId} disabled={disabled} />
          {own && !edited ? (
            <span className={`ml-auto shrink-0 text-muted-foreground ${typeStyle("caption.default")}`}>
              {saved?.draft?.source === "agent"
                ? "Written in the AI panel"
                : saved?.draft?.source === "operator"
                  ? "Edited earlier"
                  : "Tailored by Spot"}
            </span>
          ) : tailoring && !edited ? (
            <span className={`ml-auto flex shrink-0 items-center gap-1.5 text-muted-foreground ${typeStyle("caption.default")}`}>
              <LogoIcon size={12} className="animate-pulse" />
              Tailoring for this provider…
            </span>
          ) : null}
        </EmailComposeRow>
        <EmailComposeRow label="To">
          {single && recipients[0] ? (
            <ProviderContactSelect
              candidate={recipients[0]}
              selectedContactId={contacts[recipients[0].brokerOrgId]}
              disabled={disabled}
              onSelect={(contactId) => {
                const next = { ...contacts };
                if (contactId) next[recipients[0].brokerOrgId] = contactId;
                else delete next[recipients[0].brokerOrgId];
                setContacts(next);
              }}
            />
          ) : (
            recipients.map((candidate) => (
              <RecipientPill
                key={candidate.brokerOrgId}
                candidate={candidate}
                recipient={shown?.providers.find((row) => row.brokerOrgId === candidate.brokerOrgId)?.recipient ?? candidate.recipient}
                skipped={shown?.providers.find((row) => row.brokerOrgId === candidate.brokerOrgId)?.willSend === false}
                edited={!!ownEmail(candidate.brokerOrgId)}
                active={previewed?.brokerOrgId === candidate.brokerOrgId && showFull}
                onPreview={() => {
                  setPreviewFor(candidate.brokerOrgId);
                  setShowFull(true);
                }}
                onRemove={
                  disabled || recipients.length < 2
                    ? undefined
                    : () => setRemoved([...removed, candidate.brokerOrgId])
                }
              />
            ))
          )}
        </EmailComposeRow>
        {shown?.alwaysCc ? (
          <EmailComposeRow label="Cc">
            <AddressPills addresses={[shown.alwaysCc]} />
          </EmailComposeRow>
        ) : null}
        <EmailComposeRow label="Subject">
          <EmailComposeInput
            aria-label="Subject"
            maxLength={200}
            value={email?.subject ?? ""}
            disabled={disabled || !email}
            onChange={(event) => email && setDraft({ ...draft!, email: { ...email, subject: event.target.value } })}
          />
        </EmailComposeRow>
        {email ? (
          <ReplyEditor
            label="Email"
            placeholder="Write the email…"
            value={email.body}
            disabled={disabled}
            variables={MERGE_VARIABLES}
            scrollClassName="max-h-none overflow-visible"
            footer={shown?.signature}
            suggestions={[]}
            suggesting={false}
            onChange={(body) => setDraft({ ...draft!, email: { ...email, body } })}
            onFocusChange={() => {}}
            onSubmit={() => void send()}
            onEscape={() => {}}
          />
        ) : (
          <p className={`flex items-center gap-2 px-4 py-3 text-muted-foreground ${typeStyle("body.default")}`}>
            <Loader2 className="size-3.5 animate-spin" />
            Loading the email…
          </p>
        )}
        {newer && edited ? (
          <p className={`flex items-center gap-1.5 px-4 pb-2 text-muted-foreground ${typeStyle("caption.default")}`}>
            <LogoIcon size={12} className="shrink-0" />
            Spot has a new draft.
            <button type="button" className="text-foreground underline" onClick={takeSource}>
              Replace yours
            </button>
          </p>
        ) : null}
        {showFull && previewed?.email && !isDesktop ? (
          <div className="border-t border-border">
            <EmailPreview
                provider={previewed}
                candidate={candidates.find((row) => row.brokerOrgId === previewed.brokerOrgId)}
                signature={shown?.signature}
              />
          </div>
        ) : null}
      </div>
      {showFull && previewed?.email && isDesktop ? (
        <AppShellPortal slot="previewPanel">
          <section aria-label="Email preview" className="flex min-h-0 w-full min-w-0 flex-col border-l border-border bg-background">
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
              <span className={`min-w-0 flex-1 truncate text-foreground ${typeStyle("body.medium")}`}>
                {single ? "Preview" : `Preview · ${previewed.brokerName ?? "provider"}`}
              </span>
              {!single && sends.length > 1 ? (
                <>
                  <PillButton
                    type="button"
                    size="compact"
                    variant="ghost"
                    label="Previous provider"
                    aria-label="Previous provider"
                    onClick={() => setPreviewFor(sends[(previewIndex - 1 + sends.length) % sends.length].brokerOrgId)}
                  >
                    <ChevronLeft className="size-3.5" />
                  </PillButton>
                  <span className={`text-muted-foreground ${typeStyle("caption.default")}`}>
                    {previewIndex + 1} of {sends.length}
                  </span>
                  <PillButton
                    type="button"
                    size="compact"
                    variant="ghost"
                    label="Next provider"
                    aria-label="Next provider"
                    onClick={() => setPreviewFor(sends[(previewIndex + 1) % sends.length].brokerOrgId)}
                  >
                    <ChevronRight className="size-3.5" />
                  </PillButton>
                </>
              ) : null}
              <PillButton
                type="button"
                size="compact"
                variant="ghost"
                label="Close preview"
                aria-label="Close preview"
                onClick={() => setShowFull(false)}
              >
                <X className="size-3.5" />
              </PillButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {!single && previewed.email ? (
                // Edits apply to this provider only; the first change makes its own email.
                <ProviderEmailEditor
                  key={previewed.brokerOrgId}
                  provider={previewed}
                  candidate={candidates.find((row) => row.brokerOrgId === previewed.brokerOrgId)}
                  email={ownEmail(previewed.brokerOrgId) ?? { subject: previewed.email.subject, body: previewed.email.body }}
                  signature={shown?.signature}
                  disabled={disabled}
                  onChange={(next) => editProvider(previewed.brokerOrgId, next)}
                />
              ) : (
                <EmailPreview
                  provider={previewed}
                  candidate={candidates.find((row) => row.brokerOrgId === previewed.brokerOrgId)}
                  signature={shown?.signature}
                />
              )}
            </div>
            {!single ? (
              // Lines up with the composer's send bar.
              <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
                <span className={`flex min-h-7 min-w-0 flex-1 items-center text-muted-foreground ${typeStyle("caption.default")}`}>
                  <span className="truncate">
                  {!ownEmail(previewed.brokerOrgId)
                    ? "Uses the template · edit here for this provider only"
                    : !edits[previewed.brokerOrgId] && savedEdits.get(previewed.brokerOrgId)?.source === "agent"
                      ? "From the AI panel"
                      : "Edited · saved automatically"}
                  </span>
                </span>
                {ownEmail(previewed.brokerOrgId) ? (
                  <PillButton
                    type="button"
                    size="compact"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => revertToTemplate(previewed.brokerOrgId)}
                  >
                    Use the template
                  </PillButton>
                ) : null}
              </div>
            ) : null}
          </section>
        </AppShellPortal>
      ) : null}
    </SettingsDrawer>
  );
}

/** One provider's own email in a mail merge, edited in the preview panel. */
function ProviderEmailEditor({
  provider,
  candidate,
  email,
  signature,
  disabled,
  onChange,
}: {
  provider: { brokerName: string | null; recipient?: { email: string; name: string | null } | null };
  candidate?: ProviderCandidateView;
  email: Email;
  signature?: string;
  disabled: boolean;
  onChange: (email: Email) => void;
}) {
  return (
    <div className={typeStyle("body.default")}>
      <EmailComposeRow label="To">
        {provider.recipient ? (
          <ProviderContactPill
            provider={{
              name: candidate?.name ?? provider.brokerName ?? "Provider",
              iconUrl: candidate?.iconUrl,
              website: candidate?.website,
            }}
            name={provider.recipient.name}
            email={provider.recipient.email}
          />
        ) : null}
      </EmailComposeRow>
      <EmailComposeRow label="Subject">
        <EmailComposeInput
          aria-label="Subject for this provider"
          maxLength={200}
          value={email.subject}
          disabled={disabled}
          onChange={(event) => onChange({ ...email, subject: event.target.value })}
        />
      </EmailComposeRow>
      <ReplyEditor
        label={`Email to ${candidate?.name ?? provider.brokerName ?? "provider"}`}
        placeholder="Write the email…"
        value={email.body}
        disabled={disabled}
        variables={MERGE_VARIABLES}
        scrollClassName="max-h-none overflow-visible"
        footer={signature}
        suggestions={[]}
        suggesting={false}
        onChange={(body) => onChange({ ...email, body })}
        onFocusChange={() => {}}
        onSubmit={() => {}}
        onEscape={() => {}}
      />
    </div>
  );
}

/** One provider's email exactly as merged, with its link shown as a placeholder until sent. */
function EmailPreview({
  provider,
  candidate,
  signature,
}: {
  provider: {
    brokerName: string | null;
    recipient?: { email: string; name: string | null } | null;
    email?: { subject: string; body: string } | null;
  };
  candidate?: ProviderCandidateView;
  signature?: string;
}) {
  if (!provider.email) return null;
  const [before, ...after] = provider.email.body.split(APPLICATION_LINK);
  return (
    <div className={typeStyle("body.default")}>
      <EmailComposeRow label="To">
        {provider.recipient ? (
          <ProviderContactPill
            provider={{
              name: candidate?.name ?? provider.brokerName ?? "Provider",
              iconUrl: candidate?.iconUrl,
              website: candidate?.website,
            }}
            name={provider.recipient.name}
            email={provider.recipient.email}
          />
        ) : null}
      </EmailComposeRow>
      <EmailComposeRow label="Subject">
        <span className="min-w-0 break-words pl-0.5">{provider.email.subject}</span>
      </EmailComposeRow>
      <div className="px-4 pt-2.5 whitespace-pre-wrap break-words">
        {before}
        {after.map((rest, index) => (
          <span key={index}>
            <span className="text-primary underline">Review the full application and supporting documents</span>
            {rest}
          </span>
        ))}
      </div>
      {signature ? <p className="mt-3 px-4 pb-4 whitespace-pre-line text-muted-foreground">{signature}</p> : null}
    </div>
  );
}

/** One provider contact in a mail merge: provider logo and contact name, address on hover; click to preview its email. */
function RecipientPill({
  candidate,
  recipient,
  skipped,
  edited,
  active,
  onPreview,
  onRemove,
}: {
  candidate: ProviderCandidateView;
  recipient?: { email: string; name: string | null } | null;
  skipped: boolean;
  /** Has its own email instead of the template. */
  edited: boolean;
  active: boolean;
  onPreview: () => void;
  onRemove?: () => void;
}) {
  return (
    <span
      title={
        skipped
          ? `${candidate.name} will be skipped`
          : recipient
            ? `${recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email} · ${candidate.name}${edited ? " · own email" : ""}`
            : candidate.name
      }
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1 rounded-full bg-muted p-0.5 pr-2.5 has-[button[aria-label^=Remove]]:pr-1.5",
        typeStyle("body.large"),
        skipped && "opacity-50",
        active && "ring-1 ring-ring",
      )}
    >
      <button type="button" className="inline-flex min-w-0 items-center gap-1" onClick={onPreview}>
        <OrgBrandIcon
          name={candidate.name}
          website={candidate.website ?? undefined}
          iconUrl={candidate.iconUrl ?? undefined}
          size="xs"
          shape="circle"
        />
        <span className="min-w-0 truncate">{recipient?.name ?? recipient?.email ?? candidate.name}</span>
        {edited ? <Pencil aria-label="Own email" className="size-3 shrink-0 text-muted-foreground" /> : null}
      </button>
      {onRemove ? <TagRemoveButton label={`Remove ${candidate.name}`} onClick={onRemove} /> : null}
    </span>
  );
}
