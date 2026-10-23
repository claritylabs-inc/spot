"use client";

import { useState, type FormEvent } from "react";
import { useAction, useQuery } from "convex/react";
import { toast } from "sonner";
import { useFollowedState } from "@/hooks/use-followed-state";
import { api } from "@/convex/_generated/api";
import { ChatAvatar } from "@/components/chat/chat-message";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { OperationalPanel, OperationalPanelBody, OperationalPanelHeader } from "@claritylabs-inc/ui/components/operational-panel";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCachedOperatorCurrent } from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const inputClasses = `h-9 w-full rounded-lg border border-input bg-popover px-3 placeholder:text-muted-foreground/40 focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-input ${typeStyle("control.input")}`;

export function useOperatorInvite(disabled: boolean) {
  const inviteOperator = useAction(api.operatorInvitations.inviteOperator);
  const operators = useQuery(api.operator.listOperators);
  const viewerUserId = useCachedOperatorCurrent()?.user._id;
  const [open, setOpen] = useFollowedState("operator:invite:drawer-open", false);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  function close() {
    setOpen(false);
    setEmail("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    try {
      const result = await inviteOperator({ email });
      if (result.emailSent) {
        toast.success(`Invitation sent to ${result.email}`);
        close();
      } else {
        toast.error(`Operator access is ready for ${result.email}, but the email could not be sent. Retry the invitation to send it again.`);
      }
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Operator invitation could not be sent."),
      );
    } finally {
      setSending(false);
    }
  }

  return {
    panel: (
      <OperationalPanel>
        <OperationalPanelHeader
          title="Operator access"
          description="Company teammates who can sign in to the operator console."
          action={
            <PillButton disabled={disabled} size="compact" onClick={() => setOpen(true)}>
              Invite operator
            </PillButton>
          }
        />
        {operators === undefined ? (
          <OperationalPanelBody className="px-5 py-8 text-center">
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              Loading operators…
            </p>
          </OperationalPanelBody>
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={`w-[35%] px-5 text-muted-foreground ${typeStyle("label.table")}`}>
                  Operator
                </TableHead>
                <TableHead className={`w-[40%] text-muted-foreground ${typeStyle("label.table")}`}>
                  Email
                </TableHead>
                <TableHead className={`w-[25%] px-5 text-muted-foreground ${typeStyle("label.table")}`}>
                  Access
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operators.map((operator) => (
                <TableRow key={operator.userId} className="hover:bg-transparent">
                  <TableCell className="px-5 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <ChatAvatar
                        name={operator.name}
                        imageUrl={operator.avatarUrl}
                        className="size-8"
                      />
                      <p className={`min-w-0 truncate text-foreground ${typeStyle("body.medium")}`}>
                        {operator.name}
                        {operator.userId === viewerUserId ? (
                          <span className={`ml-1 text-muted-foreground/50 ${typeStyle("caption.default")}`}>
                            (you)
                          </span>
                        ) : null}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="truncate py-3 text-muted-foreground">
                    {operator.email}
                  </TableCell>
                  <TableCell className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {operator.role === "owner" ? "Owner" : "Operator"}
                      </Badge>
                      {operator.status === "disabled" ? (
                        <StatusTag tone="neutral" indicator="inactive">
                          Disabled
                        </StatusTag>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </OperationalPanel>
    ),
    drawer: open ? (
      <SettingsDrawer
        open={open}
        onOpenChange={(value) => { if (!sending) setOpen(value); }}
        title="Invite operator"
        footer={
          <PillButton
            type="submit"
            form="operator-invite-form"
            disabled={disabled || sending || !email.trim()}
          >
            {sending ? "Sending…" : "Send invitation"}
          </PillButton>
        }
      >
        <form id="operator-invite-form" onSubmit={submit} className="space-y-4">
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            The recipient must use a Spot company email. They’ll sign in with a one-time code sent to that mailbox.
          </p>
          <div>
            <label htmlFor="operator-invite-email" className={`mb-1 block text-muted-foreground ${typeStyle("caption.medium")}`}>
              Email address
            </label>
            <input
              id="operator-invite-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@spot.insure"
              autoFocus
              required
              className={inputClasses}
            />
          </div>
        </form>
      </SettingsDrawer>
    ) : null,
  };
}
