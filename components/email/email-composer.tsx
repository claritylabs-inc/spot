"use client";

import type { ReactNode } from "react";
import { ChevronDown, Clock3, Loader2, Send } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@claritylabs-inc/ui/components/popover";
import { Tabs, TabsList, TabsTrigger } from "@claritylabs-inc/ui/components/tabs";
import { ShowQuotedButton } from "@/components/inbox/email-html-body";
import { LinkedText } from "@/components/email/linked-text";
import { PillButton } from "@/components/ui/pill-button";
import {
  FollowUpCountSelect,
  IntervalSelect,
} from "@/components/procurement/outreach-cadence-selects";
import { OUTREACH_DEFAULT_CADENCE } from "@/convex/lib/providerOutreachSchedule";
import { useFollowedOpen, useFollowedState } from "@/hooks/use-followed-state";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * The pieces of the mail composer shared by team inbox replies and the
 * agent's email drafts: header rows (`EmailComposeRow`), `ReplyEditor`, then
 * these notes and the send bar.
 */

/** Nudge the recipient until someone replies; `cadence` null lets Spot pick the schedule. */
export type FollowUps = {
  cadence: { followUpCount: number; intervalBusinessDays: number } | null;
};

/** The request a send action takes for `FollowUps`. */
export function followUpsRequest(value: FollowUps | null) {
  if (!value) return undefined;
  return value.cadence ? { cadence: value.cadence } : {};
}

export function DraftedBySpot() {
  return (
    <span className={`ml-auto shrink-0 text-muted-foreground ${typeStyle("caption.default")}`}>
      Drafted by Spot
    </span>
  );
}

/** The whole email as it will be sent, folded behind a toggle under the editor. */
export function FullEmailToggle({ followKey, text }: { followKey: string; text: string }) {
  const [open, setOpen] = useFollowedState(`${followKey}:show-full`, false);
  return (
    <div className="space-y-2 px-4 pb-2">
      <ShowQuotedButton
        label={open ? "Hide full email" : "Show full email"}
        expanded={open}
        onClick={() => setOpen((value) => !value)}
      />
      {open ? (
        <div className={`max-h-48 overflow-auto rounded-md bg-muted/50 p-2 whitespace-pre-wrap break-words text-foreground ${typeStyle("caption.default")}`}>
          <LinkedText text={text} />
        </div>
      ) : null}
    </div>
  );
}

/** Muted lines between the editor and the send bar; renders nothing without content. */
export function EmailComposerNotes({ children }: { children: ReactNode }) {
  return (
    <div className={`space-y-1 px-4 pb-2 text-muted-foreground empty:hidden ${typeStyle("caption.default")}`}>
      {children}
    </div>
  );
}

/**
 * Send, follow-ups, then `actions` pushed to the right. Send needs every
 * `[needs: …]` blank filled.
 */
export function EmailComposerBar({
  blanks,
  sending,
  canSend,
  onSend,
  followUps,
  note,
  actions,
  className,
}: {
  /** `[needs: …]` blanks still in the text. */
  blanks: number;
  sending: boolean;
  canSend: boolean;
  onSend: () => void;
  followUps?: {
    followKey: string;
    value: FollowUps | null;
    disabled: boolean;
    onChange: (value: FollowUps | null) => void;
  };
  /** A muted line after the controls, e.g. what sending changes. */
  note?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const needsInput = blanks > 0;
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <PillButton
        size="compact"
        type="button"
        shortcut={["mod", "enter"]}
        disabled={!canSend || sending || needsInput}
        onClick={onSend}
      >
        {sending ? <Loader2 className="size-3.5 animate-spin" /> : needsInput ? null : <Send className="size-3.5" />}
        {needsInput ? `Fill ${blanks} blank${blanks === 1 ? "" : "s"} to send` : "Send"}
      </PillButton>
      {followUps ? <FollowUpControl {...followUps} /> : null}
      {note ? (
        <span className={`min-w-0 truncate text-muted-foreground/70 ${typeStyle("caption.default")}`}>
          {note}
        </span>
      ) : null}
      <span className="ml-auto flex shrink-0 items-center gap-2">{actions}</span>
    </div>
  );
}

/**
 * Follow up toggle: once the email is sent, Spot nudges the recipient on the
 * same thread until anyone replies. The schedule is Spot's pick unless set here.
 */
function FollowUpControl({
  followKey,
  value,
  disabled,
  onChange,
}: {
  followKey: string;
  value: FollowUps | null;
  disabled: boolean;
  onChange: (value: FollowUps | null) => void;
}) {
  const schedule = useFollowedOpen(`${followKey}:follow-ups-open`);
  const cadence = value?.cadence ?? null;
  return (
    <>
      <PillButton
        size="compact"
        type="button"
        variant="ghost"
        aria-pressed={value !== null}
        title="Nudge the recipient on this thread until someone replies"
        className={cn(value && "bg-foreground/6 text-foreground")}
        disabled={disabled}
        onClick={() => onChange(value ? null : { cadence: null })}
      >
        <Clock3 className="size-3.5" />
        Follow up
      </PillButton>
      {value ? (
        <Popover {...schedule}>
          <PopoverTrigger
            render={
              <PillButton
                size="compact"
                type="button"
                variant="ghost"
                disabled={disabled}
                aria-label="Follow-up schedule"
              />
            }
          >
            {cadence
              ? `${cadence.followUpCount} · every ${cadence.intervalBusinessDays} days`
              : "Auto"}
            <ChevronDown className="size-3.5" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-3 p-3">
            <Tabs
              value={cadence ? "custom" : "auto"}
              onValueChange={(next) =>
                onChange({
                  cadence:
                    next === "custom"
                      ? {
                          followUpCount: OUTREACH_DEFAULT_CADENCE.followUpCount,
                          intervalBusinessDays: OUTREACH_DEFAULT_CADENCE.intervalBusinessDays,
                        }
                      : null,
                })
              }
            >
              <TabsList variant="pill" aria-label="Follow-up schedule">
                <TabsTrigger value="auto">Spot picks</TabsTrigger>
                <TabsTrigger value="custom">Custom</TabsTrigger>
              </TabsList>
            </Tabs>
            {cadence ? (
              <>
                <div className="space-y-1">
                  <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
                    Follow-ups
                  </p>
                  <FollowUpCountSelect
                    value={cadence.followUpCount}
                    onChange={(followUpCount) =>
                      onChange(followUpCount ? { cadence: { ...cadence, followUpCount } } : null)
                    }
                  />
                </div>
                <div className="space-y-1">
                  <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
                    Every
                  </p>
                  <IntervalSelect
                    value={cadence.intervalBusinessDays}
                    onChange={(intervalBusinessDays) =>
                      onChange({ cadence: { ...cadence, intervalBusinessDays } })
                    }
                  />
                </div>
              </>
            ) : null}
            <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
              {cadence
                ? "Spot writes each nudge from the conversation."
                : "Spot picks how many nudges and how far apart, and writes each from the conversation."}{" "}
              They stop when anyone replies.
            </p>
          </PopoverContent>
        </Popover>
      ) : null}
    </>
  );
}
