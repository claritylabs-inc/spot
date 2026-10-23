"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@claritylabs-inc/ui/components/alert-dialog";
import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

type DeletableRequest = { _id: Id<"procurementRequests">; title: string };

/**
 * Recoverable deletion of one or more procurement requests through
 * `procurementRequests.remove`, with Undo through `restore`. Each request is
 * removed on its own, so one failure leaves the others deleted and reported.
 */
export function DeleteRequestsDialog({
  requests,
  open,
  onOpenChange,
  onDeleted,
}: {
  requests: DeletableRequest[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: (requestIds: Id<"procurementRequests">[]) => void;
}) {
  const removeRequest = useMutation(api.procurementRequests.remove);
  const restoreRequest = useMutation(api.procurementRequests.restore);
  const [deleting, setDeleting] = useState(false);
  const single = requests.length === 1 ? requests[0] : null;
  const noun = single ? "request" : `${requests.length} requests`;

  async function confirm() {
    setDeleting(true);
    const deleted: Id<"procurementRequests">[] = [];
    let lastError: unknown;
    for (const request of requests) {
      try {
        await removeRequest({ requestId: request._id });
        deleted.push(request._id);
      } catch (error) {
        lastError = error;
      }
    }
    setDeleting(false);
    onOpenChange(false);
    if (deleted.length) {
      onDeleted?.(deleted);
      toast.success(
        deleted.length === 1
          ? "Request deleted"
          : `${deleted.length} requests deleted`,
        {
          action: {
            label: "Undo",
            onClick: () => {
              void Promise.all(
                deleted.map((requestId) => restoreRequest({ requestId })),
              )
                .then(() =>
                  toast.success(
                    deleted.length === 1
                      ? "Request restored"
                      : `${deleted.length} requests restored`,
                  ),
                )
                .catch((error) =>
                  toast.error(
                    getUserFacingErrorMessage(error, "Could not restore request"),
                  ),
                );
            },
          },
        },
      );
    }
    const failed = requests.length - deleted.length;
    if (failed)
      toast.error(
        getUserFacingErrorMessage(
          lastError,
          failed === 1
            ? "Could not delete request"
            : `Could not delete ${failed} requests`,
        ),
      );
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!deleting) onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {noun}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes {single ? `“${single.title}”` : "them"} from
            procurement and disables access to {single ? "its" : "their"}{" "}
            application and shared packets. Existing policies and company files
            are kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <PillButton
            variant="secondary"
            disabled={deleting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </PillButton>
          <PillButton
            variant="destructive"
            disabled={deleting || requests.length === 0}
            onClick={() => void confirm()}
          >
            {deleting ? "Deleting…" : `Delete ${noun}`}
          </PillButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
