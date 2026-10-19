"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@claritylabs-inc/ui/components/dialog";
import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

export function DeleteOrganizationButton({
  orgId,
  name,
  type,
  disabled,
  beforeDelete,
  onDeleted,
}: {
  orgId: Id<"organizations">;
  name: string;
  type: "client" | "broker";
  disabled?: boolean;
  beforeDelete: () => Promise<boolean>;
  onDeleted: () => void;
}) {
  const typeLabel = type === "broker" ? "provider" : "client";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const remove = useMutation(api.operator.deleteOrganization);
  const removeWithUsers = useMutation(api.operator.deleteClientWithUsers);
  const [withUsers, setWithUsers] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      if (!(await beforeDelete())) return;
      if (type === "client" && withUsers) await removeWithUsers({ orgId });
      else await remove({ orgId, type });
      setOpen(false);
      onDeleted();
      toast.success(`${type === "client" ? "Client" : "Provider"} deleted`);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, `Could not delete the ${typeLabel}`),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PillButton
        type="button"
        variant="destructive"
        disabled={disabled || busy}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-3.5" />
        Delete {typeLabel}
      </PillButton>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
          if (!next) setWithUsers(false);
        }}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Delete {typeLabel}</DialogTitle>
            <DialogDescription>
              Delete <strong>{name}</strong>? This removes the {typeLabel} from
              active lists and disables its workspace access. Policies, files,
              and procurement history are retained.
              {type === "broker"
                ? " Client accounts are not affected."
                : " Shared packet links will stop working."}
            </DialogDescription>
          </DialogHeader>
          {type === "client" ? (
            <label className={`flex items-start gap-2 ${typeStyle("body.default")}`}>
              <input
                type="checkbox"
                className="mt-0.5"
                checked={withUsers}
                disabled={busy}
                onChange={(event) => setWithUsers(event.target.checked)}
              />
              <span>
                Also permanently delete all users under this client. They lose
                login access and cannot be restored.
              </span>
            </label>
          ) : null}
          <DialogFooter>
            <PillButton
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </PillButton>
            <PillButton
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {busy
                ? "Deleting…"
                : withUsers
                  ? `Delete ${typeLabel} and users`
                  : `Delete ${typeLabel}`}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
