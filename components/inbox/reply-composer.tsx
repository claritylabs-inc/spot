"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { PillButton } from "@/components/ui/pill-button";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const PREVIEW_DELAY_MS = 450;

type SendAttempt = { key: string; text: string; fingerprint: string; startedAt: number };

// Unsent text and unconfirmed sends survive switching conversations in the session.
const replyDrafts = new Map<string, string>();
const unconfirmedSends = new Map<string, SendAttempt>();

function useDebounced<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * `not_sent` is the only failure known to have sent nothing. Any other failure
 * (a timeout, a dropped response) may have delivered the email, so it is never
 * retried under a new key.
 */
function failureMessage(error: unknown) {
  const data = error instanceof ConvexError ? (error.data as unknown) : null;
  const notSent =
    typeof data === "object" &&
    data !== null &&
    (data as { kind?: unknown }).kind === "not_sent";
  const message =
    notSent && typeof (data as { message?: unknown }).message === "string"
      ? (data as { message: string }).message
      : null;
  return { notSent, message: message ?? getUserFacingErrorMessage(error, "Could not send reply") };
}

function PreviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="w-10 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-foreground">{value}</dd>
    </div>
  );
}

/**
 * Reply box for a team conversation. The server composes the exact email (From,
 * recipients, signature, quoted history) and returns a fingerprint; Send is
 * enabled only for a preview of the text as it currently stands, and sends
 * against that fingerprint. Recipients are never guessed here.
 */
export function ReplyComposer({
  threadId,
  recipient,
  latestOutboundAt,
  onSendingChange,
  onReplyingChange,
}: {
  threadId: Id<"teamEmailThreads">;
  recipient: string | null;
  /** Newest sent message in the conversation, for spotting an unconfirmed send. */
  latestOutboundAt: number;
  onSendingChange: (sending: boolean) => void;
  /** True while the composer is focused with text, for presence. */
  onReplyingChange: (replying: boolean) => void;
}) {
  const sendReply = useAction(api.actions.teamEmailReplies.send);
  const [unconfirmed, setUnconfirmed] = useState<SendAttempt | null>(
    () => unconfirmedSends.get(threadId) ?? null,
  );
  const [text, setText] = useState(
    () => unconfirmedSends.get(threadId)?.text ?? replyDrafts.get(threadId) ?? "",
  );
  const [sending, setSending] = useState(false);
  const [focused, setFocused] = useState(false);
  const [showFull, setShowFull] = useState(false);
  // A key belongs to one exact text and fingerprint, so a retry of the same
  // email reuses it and an edited email gets its own.
  const sendKey = useRef<SendAttempt | null>(null);

  const hasText = text.trim().length > 0;
  useEffect(() => {
    onReplyingChange(focused && hasText);
  }, [focused, hasText, onReplyingChange]);
  useEffect(() => () => onReplyingChange(false), [onReplyingChange]);

  const settled = useDebounced(text, PREVIEW_DELAY_MS);
  const previewResult = useQuery(
    api.teamEmailReplies.preview,
    !unconfirmed && settled.trim() ? { threadId, message: settled } : "skip",
  );
  const current = !unconfirmed && settled === text && hasText;
  const preview = current && previewResult?.ok ? previewResult.preview : null;
  const previewError = current && previewResult && !previewResult.ok ? previewResult.reason : null;
  const previewing = !unconfirmed && hasText && !preview && !previewError;

  function update(value: string) {
    setText(value);
    if (value) replyDrafts.set(threadId, value);
    else replyDrafts.delete(threadId);
  }

  async function send(retry?: SendAttempt) {
    if (sending) return;
    let attempt = retry ?? null;
    if (!attempt && preview) {
      const reusable =
        sendKey.current?.text === text && sendKey.current.fingerprint === preview.fingerprint;
      sendKey.current = reusable
        ? sendKey.current
        : {
            key: crypto.randomUUID(),
            text,
            fingerprint: preview.fingerprint,
            startedAt: 0,
          };
      attempt = sendKey.current;
    }
    if (!attempt) return;
    const request = { ...attempt, startedAt: Date.now() };
    setSending(true);
    onSendingChange(true);
    try {
      const result = await sendReply({
        threadId,
        message: request.text,
        expectedFingerprint: request.fingerprint,
        idempotencyKey: request.key,
      });
      update("");
      sendKey.current = null;
      unconfirmedSends.delete(threadId);
      setUnconfirmed(null);
      toast.success(
        result.captured ? "Reply captured locally; nothing was sent" : "Reply sent",
      );
    } catch (error) {
      const failure = failureMessage(error);
      if (!failure.notSent) {
        unconfirmedSends.set(threadId, request);
        setUnconfirmed(request);
      }
      toast.error(
        failure.notSent
          ? failure.message
          : "We couldn’t confirm this reply was sent. Check the conversation before sending again.",
      );
    } finally {
      setSending(false);
      onSendingChange(false);
    }
  }

  function discardUnconfirmed() {
    unconfirmedSends.delete(threadId);
    sendKey.current = null;
    setUnconfirmed(null);
    update("");
  }

  const sentSince = unconfirmed !== null && latestOutboundAt >= unconfirmed.startedAt;

  return (
    <div className="w-full space-y-2">
      {unconfirmed ? (
        <div role="alert" className={`space-y-2 rounded-md bg-muted/50 p-3 ${typeStyle("caption.default")}`}>
          <p className="text-foreground">
            We couldn’t confirm this reply was sent.{" "}
            {sentSince
              ? "A message sent after this attempt is in the conversation; if it is yours, discard this draft."
              : "Check the conversation before sending again."}
          </p>
          <div className="flex justify-end gap-2">
            <PillButton type="button" size="compact" variant="ghost" disabled={sending} onClick={discardUnconfirmed}>
              Discard draft
            </PillButton>
            <PillButton type="button" size="compact" disabled={sending} onClick={() => void send(unconfirmed)}>
              {sending ? "Retrying…" : "Retry same email"}
            </PillButton>
          </div>
        </div>
      ) : null}
      <Textarea
        aria-label="Reply"
        placeholder={recipient ? `Reply to ${recipient}` : "Write a reply"}
        value={text}
        disabled={sending}
        readOnly={unconfirmed !== null}
        onChange={(event) => update(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void send();
          }
        }}
        className="max-h-60 min-h-20 resize-none field-sizing-content"
      />
      {previewing ? (
        <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>Preparing preview…</p>
      ) : null}
      {previewError ? (
        <p role="alert" className={`text-muted-foreground ${typeStyle("caption.default")}`}>
          {previewError}
        </p>
      ) : null}
      {preview ? (
        <div className={`space-y-1.5 rounded-md border border-border p-2.5 ${typeStyle("caption.default")}`}>
          <dl className="space-y-0.5">
            <PreviewLine label="From" value={preview.from} />
            <PreviewLine label="To" value={preview.to.join(", ") || "—"} />
            {preview.cc.length ? <PreviewLine label="Cc" value={preview.cc.join(", ")} /> : null}
            {preview.bcc.length ? <PreviewLine label="Bcc" value={preview.bcc.join(", ")} /> : null}
            <PreviewLine label="Subject" value={preview.subject} />
          </dl>
          {preview.copiesOwner ? (
            <p className="text-muted-foreground">{preview.copiesOwner} is copied as the conversation owner.</p>
          ) : null}
          {preview.mode === "standalone" ? (
            <p className="text-muted-foreground">
              Sent from your own inbox as a new email; it stays in this conversation.
            </p>
          ) : null}
          {preview.stopsFollowUps ? (
            <p className="text-muted-foreground">Sending stops this conversation’s automatic follow-ups.</p>
          ) : null}
          <button
            type="button"
            aria-expanded={showFull}
            onClick={() => setShowFull((value) => !value)}
            className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {showFull ? "Hide full email" : "Show full email"}
          </button>
          {showFull ? (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-foreground">
              {preview.text}
            </pre>
          ) : null}
        </div>
      ) : null}
      <div className="flex justify-end">
        <PillButton
          size="compact"
          type="button"
          title="Send (Ctrl or ⌘ + Enter)"
          disabled={!preview || sending || unconfirmed !== null}
          onClick={() => void send()}
        >
          {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          Send
        </PillButton>
      </div>
    </div>
  );
}
