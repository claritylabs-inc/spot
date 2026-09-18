"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Loader2 } from "lucide-react";
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
} from "@/components/ui/dialog";
import { PillButton } from "@/components/ui/pill-button";
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
  async function confirm() {
    setBusy(true);
    try {
      if (!(await beforeDelete())) return;
      await remove({ orgId, type });
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
        Delete {typeLabel}
      </PillButton>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
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
              {busy ? "Deleting…" : `Delete ${typeLabel}`}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
