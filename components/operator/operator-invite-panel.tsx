"use client";

import { useState, type FormEvent } from "react";
import { useAction } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { OperationalPanel, OperationalPanelBody, OperationalPanelHeader } from "@/components/ui/operational-panel";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const inputClasses = `h-9 w-full rounded-lg border border-input bg-popover px-3 placeholder:text-muted-foreground/40 focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-input ${typeStyle("control.input")}`;

export function useOperatorInvite(disabled: boolean) {
  const inviteOperator = useAction(api.operatorInvitations.inviteOperator);
  const [open, setOpen] = useState(false);
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
      if (result.emailSent) toast.success(`Invitation sent to ${result.email}`);
      else toast.error(`Operator access is ready for ${result.email}, but the email could not be sent. Retry the invitation to send it again.`);
      close();
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
        <OperationalPanelHeader title="Operator access" />
        <OperationalPanelBody>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className={typeStyle("body.medium")}>Invite an operator</p>
              <p className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}>
                Send a company teammate a link to sign in to the operator console.
              </p>
            </div>
            <PillButton disabled={disabled} size="compact" onClick={() => setOpen(true)}>
              Invite operator
            </PillButton>
          </div>
        </OperationalPanelBody>
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
