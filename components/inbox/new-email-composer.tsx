"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import dayjs from "dayjs";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  EmailComposeInput,
  EmailComposeRow,
  parseEmailAddressList,
} from "@/components/email/compose-fields";
import {
  EmailComposerBar,
  followUpsRequest,
  type FollowUps,
} from "@/components/email/email-composer";
import { ReplyEditor, replyBlanks, type BlankSuggestion } from "@/components/inbox/reply-editor";
import { AddressField, FromPicker } from "@/components/email/operator-address";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { PillButton } from "@/components/ui/pill-button";
import { SearchableSelect } from "@claritylabs-inc/ui/components/searchable-select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  useCachedOperatorClients,
  useCachedOperatorCurrent,
} from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { useSharedValue } from "@/hooks/use-shared-value";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const PREVIEW_DELAY_MS = 450;

type Draft = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  message: string;
  clientOrgId: string;
  /** Files the conversation under a procurement request (and its client). */
  requestId?: string;
  /** Asks the client to complete this information form. */
  informationFormId?: string;
  /** Sent as this operator instead of the signed-in one. */
  fromUserId?: string;
  /** Nudge the recipient until someone replies. */
  followUps?: FollowUps | null;
  showCopies: boolean;
};
const NO_SUGGESTIONS: BlankSuggestion[] = [];
const EMPTY: Draft = { to: "", cc: "", bcc: "", subject: "", message: "", clientOrgId: "", showCopies: false };

/** The request a composer opened from a request workspace files its email under. */
export type ComposerRequest = {
  requestId: Id<"procurementRequests">;
  clientOrgId: Id<"organizations">;
  title: string;
};

/** A kept draft picks up the form invitation it was opened without. */
function withInvitation(saved: Draft | undefined, invitation?: string) {
  if (!saved || !invitation || saved.message.includes(invitation)) return saved;
  return { ...saved, message: [saved.message, invitation].filter(Boolean).join("\n\n") };
}

/** One send of one exact email; it stays locked until the server gives a definitive outcome. */
type SendAttempt = { key: string; fingerprint: string; draft: Draft; startedAt: number };

// Scoped to the signed-in operator so a reload keeps a locked send and a
// sign-out never hands it (or an unsent draft) to the next person.
const attemptKey = (operatorId: string) => `teamCompose:attempt:${operatorId}`;
const drafts = new Map<string, Draft>();

function readAttempt(operatorId: string): SendAttempt | null {
  try {
    const raw = window.sessionStorage.getItem(attemptKey(operatorId));
    return raw ? (JSON.parse(raw) as SendAttempt) : null;
  } catch {
    return null;
  }
}

function writeAttempt(operatorId: string, attempt: SendAttempt | null) {
  try {
    if (attempt) window.sessionStorage.setItem(attemptKey(operatorId), JSON.stringify(attempt));
    else window.sessionStorage.removeItem(attemptKey(operatorId));
  } catch {
    // The component state still locks this session.
  }
}

function useDebounced<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function composeArgs(draft: Draft) {
  return {
    to: draft.to.trim(),
    cc: parseEmailAddressList(draft.cc),
    bcc: parseEmailAddressList(draft.bcc),
    subject: draft.subject,
    message: draft.message,
    ...(draft.clientOrgId ? { clientOrgId: draft.clientOrgId as Id<"organizations"> } : {}),
    ...(draft.requestId ? { requestId: draft.requestId as Id<"procurementRequests"> } : {}),
    ...(draft.informationFormId
      ? { informationFormId: draft.informationFormId as Id<"procurementInformationForms"> }
      : {}),
    ...(draft.fromUserId ? { fromUserId: draft.fromUserId as Id<"users"> } : {}),
  };
}

/**
 * A new email from the signed-in operator's team address. The server composes
 * the exact email (From, Always CC, signature) and returns a fingerprint; Send
 * is enabled only for a preview of the email as it stands and sends against
 * that fingerprint. A send stays locked until the server reports whether it
 * went, so it can never go twice.
 */
export function NewEmailComposer(props: {
  onClose: () => void;
  onSent: (threadId: Id<"teamEmailThreads"> | null) => void;
  /** Opened from a request: the email is filed under it and its providers are offered as recipients. */
  request?: ComposerRequest;
  /** Followed id of this inbox draft, so a teammate following along edits the same one. */
  draftId?: string;
  /**
   * Asking the client for the answers to an information form: the email goes to a
   * client contact and its follow-ups are tracked against the form, so they stop
   * once the form is submitted. Needs `request`.
   */
  informationForm?: { id: Id<"procurementInformationForms">; title?: string; initialText?: string };
}) {
  const operatorId = useCachedOperatorCurrent()?.user._id;
  if (!operatorId) return null;
  return <OperatorNewEmailComposer key={operatorId} operatorId={operatorId} {...props} />;
}

function OperatorNewEmailComposer({
  operatorId,
  onClose,
  onSent,
  request,
  draftId,
  informationForm,
}: {
  operatorId: string;
  onClose: () => void;
  onSent: (threadId: Id<"teamEmailThreads"> | null) => void;
  request?: ComposerRequest;
  draftId?: string;
  informationForm?: { id: Id<"procurementInformationForms">; title?: string; initialText?: string };
}) {
  const send = useAction(api.actions.teamEmailCompose.send);
  const formId = request ? informationForm?.id : undefined;
  const clients = useCachedOperatorClients();
  const clientContacts = useQuery(
    api.clientOutreach.recipientOptions,
    request ? { requestId: request.requestId } : "skip",
  );
  const providerContacts = useQuery(
    api.brokerContacts.listForRequest,
    request ? { requestId: request.requestId } : "skip",
  );
  const requestClient = clients?.find(
    (client) => client._id === request?.clientOrgId,
  );
  const suggestedRecipients = useMemo(
    () => [
      ...(clientContacts ?? []).map((contact) => ({
        email: contact.email,
        name: contact.name,
        group: "Client",
        ...(requestClient
          ? {
              org: {
                name: requestClient.name,
                iconUrl: requestClient.iconUrl,
                website: requestClient.website,
              },
            }
          : {}),
      })),
      ...(providerContacts ?? []).map((contact) => ({
        email: contact.email,
        name: contact.name,
        group: contact.brokerName,
        org: {
          name: contact.brokerName,
          iconUrl: contact.brokerIconUrl,
          website: contact.brokerWebsite,
        },
      })),
    ],
    [clientContacts, providerContacts, requestClient],
  );
  // Request drafts are kept apart from the inbox's own unsent email.
  const draftKey = request
    ? `${operatorId}:${request.requestId}${formId ? `:form:${formId}` : ""}`
    : operatorId;
  const [attempt, setAttempt] = useState<SendAttempt | null>(() => readAttempt(operatorId));
  const [draft, setDraft] = useState<Draft>(
    () =>
      attempt?.draft ??
      withInvitation(drafts.get(draftKey), informationForm?.initialText) ??
      (request
        ? {
            ...EMPTY,
            subject: (formId ? `Information needed: ${informationForm?.title ?? request.title}` : request.title).slice(0, 200),
            message: informationForm?.initialText ?? "",
            clientOrgId: request.clientOrgId,
            requestId: request.requestId,
            ...(formId ? { informationFormId: formId, followUps: { cadence: null } } : {}),
          }
        : EMPTY),
  );
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const locked = attempt !== null;
  const update = (patch: Partial<Draft>) =>
    setDraft((current) => {
      const next = { ...current, ...patch };
      drafts.set(draftKey, next);
      return next;
    });

  // Teammates on the request, or following this inbox draft, edit it together.
  const scope = request ? `request-email:${request.requestId}` : `inbox-email:${draftId ?? operatorId}`;
  useSharedValue(`${scope}:client`, draft.clientOrgId, (clientOrgId) => update({ clientOrgId }));
  useSharedValue(`${scope}:copies`, draft.showCopies, (showCopies) => update({ showCopies }));
  useSharedValue(`${scope}:from`, draft.fromUserId ?? null, (fromUserId) =>
    update({ fromUserId: fromUserId ?? undefined }),
  );
  useSharedValue(`${scope}:follow-ups`, draft.followUps ?? null, (followUps) =>
    update({ followUps }),
  );

  // Asking a client about a form starts with the first client contact as the recipient.
  const defaultTo = formId ? (clientContacts?.[0]?.email ?? "") : "";
  const effective = useMemo(
    () => (draft.to.trim() || !defaultTo ? draft : { ...draft, to: defaultTo }),
    [draft, defaultTo],
  );
  const settled = useDebounced(effective, PREVIEW_DELAY_MS);
  const ready = Boolean(settled.to.trim() && settled.subject.trim() && settled.message.trim());
  const result = useQuery(api.teamEmailCompose.preview, !locked && ready ? composeArgs(settled) : "skip");
  const current = settled === effective;
  const preview = current && result?.ok ? result.preview : null;
  const typedCc = parseEmailAddressList(draft.cc).map((address) => address.toLowerCase());
  const addedCc = (preview?.cc ?? []).filter((address) => !typedCc.includes(address));
  const problem = current && result && !result.ok ? result.reason : null;
  const status = useQuery(
    api.teamEmailCompose.status,
    attempt
      ? {
          idempotencyKey: attempt.key,
          ...(attempt.draft.fromUserId
            ? { fromUserId: attempt.draft.fromUserId as Id<"users"> }
            : {}),
        }
      : "skip",
  );

  // The action's answer and the status query can both report the same send.
  const finished = useRef<string | null>(null);
  function finish(key: string, threadId: Id<"teamEmailThreads"> | null, captured: boolean) {
    if (finished.current === key) return;
    finished.current = key;
    writeAttempt(operatorId, null);
    drafts.delete(draftKey);
    setAttempt(null);
    toast.success(captured ? "Email captured locally; nothing was sent" : "Email sent");
    onSent(threadId);
  }

  // A lost response is resolved by the server's record of the key.
  const confirmed = attempt !== null && status?.state === "sent" ? status : null;
  // Syncs this form to the server's record, so it runs in an effect that always commits.
  useEffect(() => {
    if (!confirmed) return;
    finish(attempt!.key, confirmed.teamEmailThreadId, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed?.pendingEmailId]);

  async function submit(retry?: SendAttempt) {
    if (sending || (!retry && replyBlanks(draft.message).length > 0)) return;
    const next =
      retry ??
      (preview
        ? { key: crypto.randomUUID(), fingerprint: preview.fingerprint, draft: effective, startedAt: dayjs().valueOf() }
        : null);
    if (!next) return;
    writeAttempt(operatorId, next);
    setAttempt(next);
    setNote(null);
    setSending(true);
    try {
      const outcome = await send({
        ...composeArgs(next.draft),
        expectedFingerprint: next.fingerprint,
        idempotencyKey: next.key,
        followUps: followUpsRequest(next.draft.followUps ?? null),
      });
      if (outcome.status === "sent") finish(next.key, outcome.teamEmailThreadId, outcome.captured);
      else if (outcome.status === "not_sent") {
        writeAttempt(operatorId, null);
        setAttempt(null);
        toast.error(outcome.message);
      } else setNote(outcome.message);
    } catch (error) {
      // A lost response may still be a running send: stay locked.
      setNote(getUserFacingErrorMessage(error, "We couldn’t confirm this email was sent."));
    } finally {
      setSending(false);
    }
  }

  const clientOptions = useMemo(
    () => (clients ?? []).map((client) => ({ value: client._id, label: client.name })),
    [clients],
  );
  const disabled = sending || locked;
  const blanks = replyBlanks(draft.message).length;

  return (
    <SettingsDrawer
      open
      title="New email"
      contentClassName="-mx-4 my-0 flex-1"
      onOpenChange={(open) => {
        if (!open && !sending) onClose();
      }}
      footer={
        <EmailComposerBar
          className="w-full"
          blanks={blanks}
          sending={sending}
          canSend={Boolean(preview) && !locked}
          onSend={() => void submit()}
          followUps={{
            followKey: scope,
            value: draft.followUps ?? null,
            disabled,
            onChange: (followUps) => update({ followUps }),
            ...(formId
              ? {
                  title: "Nudge the client until they reply or submit the form",
                  note: "Follow-ups stop when the client replies or submits the form.",
                }
              : {}),
          }}
          note={problem ? <span role="alert">{problem}</span> : null}
          actions={
            <PillButton
              size="compact"
              type="button"
              variant="ghost"
              label="Discard email"
              aria-label="Discard email"
              disabled={disabled}
              onClick={() => {
                drafts.delete(draftKey);
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
          // The message editor sends on its own.
          if (event.defaultPrevented) return;
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      >
        {attempt ? (
          <div role="alert" className={`flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-2 ${typeStyle("caption.default")}`}>
            <p className="min-w-0 flex-1 text-foreground">
              {sending
                ? "Sending…"
                : (note ?? "This email is locked until the server confirms whether it was sent.")}
            </p>
            {sending ? null : (
              <PillButton type="button" size="compact" variant="ghost" onClick={() => void submit(attempt)}>
                Retry same email
              </PillButton>
            )}
          </div>
        ) : null}
        <EmailComposeRow label="From">
          <FromPicker
            value={(draft.fromUserId ?? operatorId) as Id<"users">}
            onChange={(userId) =>
              update({ fromUserId: userId === operatorId ? undefined : userId })
            }
            disabled={disabled}
          />
        </EmailComposeRow>
        <EmailComposeRow label="To">
          <AddressField
            label="To"
            max={1}
            autoFocus
            placeholder="name@company.com"
            value={parseEmailAddressList(effective.to)}
            disabled={disabled}
            suggested={suggestedRecipients}
            onChange={(to) => update({ to: to[0] ?? "" })}
          />
          {draft.showCopies ? null : (
            <PillButton type="button" size="compact" variant="ghost" onClick={() => update({ showCopies: true })}>
              Cc Bcc
            </PillButton>
          )}
        </EmailComposeRow>
        {draft.showCopies || preview?.cc.length ? (
          <EmailComposeRow label="Cc">
            <AddressField
              label="Cc"
              placeholder="Add people to copy"
              // The sender's Always CC comes from the preview and can't be removed here.
              value={[...typedCc, ...addedCc]}
              fixed={addedCc}
              disabled={disabled}
              onChange={(cc) =>
                update({
                  cc: cc.filter((address) => !addedCc.includes(address)).join(", "),
                  showCopies: true,
                })
              }
            />
          </EmailComposeRow>
        ) : null}
        {draft.showCopies ? (
          <EmailComposeRow label="Bcc">
            <EmailComposeInput
              aria-label="Bcc"
              placeholder="Separate addresses with commas"
              value={draft.bcc}
              disabled={disabled}
              onChange={(event) => update({ bcc: event.target.value })}
            />
          </EmailComposeRow>
        ) : null}
        <EmailComposeRow label="Subject">
          <EmailComposeInput
            aria-label="Subject"
            maxLength={200}
            value={draft.subject}
            disabled={disabled}
            onChange={(event) => update({ subject: event.target.value })}
          />
        </EmailComposeRow>
        {draft.requestId ? (
          <EmailComposeRow label="Request">
            <p className={`truncate ${typeStyle("body.default")}`}>
              {preview?.request?.title ?? request?.title ?? "This request"}
            </p>
          </EmailComposeRow>
        ) : (
        <EmailComposeRow label="Client">
          <div className="w-full [&_button[role=combobox]]:border-transparent! [&_button[role=combobox]]:bg-transparent! [&_button[role=combobox]]:px-0!">
            <SearchableSelect
              ariaLabel="Client"
              typographyRole="control.menu"
              value={draft.clientOrgId}
              options={clientOptions}
              disabled={disabled}
              onChange={(value) => update({ clientOrgId: value })}
              placeholder="Not linked"
            />
          </div>
        </EmailComposeRow>
        )}
        <ReplyEditor
          placeholder="Write your email…"
          value={draft.message}
          disabled={sending}
          readOnly={locked}
          scrollClassName="max-h-none pt-4"
          footer={preview?.signature}
          suggestions={NO_SUGGESTIONS}
          suggesting={false}
          collabKey={`${scope}:message`}
          onChange={(message) => update({ message })}
          onFocusChange={() => {}}
          onSubmit={() => void submit()}
          onEscape={() => {}}
        />
      </div>
    </SettingsDrawer>
  );
}
