"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { Avatar } from "@claritylabs-inc/ui/components/avatar";
import { CornerDownRight } from "lucide-react";

import { QueuedMessageRow } from "@/components/chat/queued-message";
import { PillButton } from "@/components/ui/pill-button";
import {
  operatorAgentApi,
  type OperatorAgentSteer,
  type OperatorPendingInput,
  type OperatorPerson,
} from "@/lib/operator-agent-api";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

const VISIBLE_PENDING_INPUTS = 3;

/**
 * Above the composer while another operator's request holds the chat: who,
 * that a message sent now waits for it, and New chat.
 */
export function OperatorRunBanner({
  operator,
  waitingApproval,
  onNewChat,
}: {
  operator: OperatorPerson;
  waitingApproval: boolean;
  onNewChat: () => void;
}) {
  return (
    <div className="mb-2 flex items-center gap-2.5 rounded-lg border border-input bg-card py-1.5 pr-1.5 pl-2.5">
      <span className="relative flex shrink-0">
        <Avatar
          name={operator.name}
          imageUrl={operator.avatarUrl}
          className="size-5"
        />
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-card",
            waitingApproval ? "bg-amber-400" : "bg-emerald-400",
          )}
        />
      </span>
      <p className={cn("min-w-0 flex-1 truncate", typeStyle("caption.default"))}>
        <span className={typeStyle("caption.medium")}>
          {waitingApproval
            ? `${operator.name}’s request is waiting for their approval`
            : `${operator.name}’s request is running`}
        </span>
        <span className="text-muted-foreground"> · your message will wait</span>
      </p>
      <PillButton type="button" variant="secondary" size="compact" onClick={onNewChat}>
        New chat
      </PillButton>
    </div>
  );
}

function inputPreview(input: OperatorPendingInput) {
  const files = input.attachmentCount
    ? `${input.attachmentCount} attachment${input.attachmentCount === 1 ? "" : "s"}`
    : "";
  return [input.content, files].filter(Boolean).join(" · ") || "Message";
}

/**
 * Messages waiting in this conversation, oldest first, for every viewer. The
 * sender can withdraw theirs, send it now when the running request is their
 * own, or move it to a new chat.
 */
export function OperatorPendingInputs({
  inputs,
  onOpenThread,
}: {
  inputs: OperatorPendingInput[];
  onOpenThread: (threadId: string) => void;
}) {
  const cancelInput = useMutation(operatorAgentApi.cancelInput);
  const sendInputNow = useMutation(operatorAgentApi.sendInputNow);
  const sendInputInNewChat = useMutation(operatorAgentApi.sendInputInNewChat);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  if (!inputs.length) return null;
  const act = (id: string, action: () => Promise<unknown>, fallback: string) => {
    setBusyId(id);
    void action()
      .catch((error: unknown) =>
        toast.error(getUserFacingErrorMessage(error, fallback)),
      )
      .finally(() => setBusyId(null));
  };
  // A message that could not start needs its sender, so it leads.
  const ordered = [
    ...inputs.filter((input) => input.status === "failed"),
    ...inputs.filter((input) => input.status !== "failed"),
  ];
  const visible = expanded ? ordered : ordered.slice(0, VISIBLE_PENDING_INPUTS);
  const hidden = ordered.length - visible.length;
  return (
    <div>
      {visible.map((input) => {
        const failed = input.status === "failed";
        return (
          <QueuedMessageRow
            key={input.id}
            label={
              failed
                ? `Couldn’t start${input.error ? ` (${input.error.replace(/\.$/, "")})` : ""}`
                : input.mode === "steer"
                  ? "Steering"
                  : "Queued"
            }
            failed={failed}
            text={inputPreview(input)}
            leading={
              <Avatar
                name={input.sender.name}
                title={input.sender.name}
                imageUrl={input.sender.avatarUrl}
                className="size-4 shrink-0"
              />
            }
            sending={busyId === input.id}
            onSendNow={
              input.canSendNow
                ? () =>
                    act(
                      input.id,
                      () => sendInputNow({ inputId: input.id }),
                      "Could not send the message now",
                    )
                : undefined
            }
            actions={
              input.canCancel && input.mode === "queue" ? (
                <PillButton
                  type="button"
                  variant="secondary"
                  size="compact"
                  disabled={busyId === input.id}
                  onClick={() =>
                    act(
                      input.id,
                      async () =>
                        onOpenThread(
                          (await sendInputInNewChat({ inputId: input.id })).threadId,
                        ),
                      "Could not start a new chat",
                    )
                  }
                >
                  New chat
                </PillButton>
              ) : null
            }
            onCancel={
              input.canCancel
                ? () =>
                    act(
                      input.id,
                      () => cancelInput({ inputId: input.id }),
                      "Could not remove the message",
                    )
                : undefined
            }
            cancelLabel={failed ? "Dismiss" : "Remove waiting message"}
          />
        );
      })}
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={cn(
            "mb-2 text-muted-foreground/60 hover:text-foreground",
            typeStyle("caption.medium"),
          )}
        >
          +{hidden} more
        </button>
      ) : null}
    </div>
  );
}

/** Guidance the run took while it worked, in the reply where it applied. */
export function OperatorSteerRows({ steers }: { steers: OperatorAgentSteer[] }) {
  return (
    <ul className="mb-2 flex flex-col gap-1">
      {steers.map((steer) => (
        <li
          key={steer.id}
          className={cn(
            "flex min-w-0 items-start gap-1.5 text-muted-foreground",
            typeStyle("caption.default"),
          )}
        >
          <CornerDownRight aria-hidden className="mt-0.5 size-3 shrink-0 opacity-50" />
          {steer.fromParentTask ? null : (
            <Avatar
              name={steer.name}
              title={steer.name}
              imageUrl={steer.sender?.avatarUrl}
              className="mt-px size-4 shrink-0"
            />
          )}
          <p className="min-w-0 whitespace-pre-wrap wrap-anywhere">
            <span className={cn("text-foreground/80", typeStyle("caption.medium"))}>
              {steer.fromParentTask ? "Follow-up from the parent task" : `${steer.name} steered`}
            </span>
            {": "}
            <span className="text-foreground/75">{steer.content}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}
