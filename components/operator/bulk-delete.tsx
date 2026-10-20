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
import { Checkbox } from "@claritylabs-inc/ui/components/checkbox";
import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

type OrgId = Id<"organizations">;

export function useRowSelection(visibleIds: OrgId[]) {
  const [selected, setSelected] = useState<Set<OrgId>>(new Set());
  // Rows can disappear (filters, deletes); only count what is still visible.
  const selectedIds = visibleIds.filter((id) => selected.has(id));
  const allSelected =
    visibleIds.length > 0 && selectedIds.length === visibleIds.length;
  return {
    selectedIds,
    allSelected,
    someSelected: selectedIds.length > 0 && !allSelected,
    isSelected: (id: OrgId) => selected.has(id),
    toggle: (id: OrgId, checked: boolean) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (checked) next.add(id);
        else next.delete(id);
        return next;
      }),
    toggleAll: (checked: boolean) =>
      setSelected(checked ? new Set(visibleIds) : new Set()),
    clear: () => setSelected(new Set()),
  };
}

export function BulkDeleteBar({
  type,
  selectedIds,
  disabled,
  onClear,
}: {
  type: "client" | "broker";
  selectedIds: OrgId[];
  disabled?: boolean;
  onClear: () => void;
}) {
  const noun = type === "broker" ? "provider" : "client";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [withUsers, setWithUsers] = useState(false);
  const remove = useMutation(api.operator.deleteOrganization);
  const removeWithUsers = useMutation(api.operator.deleteClientWithUsers);
  const count = selectedIds.length;
  const label = `${count} ${noun}${count === 1 ? "" : "s"}`;

  async function confirm() {
    setBusy(true);
    let failed = 0;
    let lastError: unknown;
    for (const orgId of selectedIds) {
      try {
        if (type === "client" && withUsers) await removeWithUsers({ orgId });
        else await remove({ orgId, type });
      } catch (error) {
        failed += 1;
        lastError = error;
      }
    }
    setBusy(false);
    const deleted = count - failed;
    if (deleted > 0)
      toast.success(`Deleted ${deleted} ${noun}${deleted === 1 ? "" : "s"}`);
    if (failed > 0)
      toast.error(
        getUserFacingErrorMessage(
          lastError,
          `Could not delete ${failed} ${noun}${failed === 1 ? "" : "s"}`,
        ),
      );
    setOpen(false);
    setWithUsers(false);
    onClear();
  }

  if (count === 0) return null;
  return (
    <>
      <div
        className={`flex items-center gap-3 ${typeStyle("body.default")}`}
      >
        <span className="text-muted-foreground">{count} selected</span>
        <PillButton
          type="button"
          variant="secondary"
          size="compact"
          onClick={onClear}
        >
          Clear
        </PillButton>
        <PillButton
          type="button"
          variant="destructive"
          size="compact"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <Trash2 className="size-3.5" />
          Delete
        </PillButton>
      </div>
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
            <DialogTitle>Delete {label}</DialogTitle>
            <DialogDescription>
              This removes {count === 1 ? "it" : "them"} from active lists and
              disables workspace access. Policies, files, and procurement
              history are retained.
              {type === "broker"
                ? " Client accounts are not affected."
                : " Shared packet links will stop working."}
            </DialogDescription>
          </DialogHeader>
          {type === "client" ? (
            <label
              className={`flex items-start gap-2 ${typeStyle("body.default")}`}
            >
              <Checkbox
                className="mt-0.5"
                checked={withUsers}
                disabled={busy}
                onCheckedChange={(checked) => setWithUsers(checked)}
              />
              <span>
                Also permanently delete all users under these clients. They
                lose login access and cannot be restored.
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
              {busy ? "Deleting…" : `Delete ${label}`}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
