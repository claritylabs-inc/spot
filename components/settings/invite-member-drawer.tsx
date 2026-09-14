"use client";

import { useState, type FormEvent } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { typeStyle } from "@/lib/typography";

const INPUT_CLASSES =
  `h-9 w-full rounded-lg border border-input bg-popover px-3 placeholder:text-muted-foreground/40 focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-input transition-colors ${typeStyle("body.default")}`;

const LABEL_CLASSES =
  `text-muted-foreground block mb-1 ${typeStyle("caption.medium")}`;

export function InviteMemberDrawer({
  open,
  onOpenChange,
  operatorClientOrgId,
  isBroker,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  operatorClientOrgId?: Id<"organizations">;
  isBroker: boolean;
}) {
  const sendMemberInvitation = useAction(api.orgs.sendMemberInvitation);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [sending, setSending] = useState(false);

  function resetAndClose() {
    setEmail("");
    setRole("member");
    onOpenChange(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email) return;
    setSending(true);
    try {
      await sendMemberInvitation({ email, role, operatorClientOrgId });
      toast.success(`Invitation sent to ${email}`);
      resetAndClose();
    } catch (err) {
      const msg = getUserFacingErrorMessage(err, "Failed to send invitation");
      toast.error(msg);
    } finally {
      setSending(false);
    }
  }

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={(value) => {
        if (!value) resetAndClose();
        else onOpenChange(true);
      }}
      title="Invite team member"
      footer={
        <PillButton
          type="submit"
          form="invite-member-form"
          variant="primary"
          disabled={sending || !email}
        >
          {sending ? "Sending…" : "Send invitation"}
        </PillButton>
      }
    >
      <form
        id="invite-member-form"
        onSubmit={handleSubmit}
        className="space-y-4"
      >
        <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
          Send an invitation to join your organization. They&apos;ll receive an
          email with instructions.
        </p>

        <div>
          <label htmlFor="invite-email" className={LABEL_CLASSES}>
            Email address
          </label>
          <input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            className={INPUT_CLASSES}
          />
        </div>

        <div>
          <span className={LABEL_CLASSES}>Role</span>
          <div className="flex gap-2">
            {(["member", "admin"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`flex-1 py-2 rounded-lg border transition-colors ${typeStyle("control.button")} ${
                  role === r
                    ? "border-border-hover bg-foreground/3 text-foreground"
                    : "border-border text-muted-foreground hover:border-border-emphasized"
                }`}
              >
                {r === "admin" ? "Admin" : "Member"}
              </button>
            ))}
          </div>
          <p className={`text-muted-foreground/60 mt-1.5 ${typeStyle("caption.default")}`}>
            {isBroker
              ? role === "admin"
                ? "Admins can manage the broker profile and team members."
                : "Members can view the broker profile and team."
              : role === "admin"
                ? "Admins can manage connections, settings, and team members."
                : "Members can view policies and use the agent, but can't manage connections or settings."}
          </p>
        </div>
      </form>
    </SettingsDrawer>
  );
}
