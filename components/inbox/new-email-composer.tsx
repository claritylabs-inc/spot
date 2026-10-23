"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAction, useQuery } from "convex/react";
import dayjs from "dayjs";
import { Loader2, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const PREVIEW_DELAY_MS = 450;

type Draft = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  message: string;
  clientOrgId: string;
  showCopies: boolean;
};
const EMPTY: Draft = { to: "", cc: "", bcc: "", subject: "", message: "", clientOrgId: "", showCopies: false };

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

const list = (value: string) =>
  value
    .split(/[,;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

function composeArgs(draft: Draft) {
  return {
    to: draft.to.trim(),
    cc: list(draft.cc),
    bcc: list(draft.bcc),
    subject: draft.subject,
    message: draft.message,
    ...(draft.clientOrgId ? { clientOrgId: draft.clientOrgId as Id<"organizations"> } : {}),
  };
}

/** A mail-client header row: muted inline label, borderless value. */
function HeaderRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-border px-4">
      <span className={`w-14 shrink-0 text-muted-foreground ${typeStyle("body.default")}`}>
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  );
}

const fieldClass = `h-10 w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground/60 ${typeStyle("control.input")}`;

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
}) {
  const operatorId = useCachedOperatorCurrent()?.user._id;
  if (!operatorId) return null;
  return <OperatorNewEmailComposer key={operatorId} operatorId={operatorId} {...props} />;
}

function OperatorNewEmailComposer({
  operatorId,
  onClose,
  onSent,
}: {
  operatorId: string;
  onClose: () => void;
  onSent: (threadId: Id<"teamEmailThreads"> | null) => void;
}) {
  const send = useAction(api.actions.teamEmailCompose.send);
  const clients = useCachedOperatorClients();
  const [attempt, setAttempt] = useState<SendAttempt | null>(() => readAttempt(operatorId));
  const [draft, setDraft] = useState<Draft>(() => attempt?.draft ?? drafts.get(operatorId) ?? EMPTY);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const locked = attempt !== null;
  const update = (patch: Partial<Draft>) =>
    setDraft((current) => {
      const next = { ...current, ...patch };
      drafts.set(operatorId, next);
      return next;
    });

  const settled = useDebounced(draft, PREVIEW_DELAY_MS);
  const ready = Boolean(settled.to.trim() && settled.subject.trim() && settled.message.trim());
  const result = useQuery(api.teamEmailCompose.preview, !locked && ready ? composeArgs(settled) : "skip");
  const current = settled === draft;
  const preview = current && result?.ok ? result.preview : null;
  const problem = current && result && !result.ok ? result.reason : null;
  const status = useQuery(
    api.teamEmailCompose.status,
    attempt ? { idempotencyKey: attempt.key } : "skip",
  );

  // The action's answer and the status query can both report the same send.
  const finished = useRef<string | null>(null);
  function finish(key: string, threadId: Id<"teamEmailThreads"> | null, captured: boolean) {
    if (finished.current === key) return;
    finished.current = key;
    writeAttempt(operatorId, null);
    drafts.delete(operatorId);
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
    if (sending) return;
    const next =
      retry ??
      (preview
        ? { key: crypto.randomUUID(), fingerprint: preview.fingerprint, draft, startedAt: dayjs().valueOf() }
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

  return (
    <SettingsDrawer
      open
      title="New email"
      contentClassName="-mx-4 my-0 flex-1"
      onOpenChange={(open) => {
        if (!open && !sending) onClose();
      }}
      footer={
        <div className="flex w-full items-center gap-2">
          <PillButton
            size="compact"
            type="button"
            title="Send (Ctrl or ⌘ + Enter)"
            disabled={!preview || disabled}
            onClick={() => void submit()}
          >
            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Send
          </PillButton>
          {problem ? (
            <p role="alert" className={`min-w-0 flex-1 truncate text-muted-foreground ${typeStyle("caption.default")}`}>
              {problem}
            </p>
          ) : null}
          <PillButton
            size="compact"
            type="button"
            variant="ghost"
            className="ml-auto"
            label="Discard email"
            aria-label="Discard email"
            disabled={disabled}
            onClick={() => {
              drafts.delete(operatorId);
              onClose();
            }}
          >
            <Trash2 className="size-3.5" />
          </PillButton>
        </div>
      }
    >
      <div
        className="flex min-h-full flex-1 flex-col"
        onKeyDown={(event) => {
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
        <HeaderRow label="From">
          <p className={`truncate ${typeStyle("body.default")}`}>
            {preview?.from ?? "Your team address"}
          </p>
        </HeaderRow>
        <HeaderRow label="To">
          <input
            aria-label="To"
            type="email"
            autoFocus
            placeholder="name@company.com"
            value={draft.to}
            disabled={disabled}
            onChange={(event) => update({ to: event.target.value })}
            className={fieldClass}
          />
          {draft.showCopies ? null : (
            <PillButton type="button" size="compact" variant="ghost" onClick={() => update({ showCopies: true })}>
              Cc Bcc
            </PillButton>
          )}
        </HeaderRow>
        {draft.showCopies || preview?.cc.length ? (
          <HeaderRow label="Cc">
            <input
              aria-label="Cc"
              placeholder={preview?.cc.length ? preview.cc.join(", ") : "Separate addresses with commas"}
              value={draft.cc}
              disabled={disabled}
              onChange={(event) => update({ cc: event.target.value, showCopies: true })}
              className={fieldClass}
            />
          </HeaderRow>
        ) : null}
        {draft.showCopies ? (
          <HeaderRow label="Bcc">
            <input
              aria-label="Bcc"
              placeholder="Separate addresses with commas"
              value={draft.bcc}
              disabled={disabled}
              onChange={(event) => update({ bcc: event.target.value })}
              className={fieldClass}
            />
          </HeaderRow>
        ) : null}
        <HeaderRow label="Subject">
          <input
            aria-label="Subject"
            maxLength={200}
            value={draft.subject}
            disabled={disabled}
            onChange={(event) => update({ subject: event.target.value })}
            className={fieldClass}
          />
        </HeaderRow>
        <HeaderRow label="Client">
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
        </HeaderRow>
        <textarea
          aria-label="Message"
          placeholder="Write your email…"
          value={draft.message}
          disabled={disabled}
          onChange={(event) => update({ message: event.target.value })}
          className={`min-h-64 w-full flex-1 resize-none bg-transparent px-4 py-4 outline-none field-sizing-content placeholder:text-muted-foreground/60 ${typeStyle("body.default")}`}
        />
        {preview ? (
          <p className={`px-4 pb-4 whitespace-pre-line text-muted-foreground ${typeStyle("caption.default")}`}>
            {preview.text.slice(preview.text.lastIndexOf("\n\n", preview.text.length) + 2)}
          </p>
        ) : null}
      </div>
    </SettingsDrawer>
  );
}
