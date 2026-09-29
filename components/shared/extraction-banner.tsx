"use client";

/** Policy extraction status controller for Sonner toasts. */

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  showOperationalStatusToast,
  type OperationalToastAction,
} from "@claritylabs-inc/ui/components/operational-toast";
import type { Id } from "@/convex/_generated/dataModel";
import {
  EXTRACTION_FAILED_MESSAGE,
  NOT_A_POLICY_MESSAGE,
  extractingLabel,
  type ExtractionState,
} from "@/lib/extraction-state";

export function policyExtractionToastId(policyId: string) {
  return `policy-extraction:${policyId}`;
}

export function PolicyExtractionBanner({
  policyId,
  state,
  onReextract,
  onCancel,
  cancelling,
}: {
  policyId: Id<"policies">;
  state: ExtractionState;
  onReextract?: () => void;
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  const sawExtracting = useRef(false);
  const toastId = policyExtractionToastId(policyId);
  const { kind, progress } = state;
  const done = progress?.done;
  const total = progress?.total;

  useEffect(() => {
    if (kind === "extracting") {
      sawExtracting.current = true;
      showOperationalStatusToast({
        id: toastId,
        title: extractingLabel(
          done !== undefined && total !== undefined ? { done, total } : undefined,
        ),
        tone: "loading",
        duration: 120_000,
        actions: onCancel
          ? [
              {
                label: cancelling ? "Cancelling" : "Cancel",
                onClick: () => {
                  if (!cancelling) onCancel();
                },
                variant: "secondary",
                disabled: cancelling,
              },
            ]
          : undefined,
      });
      return;
    }

    if (kind === "failed" || kind === "not_a_policy") {
      const actions: OperationalToastAction[] | undefined =
        kind === "failed" && onReextract
          ? [{ label: "Re-extract", onClick: onReextract, variant: "primary" }]
          : undefined;
      showOperationalStatusToast({
        id: toastId,
        title: kind === "failed" ? "Couldn't read policy" : "Not a policy",
        description:
          kind === "failed" ? EXTRACTION_FAILED_MESSAGE : NOT_A_POLICY_MESSAGE,
        tone: "error",
        duration: kind === "failed" ? 20_000 : 10_000,
        actions,
      });
      return;
    }

    if (sawExtracting.current) {
      sawExtracting.current = false;
      showOperationalStatusToast({
        id: toastId,
        title: "Policy ready",
        tone: "success",
        duration: 5_000,
      });
    } else {
      toast.dismiss(toastId);
    }
  }, [cancelling, done, kind, onCancel, onReextract, toastId, total]);

  return null;
}
