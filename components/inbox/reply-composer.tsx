"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import dayjs from "dayjs";
import { ChevronDown, Loader2, Reply, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  EmailComposeMessage,
  EmailComposeRow,
} from "@/components/email/compose-fields";
import { LogoIcon } from "@/components/ui/logo-icon";
import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AddressField,
  AddressPills,
  FromPicker,
  useOperatorDirectory,
} from "@/components/email/operator-address";
import { useFollowedState } from "@/hooks/use-followed-state";
import { useActiveOperators } from "@/hooks/use-operator-presence";
import { useSharedValue } from "@/hooks/use-shared-value";
import { useCachedOperatorCurrent } from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const PREVIEW_DELAY_MS = 450;
/** Left in a suggested reply where Spot lacks a fact the sender asked for. */
const NEEDS_MARKER = "[needs:";

/** Spot's suggested reply to the conversation's newest message. */
export type ReplySuggestion = {
  messageId: string;
  status: "pending" | "ready";
  reply: string | null;
  missing: string[];
  /** Changes whenever the suggestion is rewritten, for example from the AI panel. */
  revision: number;
};

/** One send of one exact email. It lives from before the action starts until a definitive outcome. */
type SendAttempt = {
  key: string;
  text: string;
  fingerprint: string;
  startedAt: number;
  /** The operator it is sent as, when not the signed-in one. */
  fromUserId?: Id<"users">;
  /** The To and Cc set in the composer, when not the reply-all default. */
  recipients?: ReplyRecipients;
};

type ReplyRecipients = { to: string; cc: string[] };

// Storage is scoped to the signed-in operator and the conversation, so a
// reload keeps a locked send and a sign-out never hands it to the next user.
const scope = (operatorId: string, threadId: string) => `${operatorId}:${threadId}`;
const attemptStorageKey = (id: string) => `teamReply:attempt:${id}`;
const memoryAttempts = new Map<string, SendAttempt>();
const replyDrafts = new Map<string, string>();
// Each suggestion revision fills the box once; discarding it never brings it back.
const usedSuggestions = new Set<string>();
// The text last filled from a suggestion: a box still holding it was not edited.
const filledSuggestions = new Map<string, string>();

function readAttempt(id: string): SendAttempt | null {
  try {
    const raw = window.sessionStorage.getItem(attemptStorageKey(id));
    if (!raw) return memoryAttempts.get(id) ?? null;
    const value = JSON.parse(raw) as Partial<SendAttempt>;
    return typeof value.key === "string" &&
      typeof value.text === "string" &&
      typeof value.fingerprint === "string" &&
      typeof value.startedAt === "number"
      ? (value as SendAttempt)
      : null;
  } catch {
    return memoryAttempts.get(id) ?? null;
  }
}

function writeAttempt(id: string, attempt: SendAttempt | null) {
  if (attempt) memoryAttempts.set(id, attempt);
  else memoryAttempts.delete(id);
  try {
    if (attempt)
      window.sessionStorage.setItem(attemptStorageKey(id), JSON.stringify(attempt));
    else window.sessionStorage.removeItem(attemptStorageKey(id));
  } catch {
    // The in-memory copy still locks this tab session.
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

/**
 * Reply box for a team conversation. The server composes the exact email (From,
 * recipients, signature, quoted history) and returns a fingerprint; Send is
 * enabled only for a preview of the text as it currently stands, and sends
 * against that fingerprint. Recipients are never guessed here.
 *
 * A send is recorded before the action starts and stays locked until the
 * server reports a definitive outcome: `sent` (or the status query saying so)
 * clears it, `not_sent` unlocks it for a fresh preview and key. A pending or
 * lost response never unlocks; the only way forward is retrying the same email
 * under the same key, which the server resumes without a second send.
 */
export function ReplyComposer(props: {
  threadId: Id<"teamEmailThreads">;
  recipient: string | null;
  suggestion: ReplySuggestion | null;
  onSendingChange: (sending: boolean) => void;
  /** True while the composer is focused with text, for presence. */
  onReplyingChange: (replying: boolean) => void;
}) {
  const operatorId = useCachedOperatorCurrent()?.user._id;
  if (!operatorId) return null;
  return <OperatorReplyComposer key={operatorId} operatorId={operatorId} {...props} />;
}

function OperatorReplyComposer({
  operatorId,
  threadId,
  recipient,
  suggestion,
  onSendingChange,
  onReplyingChange,
}: {
  operatorId: string;
  threadId: Id<"teamEmailThreads">;
  recipient: string | null;
  suggestion: ReplySuggestion | null;
  onSendingChange: (sending: boolean) => void;
  onReplyingChange: (replying: boolean) => void;
}) {
  const id = scope(operatorId, threadId);
  const sendReply = useAction(api.actions.teamEmailReplies.send);
  const [attempt, setAttempt] = useState<SendAttempt | null>(() => readAttempt(id));
  // Who it is sent from, shared with everyone writing this reply together.
  const [fromUserId, setFromUserId] = useState<Id<"users">>(
    () => attempt?.fromUserId ?? (operatorId as Id<"users">),
  );
  useSharedValue(`reply:${threadId}:from`, fromUserId, setFromUserId);
  // Edited To and Cc; null keeps the server's reply-all default.
  const [recipients, setRecipients] = useState<ReplyRecipients | null>(
    () => attempt?.recipients ?? null,
  );
  useSharedValue(`reply:${threadId}:recipients`, recipients, setRecipients);
  const missingTo = recipients !== null && !recipients.to;
  const sendingAs = fromUserId === operatorId ? undefined : fromUserId;
  const { operators, find } = useOperatorDirectory();
  const senderName = operators?.find((person) => person.userId === fromUserId)?.name;
  const coEditors = useActiveOperators().filter(
    (person) =>
      !person.self &&
      person.emailThreadId === threadId &&
      person.activity === "replying",
  );
  const [text, setText] = useState(() => readAttempt(id)?.text ?? replyDrafts.get(id) ?? "");
  const [serverNote, setServerNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [focused, setFocused] = useState(false);
  const [showFull, setShowFull] = useFollowedState(`inbox:reply:${threadId}:show-full`, false);
  // A key belongs to one exact text and fingerprint: unchanged, it is reused.
  const sendKey = useRef<{ key: string; text: string; fingerprint: string } | null>(null);

  const locked = attempt !== null;
  const hasText = text.trim().length > 0;
  const needsInput = text.includes(NEEDS_MARKER);
  useEffect(() => {
    onReplyingChange(focused && hasText && !locked);
  }, [focused, hasText, locked, onReplyingChange]);
  useEffect(() => () => onReplyingChange(false), [onReplyingChange]);

  const settled = useDebounced(text, PREVIEW_DELAY_MS);
  const previewResult = useQuery(
    api.teamEmailReplies.preview,
    !locked && settled.trim() && !missingTo
      ? {
          threadId,
          message: settled,
          fromUserId: sendingAs,
          ...(recipients ? { recipients } : {}),
        }
      : "skip",
  );
  const current = !locked && settled === text && hasText;
  const preview = current && previewResult?.ok ? previewResult.preview : null;
  // Headers stay put while the next preview loads; Send still needs the current one.
  const [lastHeaders, setLastHeaders] = useState<typeof preview>(null);
  if (preview && preview !== lastHeaders) setLastHeaders(preview);
  const headers = hasText ? (preview ?? lastHeaders) : null;
  const [open, setOpen] = useFollowedState(`inbox:reply:${threadId}:open`, false);
  const [minimized, setMinimized] = useState(false);
  const previewError = current && previewResult && !previewResult.ok ? previewResult.reason : null;
  const previewing = !locked && hasText && !missingTo && !preview && !previewError;
  const shownTo = recipients ? (recipients.to ? [recipients.to] : []) : (headers?.to ?? []);
  const shownCc = recipients?.cc ?? headers?.cc ?? [];
  const editRecipients = (next: Partial<ReplyRecipients>) =>
    setRecipients({ to: shownTo[0] ?? "", cc: shownCc, ...next });

  // The server's record of this key; only `sent` is a positive answer.
  const status = useQuery(
    api.teamEmailReplies.status,
    attempt
      ? { idempotencyKey: attempt.key, fromUserId: attempt.fromUserId }
      : "skip",
  );

  function update(value: string) {
    setText(value);
    if (value) replyDrafts.set(id, value);
    else replyDrafts.delete(id);
  }

  // An empty or unedited box takes Spot's latest suggestion; edits are never overwritten.
  const suggestionKey = suggestion ? `${id}:${suggestion.messageId}:${suggestion.revision}` : null;
  const suggested = suggestion?.status === "ready" ? suggestion.reply : null;
  const [fromSuggestion, setFromSuggestion] = useState(false);
  const unedited = !hasText || text === filledSuggestions.get(id);
  const pendingRevision =
    suggestionKey && suggested && !locked && !usedSuggestions.has(suggestionKey) && text !== suggested;
  function takeSuggestion() {
    if (!suggestionKey || !suggested) return;
    usedSuggestions.add(suggestionKey);
    filledSuggestions.set(id, suggested);
    update(suggested);
    setFromSuggestion(true);
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (pendingRevision && unedited) takeSuggestion();
  });
  const drafting = suggestion?.status === "pending" && !hasText && !locked;

  // The server saying "sent" is the one positive answer. Clearing runs in an
  // effect so it always commits; it syncs this form to a subscription.
  const confirmedSent = attempt !== null && status?.state === "sent";
  useEffect(() => {
    if (!confirmedSent) return;
    replyDrafts.delete(id);
    sendKey.current = null;
    writeAttempt(id, null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText("");
    setRecipients(null);
    setAttempt(null);
    setServerNote(null);
  }, [confirmedSent, id]);

  async function send(retry?: SendAttempt) {
    if (sending || (!retry && needsInput)) return;
    let next = retry ?? null;
    if (!next && preview) {
      const reusable =
        sendKey.current?.text === text && sendKey.current.fingerprint === preview.fingerprint;
      sendKey.current = reusable
        ? sendKey.current
        : { key: crypto.randomUUID(), text, fingerprint: preview.fingerprint };
      next = {
        ...sendKey.current!,
        startedAt: dayjs().valueOf(),
        ...(sendingAs ? { fromUserId: sendingAs } : {}),
        ...(recipients ? { recipients } : {}),
      };
    }
    if (!next) return;
    // Recorded first: if this tab dies mid-send, the lock survives a reload.
    writeAttempt(id, next);
    setAttempt(next);
    setServerNote(null);
    setSending(true);
    onSendingChange(true);
    try {
      const result = await sendReply({
        threadId,
        message: next.text,
        expectedFingerprint: next.fingerprint,
        idempotencyKey: next.key,
        fromUserId: next.fromUserId,
        recipients: next.recipients,
      });
      if (result.status === "sent") {
        setText("");
        // The next reply starts from the signed-in operator again.
        setFromUserId(operatorId as Id<"users">);
        setRecipients(null);
        replyDrafts.delete(id);
        sendKey.current = null;
        writeAttempt(id, null);
        setAttempt(null);
        setServerNote(null);
        toast.success(
          result.captured ? "Reply captured locally; nothing was sent" : "Reply sent",
        );
      } else if (result.status === "not_sent") {
        sendKey.current = null;
        writeAttempt(id, null);
        setAttempt(null);
        toast.error(result.message);
      } else {
        setServerNote(result.message);
      }
    } catch (error) {
      // A lost response may still be a running send: stay locked.
      setServerNote(getUserFacingErrorMessage(error, "We couldn’t confirm this reply was sent."));
    } finally {
      setSending(false);
      onSendingChange(false);
    }
  }

  return (
    // Teammates on the thread write this reply together.
    <div data-collab-scope={`reply:${threadId}`} className="w-full space-y-2">
      {attempt ? (
        <div role="alert" className={`space-y-2 rounded-md bg-muted/50 p-3 ${typeStyle("caption.default")}`}>
          <p className="text-foreground">
            {sending
              ? "Sending…"
              : (serverNote ??
                "This reply is locked until the server confirms whether it was sent.")}{" "}
            {sending ? null : "This reply stays locked to prevent duplicates."}
          </p>
          <div className="flex justify-end">
            <PillButton type="button" size="compact" disabled={sending} onClick={() => void send(attempt)}>
              {sending ? "Retrying…" : "Retry same email"}
            </PillButton>
          </div>
        </div>
      ) : null}
      {!minimized && (open || locked || hasText) ? (
        // Flush with the panel footer: the footer is already the frame.
        <div className="-mx-4 -my-3">
          <EmailComposeRow label="From">
            <FromPicker
              value={fromUserId}
              onChange={setFromUserId}
              disabled={sending || locked}
            />
          </EmailComposeRow>
          <EmailComposeRow label="To">
            {headers || recipients ? (
              <AddressField
                label="To"
                max={1}
                threadId={threadId}
                value={shownTo}
                disabled={sending || locked}
                onChange={(to) => editRecipients({ to: to[0] ?? "" })}
              />
            ) : (
              <span className="min-w-0 truncate pl-0.5 text-muted-foreground">
                {recipient ?? "Everyone on the latest message"}
              </span>
            )}
          </EmailComposeRow>
          {headers || recipients ? (
            <EmailComposeRow label="Cc">
              <AddressField
                label="Cc"
                threadId={threadId}
                value={shownCc}
                fixed={headers?.fixedCc ?? []}
                disabled={sending || locked}
                placeholder="Add people to copy"
                onChange={(cc) => editRecipients({ cc })}
              />
            </EmailComposeRow>
          ) : null}
          {headers?.bcc.length ? (
            <EmailComposeRow label="Bcc">
              <AddressPills addresses={headers.bcc} />
            </EmailComposeRow>
          ) : null}
          {headers ? (
            <EmailComposeRow label="Subject">
              <span className="min-w-0 truncate pl-0.5">{headers.subject}</span>
            </EmailComposeRow>
          ) : null}
          <EmailComposeMessage
            aria-label="Reply"
            autoFocus={!locked}
            placeholder={recipient ? `Reply to ${recipient}` : "Write a reply"}
            value={text}
            disabled={sending}
            readOnly={locked}
            onChange={(event) => update(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void send();
              }
              if (event.key === "Escape" && !hasText && !locked) setOpen(false);
            }}
            className="block max-h-72 min-h-28"
          />
          {previewing || previewError || preview || needsInput || missingTo || (fromSuggestion && hasText) || pendingRevision || sendingAs || coEditors.length ? (
            <div className={`space-y-1 px-4 pb-2 text-muted-foreground ${typeStyle("caption.default")}`}>
              {pendingRevision && !unedited ? (
                <p className="flex items-center gap-1.5">
                  <LogoIcon size={12} className="shrink-0" />
                  Spot has a new draft.
                  <button type="button" className="text-foreground underline" onClick={takeSuggestion}>
                    Replace yours
                  </button>
                </p>
              ) : null}
              {sendingAs ? (
                <p>
                  Sending as {senderName ?? "a teammate"}: it goes from their
                  address and is signed as them.
                </p>
              ) : null}
              {coEditors.length ? (
                <p>
                  {coEditors.map((person) => person.name.split(" ")[0]).join(" and ")}{" "}
                  {coEditors.length === 1 ? "is" : "are"} also editing this reply.
                </p>
              ) : null}
              {fromSuggestion && hasText ? (
                <p className="flex items-center gap-1.5">
                  <LogoIcon size={12} className="shrink-0" />
                  Drafted by Spot. Review it before sending.
                </p>
              ) : null}
              {needsInput ? (
                <p role="alert">Fill in each {NEEDS_MARKER} …] before sending.</p>
              ) : null}
              {missingTo ? <p role="alert">Add a recipient.</p> : null}
              {previewing ? <p>Preparing preview…</p> : null}
              {previewError ? <p role="alert">{previewError}</p> : null}
              {preview?.copiesOwner ? (
                <p>
                  {find(preview.copiesOwner)?.name ?? preview.copiesOwner} is copied as the
                  conversation owner.
                </p>
              ) : null}
              {preview?.mode === "standalone" ? (
                <p>
                  Sent from {sendingAs ? `${senderName ?? "their"}’s` : "your own"} inbox as a
                  new email; it stays in this conversation.
                </p>
              ) : null}
              {preview?.stopsFollowUps ? (
                <p>Sending stops this conversation’s automatic follow-ups.</p>
              ) : null}
              {preview && showFull ? (
                <pre className="max-h-48 overflow-auto rounded-md bg-muted/50 p-2 whitespace-pre-wrap break-words text-foreground">
                  {preview.text}
                </pre>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-center gap-2 border-t border-border px-4 py-2">
            <PillButton
              size="compact"
              type="button"
              title="Send (Ctrl or ⌘ + Enter)"
              disabled={!preview || sending || locked || needsInput}
              onClick={() => void send()}
            >
              {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              Send
            </PillButton>
            {preview ? (
              <PillButton
                size="compact"
                type="button"
                variant="ghost"
                aria-expanded={showFull}
                onClick={() => setShowFull((value) => !value)}
              >
                {showFull ? "Hide full email" : "Show full email"}
              </PillButton>
            ) : null}
            <PillButton
              size="compact"
              type="button"
              variant="ghost"
              className="ml-auto"
              label="Minimize draft"
              aria-label="Minimize draft"
              onClick={() => setMinimized(true)}
            >
              <ChevronDown className="size-3.5" />
            </PillButton>
            <PillButton
              size="compact"
              type="button"
              variant="ghost"
              label="Discard reply"
              aria-label="Discard reply"
              disabled={sending || locked}
              onClick={() => {
                update("");
                setRecipients(null);
                setFromSuggestion(false);
                setShowFull(false);
                setOpen(false);
                setMinimized(false);
              }}
            >
              <Trash2 className="size-3.5" />
            </PillButton>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setMinimized(false);
          }}
          className={`flex h-10 w-full items-center gap-2 rounded-lg border border-border px-3 text-left text-muted-foreground transition-colors hover:bg-muted/50 ${typeStyle("body.default")}`}
        >
          <Reply className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{hasText ? "Draft reply" : recipient ? `Reply to ${recipient}` : "Reply"}</span>
          {drafting ? (
            <span className={`flex shrink-0 items-center gap-1.5 ${typeStyle("caption.default")}`}>
              <LogoIcon size={12} className="animate-pulse" />
              Drafting a reply…
            </span>
          ) : null}
        </button>
      )}
    </div>
  );
}
