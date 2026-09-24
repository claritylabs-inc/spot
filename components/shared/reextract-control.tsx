"use client";

import { useCallback, useMemo, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { Loader2, RotateCw, X } from "lucide-react";
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
import type { ExtractionState } from "@/lib/extraction-state";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

export type ReextractControlHandle = ReturnType<
  typeof useReextractControl
>["control"];

/**
 * Re-extract always runs a full extraction from the original file; cancel
 * stops the running one. The returned dialog must be rendered once by the
 * caller so the header control and the status toast share it.
 */
export function useReextractControl(policyId: Id<"policies"> | undefined) {
  const retryExtraction = useAction(
    api.actions.retryExtraction.retryExtraction,
  );
  const cancelExtraction = useMutation(api.policies.cancelExtraction);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const start = async () => {
    if (!policyId) return;
    setStarting(true);
    try {
      await retryExtraction({ policyId });
      setConfirming(false);
      toast.success("Re-extraction started");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Couldn't start re-extraction"),
      );
    } finally {
      setStarting(false);
    }
  };

  const cancel = useCallback(async () => {
    if (!policyId) return;
    setCancelling(true);
    try {
      await cancelExtraction({ id: policyId });
      toast.success("Extraction cancelled");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Couldn't cancel"));
    } finally {
      setCancelling(false);
    }
  }, [cancelExtraction, policyId]);

  const requestReextract = useCallback(() => setConfirming(true), []);
  const control = useMemo(
    () => ({ requestReextract, cancel, cancelling, starting }),
    [requestReextract, cancel, cancelling, starting],
  );

  const dialog = (
    <Dialog
      open={confirming}
      onOpenChange={(open) => {
        if (!starting) setConfirming(open);
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Re-extract this policy?</DialogTitle>
          <DialogDescription>
            Spot reads the original file again and replaces the extracted
            details when it finishes. Policy history stays intact.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <PillButton
            variant="secondary"
            disabled={starting}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </PillButton>
          <PillButton disabled={starting} onClick={() => void start()}>
            {starting ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Re-extract
          </PillButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { control, dialog };
}

export function ReextractControl({
  control,
  state,
}: {
  control: ReextractControlHandle;
  state: ExtractionState;
}) {
  if (state.canCancel) {
    return (
      <PillButton
        size="compact"
        variant="secondary"
        label={control.cancelling ? "Cancelling…" : "Cancel"}
        expandLabel
        disabled={control.cancelling}
        onClick={() => void control.cancel()}
      >
        {control.cancelling ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <X className="size-3.5" />
        )}
      </PillButton>
    );
  }
  if (!state.canReextract) return null;
  return (
    <PillButton
      size="compact"
      variant="secondary"
      label="Re-extract"
      expandLabel
      disabled={control.starting}
      onClick={control.requestReextract}
    >
      <RotateCw className="size-3.5" />
    </PillButton>
  );
}
