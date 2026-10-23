"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { Clock3, Loader2, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { LogoIcon } from "@/components/ui/logo-icon";
import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useFollowedOpen } from "@/hooks/use-followed-state";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@claritylabs-inc/ui/components/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import {
  FollowUpCountSelect,
  IntervalSelect,
  schedulePreview,
} from "./provider-outreach-panel";

type Cadence = { followUpCount: number; intervalBusinessDays: number };
type Draft = {
  recipientEmail: string | null;
  subject: string;
  text: string;
  cadence: Cadence | null;
};

// Unsent drafts survive closing the composer within the session, per request.
const drafts = new Map<string, Draft>();

/** A mail-client header row: muted inline label, borderless value. */
function HeaderRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-border px-4">
      <span
        className={`w-14 shrink-0 text-muted-foreground ${typeStyle("body.default")}`}
      >
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function firstName(name: string | null | undefined) {
  return name?.trim().split(/\s+/)[0] || "there";
}

/**
 * Compose an email asking the client for information. Sending launches a
 * client outreach sequence: the first email is exactly what the operator
 * writes, then automated nudges on the same thread until the client replies.
 */
export function ClientOutreachComposer({
  requestId,
  requestTitle,
  onClose,
  onSent,
}: {
  requestId: Id<"procurementRequests">;
  requestTitle: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const panel = useQuery(api.clientOutreach.getPanel, { requestId });
  const launch = useMutation(api.clientOutreach.launch);
  const [draft, setDraftState] = useState<Draft>(
    () =>
      drafts.get(requestId) ?? {
        recipientEmail: null,
        subject: `Information needed: ${requestTitle}`.slice(0, 200),
        text: "",
        cadence: null,
      },
  );
  const [sending, setSending] = useState(false);
  const followUpsPopover = useFollowedOpen(`procurement:${requestId}:client-email:follow-ups-open`);
  const update = (patch: Partial<Draft>) =>
    setDraftState((current) => {
      const next = { ...current, ...patch };
      drafts.set(requestId, next);
      return next;
    });

  const recipients = panel?.recipients ?? [];
  const recipient =
    recipients.find((option) => option.email === draft.recipientEmail) ??
    recipients[0] ??
    null;
  const cadence = draft.cadence ?? panel?.defaultCadence ?? null;
  const preview = cadence
    ? schedulePreview(
        { ...cadence, style: "brief_nudge" },
        panel?.targetEffectiveDate ?? null,
      )
    : null;
  const disabled = sending || !panel?.canLaunch;
  // Launching approves the exact From and Always CC shown, by fingerprint.
  const senderFingerprint = panel?.sender.fingerprint ?? null;
  const senderProblem = panel
    ? (panel.sender.problem ??
      (senderFingerprint ? null : "Reload to review the From and CC before sending"))
    : null;
  const canSend =
    !disabled &&
    !!senderFingerprint &&
    !senderProblem &&
    !!recipient &&
    !!draft.subject.trim() &&
    !!draft.text.trim() &&
    !!cadence;

  async function send() {
    if (!canSend || !recipient || !cadence || !senderFingerprint) return;
    setSending(true);
    try {
      const result = await launch({
        requestId,
        recipientEmail: recipient.email,
        subject: draft.subject,
        text: draft.text,
        expectedIdentityFingerprint: senderFingerprint,
        cadence: {
          followUpCount: cadence.followUpCount,
          intervalBusinessDays: cadence.intervalBusinessDays,
          style: "brief_nudge",
        },
      });
      drafts.delete(requestId);
      toast.success(
        result.stepCount > 1
          ? `Email queued with ${result.stepCount - 1} follow-up${result.stepCount === 2 ? "" : "s"}`
          : "Email queued",
      );
      onSent();
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not send email"));
    } finally {
      setSending(false);
    }
  }

  function discard() {
    drafts.delete(requestId);
    onClose();
  }

  const followUpLabel = !cadence
    ? "Follow-ups"
    : cadence.followUpCount === 0
      ? "No follow-ups"
      : `${cadence.followUpCount} follow-up${cadence.followUpCount === 1 ? "" : "s"} · every ${cadence.intervalBusinessDays} days`;

  return (
    <SettingsDrawer
      open
      title="New message"
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
            disabled={!canSend}
            onClick={() => void send()}
          >
            {sending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            Send
          </PillButton>
          {cadence ? (
            <Popover {...followUpsPopover}>
              <PopoverTrigger
                render={
                  <PillButton
                    size="compact"
                    type="button"
                    variant="ghost"
                    disabled={disabled}
                    title="Automatic follow-ups on this thread; they stop when the client replies"
                  />
                }
              >
                <Clock3 className="size-3.5" />
                {followUpLabel}
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 space-y-3 p-3">
                <div className="space-y-1">
                  <p
                    className={`text-muted-foreground ${typeStyle("caption.default")}`}
                  >
                    Follow-ups
                  </p>
                  <FollowUpCountSelect
                    value={cadence.followUpCount}
                    onChange={(value) =>
                      update({ cadence: { ...cadence, followUpCount: value } })
                    }
                  />
                </div>
                {cadence.followUpCount > 0 ? (
                  <div className="space-y-1">
                    <p
                      className={`text-muted-foreground ${typeStyle("caption.default")}`}
                    >
                      Every
                    </p>
                    <IntervalSelect
                      value={cadence.intervalBusinessDays}
                      onChange={(value) =>
                        update({
                          cadence: { ...cadence, intervalBusinessDays: value },
                        })
                      }
                    />
                  </div>
                ) : null}
                {preview ? (
                  <p
                    className={`text-muted-foreground ${typeStyle("caption.default")}`}
                  >
                    {preview.text}
                    {preview.dropped
                      ? ` · ${preview.dropped} dropped before the target date`
                      : ""}
                    . Stops when the client replies.
                  </p>
                ) : null}
              </PopoverContent>
            </Popover>
          ) : null}
          <PillButton
            size="compact"
            type="button"
            variant="ghost"
            className="ml-auto"
            title="Discard draft"
            aria-label="Discard draft"
            disabled={sending}
            onClick={discard}
          >
            <Trash2 className="size-3.5" />
          </PillButton>
        </div>
      }
    >
      {panel === null ? (
        <p className={`p-4 text-muted-foreground ${typeStyle("body.default")}`}>
          This request is not linked to a company yet.
        </p>
      ) : panel ? (
        <div className="flex min-h-full flex-1 flex-col">
          {panel.closedReason ? (
            <p
              className={`border-b border-border px-4 py-2 text-muted-foreground ${typeStyle("caption.default")}`}
            >
              This request is closed, so new emails cannot be sent.
            </p>
          ) : null}
          <HeaderRow label="From">
            {senderProblem ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <p className={`min-w-0 flex-1 text-muted-foreground ${typeStyle("body.default")}`}>
                  {senderProblem}
                </p>
                <PillButton href="/operator/profile" size="compact" variant="ghost">
                  Open Profile
                </PillButton>
              </div>
            ) : (
              <p className={`truncate ${typeStyle("body.default")}`}>
                {panel.sender.fromHeader}
              </p>
            )}
          </HeaderRow>
          {panel.sender.alwaysCc && !senderProblem ? (
            <HeaderRow label="Cc">
              <p className={`truncate ${typeStyle("body.default")}`}>
                {panel.sender.alwaysCc}
              </p>
            </HeaderRow>
          ) : null}
          <HeaderRow label="To">
            {recipients.length ? (
              <Select
                value={recipient?.email ?? ""}
                disabled={disabled}
                onValueChange={(value) =>
                  value && update({ recipientEmail: value })
                }
              >
                <SelectTrigger
                  aria-label="Recipient"
                  className="h-9 w-full border-transparent bg-transparent px-0 shadow-none"
                >
                  <SelectValue>
                    {recipient ? (
                      <span className="inline-flex min-w-0 items-center truncate rounded-full bg-muted px-2.5 py-0.5">
                        {recipient.name ?? recipient.email}
                        {recipient.name ? (
                          <span className="ml-1.5 truncate text-muted-foreground">
                            {recipient.email}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      "Select contact"
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {recipients.map((option) => (
                    <SelectItem
                      key={option.email}
                      value={option.email}
                      label={`${option.name ?? ""} ${option.email}`}
                    >
                      <span className="flex min-w-0 flex-col whitespace-normal">
                        <span>{option.name ?? option.email}</span>
                        <span
                          className={`break-all text-muted-foreground ${typeStyle("caption.default")}`}
                        >
                          {option.email} ·{" "}
                          {option.source === "applicant"
                            ? "Applicant"
                            : "Portal member"}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
                No client contact with an email yet
              </p>
            )}
          </HeaderRow>
          <HeaderRow label="Subject">
            <input
              aria-label="Subject"
              value={draft.subject}
              maxLength={200}
              disabled={disabled}
              onChange={(event) => update({ subject: event.target.value })}
              className={`h-10 w-full bg-transparent outline-none placeholder:text-muted-foreground/60 ${typeStyle("control.input")}`}
            />
          </HeaderRow>
          <div className="flex flex-1 flex-col px-4 py-4">
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              Hi {firstName(recipient?.name)},
            </p>
            <textarea
              id="client-outreach-message"
              aria-label="Message"
              autoFocus
              placeholder="Write what you need from the client…"
              value={draft.text}
              maxLength={8000}
              disabled={disabled}
              onChange={(event) => update({ text: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void send();
                }
              }}
              className={`mt-3 min-h-64 w-full flex-1 resize-none bg-transparent outline-none field-sizing-content placeholder:text-muted-foreground/60 ${typeStyle("body.default")}`}
            />
            <div className={`mt-4 ${typeStyle("body.default")}`}>
              <p className="text-muted-foreground">Thanks,</p>
              {panel.sender.name ? (
                <div className="mt-3 flex items-start gap-2.5">
                  <LogoIcon size={32} className="size-8 shrink-0 rounded-lg" />
                  <div className={typeStyle("caption.default")}>
                    <p className={`text-foreground ${typeStyle("body.medium")}`}>
                      {panel.sender.name}
                    </p>
                    <p className="text-muted-foreground">Spot</p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </SettingsDrawer>
  );
}
