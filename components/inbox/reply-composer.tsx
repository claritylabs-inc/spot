"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import dayjs from "dayjs";
import { Loader2, Reply, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  EmailComposeMessage,
  EmailComposeRow,
} from "@/components/email/compose-fields";
import { PillButton } from "@/components/ui/pill-button";
import { TextLink } from "@/components/ui/text-link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { SendFrom, SendFromOptions } from "@/convex/lib/outreachIdentity";
import { useFollowedState } from "@/hooks/use-followed-state";
import { useCachedOperatorCurrent } from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const PREVIEW_DELAY_MS = 450;

/** One send of one exact email. It lives from before the action starts until a definitive outcome. */
type SendAttempt = {
  key: string;
  text: string;
  fingerprint: string;
  startedAt: number;
  /** The account the reviewed email goes out from; absent on attempts stored before Gmail sending. */
  sendFrom?: SendFrom;
};

// Storage is scoped to the signed-in operator and the conversation, so a
// reload keeps a locked send and a sign-out never hands it to the next user.
const scope = (operatorId: string, threadId: string) => `${operatorId}:${threadId}`;
const attemptStorageKey = (id: string) => `teamReply:attempt:${id}`;
const memoryAttempts = new Map<string, SendAttempt>();
const replyDrafts = new Map<string, string>();
// An explicit From choice for a conversation; absent means the server's default.
const replySendFrom = new Map<string, SendFrom>();

function readAttempt(id: string): SendAttempt | null {
  try {
    const raw = window.sessionStorage.getItem(attemptStorageKey(id));
    if (!raw) return memoryAttempts.get(id) ?? null;
    const value = JSON.parse(raw) as Partial<SendAttempt>;
    return typeof value.key === "string" &&
      typeof value.text === "string" &&
      typeof value.fingerprint === "string" &&
      typeof value.startedAt === "number"
      ? ({
          ...value,
          sendFrom: value.sendFrom === "spot" || value.sendFrom === "gmail" ? value.sendFrom : undefined,
        } as SendAttempt)
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

/** The server words a refused Gmail send in terms of reconnecting it; there is no fallback to Spot. */
export const isGmailReconnectMessage = (message: string) => /gmail/i.test(message) && /reconnect/i.test(message);

/** A refusal from the server, with the way out when the cause is a Gmail that needs reconnecting. */
export function ComposeProblem({ message }: { message: string }) {
  return (
    <p role="alert" className="flex flex-wrap items-baseline gap-x-2">
      <span>{message}</span>
      {isGmailReconnectMessage(message) ? <TextLink href="/operator/profile">Open Profile</TextLink> : null}
    </p>
  );
}

/**
 * The accounts this operator can send from. A preview carries them; until one
 * exists the connected Gmail (when active) is known from the connection itself.
 */
export function useSendFromOptions(fromPreview?: SendFromOptions): SendFromOptions | undefined {
  const connection = useQuery(api.operatorGmail.myConnection);
  const [last, setLast] = useState<SendFromOptions | undefined>(fromPreview);
  if (fromPreview && fromPreview !== last) setLast(fromPreview);
  const options = fromPreview ?? last;
  if (options?.gmail) return options;
  return connection?.status === "active"
    ? { spot: options?.spot ?? "Your Spot address", gmail: connection.address }
    : undefined;
}

/** The From value: a picker when a Gmail can send, otherwise the single static address. */
export function SendFromField({
  options,
  value,
  fallback,
  disabled,
  onChange,
}: {
  options: SendFromOptions | undefined;
  value: SendFrom;
  fallback: string;
  disabled: boolean;
  onChange: (value: SendFrom) => void;
}) {
  if (!options?.gmail) return <span className="min-w-0 truncate">{fallback}</span>;
  const labels: Record<SendFrom, string> = { spot: options.spot, gmail: options.gmail };
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next === "spot" || next === "gmail") onChange(next);
      }}
    >
      <SelectTrigger
        aria-label="Send from"
        className="-ml-2 h-8 w-auto max-w-full min-w-0 border-transparent bg-transparent px-2 shadow-none"
      >
        <SelectValue>{labels[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="spot">{labels.spot}</SelectItem>
        <SelectItem value="gmail">{labels.gmail}</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** Why the Cc row carries the sender's own Spot address when sending from Gmail. */
export function SpotCopyHint() {
  return (
    <span className={`text-muted-foreground ${typeStyle("caption.default")}`}>
      Copies your Spot address so replies reach Spot
    </span>
  );
}

function Recipients({ addresses }: { addresses: string[] }) {
  return addresses.map((address) => (
    <span
      key={address}
      className="inline-flex max-w-full min-w-0 items-center truncate rounded-full bg-muted px-2.5 py-0.5"
    >
      {address}
    </span>
  ));
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
  onSendingChange,
  onReplyingChange,
}: {
  operatorId: string;
  threadId: Id<"teamEmailThreads">;
  recipient: string | null;
  onSendingChange: (sending: boolean) => void;
  onReplyingChange: (replying: boolean) => void;
}) {
  const id = scope(operatorId, threadId);
  const sendReply = useAction(api.actions.teamEmailReplies.send);
  const [attempt, setAttempt] = useState<SendAttempt | null>(() => readAttempt(id));
  const [text, setText] = useState(() => readAttempt(id)?.text ?? replyDrafts.get(id) ?? "");
  const [serverNote, setServerNote] = useState<string | null>(null);
  const [sendFromChoice, setSendFromChoice] = useState<SendFrom | undefined>(
    () => readAttempt(id)?.sendFrom ?? replySendFrom.get(id),
  );
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [focused, setFocused] = useState(false);
  const [showFull, setShowFull] = useFollowedState(`inbox:reply:${threadId}:show-full`, false);
  // A key belongs to one exact text and fingerprint: unchanged, it is reused.
  const sendKey = useRef<{ key: string; text: string; fingerprint: string; sendFrom: SendFrom } | null>(null);

  const locked = attempt !== null;
  const hasText = text.trim().length > 0;
  useEffect(() => {
    onReplyingChange(focused && hasText && !locked);
  }, [focused, hasText, locked, onReplyingChange]);
  useEffect(() => () => onReplyingChange(false), [onReplyingChange]);

  const settled = useDebounced(text, PREVIEW_DELAY_MS);
  const previewResult = useQuery(
    api.teamEmailReplies.preview,
    !locked && settled.trim()
      ? { threadId, message: settled, ...(sendFromChoice ? { sendFrom: sendFromChoice } : {}) }
      : "skip",
  );
  const current = !locked && settled === text && hasText;
  const preview = current && previewResult?.ok ? previewResult.preview : null;
  // Headers stay put while the next preview loads; Send still needs the current one.
  const [lastHeaders, setLastHeaders] = useState<typeof preview>(null);
  if (preview && preview !== lastHeaders) setLastHeaders(preview);
  const headers = hasText ? (preview ?? lastHeaders) : null;
  const [open, setOpen] = useFollowedState(`inbox:reply:${threadId}:open`, false);
  const previewError = current && previewResult && !previewResult.ok ? previewResult.reason : null;
  const previewing = !locked && hasText && !preview && !previewError;
  const sendFromOptions = useSendFromOptions(preview?.sendFromOptions);
  // Unknown until the first preview: the server picks the default for this conversation.
  const sendFrom = attempt?.sendFrom ?? sendFromChoice ?? headers?.sendFrom;

  // The server's record of this key; only `sent` is a positive answer.
  const status = useQuery(
    api.teamEmailReplies.status,
    attempt ? { idempotencyKey: attempt.key } : "skip",
  );

  function chooseSendFrom(value: SendFrom) {
    setSendFromChoice(value);
    replySendFrom.set(id, value);
    setSendError(null);
  }

  function update(value: string) {
    setText(value);
    setSendError(null);
    if (value) replyDrafts.set(id, value);
    else replyDrafts.delete(id);
  }

  // The server saying "sent" is the one positive answer. Clearing runs in an
  // effect so it always commits; it syncs this form to a subscription.
  const confirmedSent = attempt !== null && status?.state === "sent";
  useEffect(() => {
    if (!confirmedSent) return;
    replyDrafts.delete(id);
    replySendFrom.delete(id);
    sendKey.current = null;
    writeAttempt(id, null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText("");
    setSendFromChoice(undefined);
    setAttempt(null);
    setServerNote(null);
  }, [confirmedSent, id]);

  async function send(retry?: SendAttempt) {
    if (sending) return;
    let next = retry ?? null;
    if (!next && preview) {
      // From is part of the fingerprint; it is also compared here so a changed account never reuses a key.
      const reusable =
        sendKey.current?.text === text &&
        sendKey.current.fingerprint === preview.fingerprint &&
        sendKey.current.sendFrom === preview.sendFrom;
      sendKey.current = reusable
        ? sendKey.current
        : { key: crypto.randomUUID(), text, fingerprint: preview.fingerprint, sendFrom: preview.sendFrom };
      next = { ...sendKey.current!, startedAt: dayjs().valueOf() };
    }
    if (!next) return;
    // Recorded first: if this tab dies mid-send, the lock survives a reload.
    writeAttempt(id, next);
    setAttempt(next);
    setServerNote(null);
    setSendError(null);
    setSending(true);
    onSendingChange(true);
    try {
      const result = await sendReply({
        threadId,
        message: next.text,
        expectedFingerprint: next.fingerprint,
        idempotencyKey: next.key,
        ...(next.sendFrom ? { sendFrom: next.sendFrom } : {}),
      });
      if (result.status === "sent") {
        setText("");
        replyDrafts.delete(id);
        replySendFrom.delete(id);
        setSendFromChoice(undefined);
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
        // A Gmail that needs reconnecting stays on screen with its link; nothing falls back to Spot.
        if (isGmailReconnectMessage(result.message)) setSendError(result.message);
        else toast.error(result.message);
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
    <div className="w-full space-y-2">
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
      {open || locked || hasText ? (
        // Flush with the panel footer: the footer is already the frame.
        <div className="-mx-4 -my-3">
          <EmailComposeRow label="From">
            {sendFrom ? (
              <SendFromField
                options={sendFromOptions}
                value={sendFrom}
                fallback={headers?.from ?? "You"}
                disabled={sending || locked}
                onChange={chooseSendFrom}
              />
            ) : (
              <span className="min-w-0 truncate">{headers?.from ?? "You"}</span>
            )}
          </EmailComposeRow>
          <EmailComposeRow label="To">
            {headers ? (
              <Recipients addresses={headers.to} />
            ) : (
              <span className="min-w-0 truncate text-muted-foreground">
                {recipient ?? "Everyone on the latest message"}
              </span>
            )}
          </EmailComposeRow>
          {headers?.cc.length ? (
            <EmailComposeRow label="Cc">
              <Recipients addresses={headers.cc} />
              {headers.sendFrom === "gmail" ? <SpotCopyHint /> : null}
            </EmailComposeRow>
          ) : null}
          {headers?.bcc.length ? (
            <EmailComposeRow label="Bcc">
              <Recipients addresses={headers.bcc} />
            </EmailComposeRow>
          ) : null}
          {headers ? (
            <EmailComposeRow label="Subject">
              <span className="min-w-0 truncate">{headers.subject}</span>
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
          {sendError ? (
            <div className={`px-4 pb-2 text-muted-foreground ${typeStyle("caption.default")}`}>
              <ComposeProblem message={sendError} />
            </div>
          ) : null}
          {previewing || previewError || preview ? (
            <div className={`space-y-1 px-4 pb-2 text-muted-foreground ${typeStyle("caption.default")}`}>
              {previewing ? <p>Preparing preview…</p> : null}
              {previewError ? <ComposeProblem message={previewError} /> : null}
              {preview?.copiesOwner ? (
                <p>{preview.copiesOwner} is copied as the conversation owner.</p>
              ) : null}
              {preview?.mode === "standalone" ? (
                <p>Sent from your own inbox as a new email; it stays in this conversation.</p>
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
              disabled={!preview || sending || locked}
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
              label="Discard reply"
              aria-label="Discard reply"
              disabled={sending || locked}
              onClick={() => {
                update("");
                replySendFrom.delete(id);
                setSendFromChoice(undefined);
                setShowFull(false);
                setOpen(false);
              }}
            >
              <Trash2 className="size-3.5" />
            </PillButton>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`flex h-10 w-full items-center gap-2 rounded-lg border border-border px-3 text-left text-muted-foreground transition-colors hover:bg-muted/50 ${typeStyle("body.default")}`}
        >
          <Reply className="size-3.5" />
          {recipient ? `Reply to ${recipient}` : "Reply"}
        </button>
      )}
    </div>
  );
}
