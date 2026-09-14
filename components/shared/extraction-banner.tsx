"use client";

/** Policy extraction status controller for Sonner toasts. */

import type { PipelineStatus, LogEntry } from "@claritylabs/cl-pipelines";
import { useAction } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  showOperationalStatusToast,
  type OperationalToastAction,
  type OperationalToastTone,
} from "@/components/ui/operational-toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { isNonInsuranceDocument } from "@/convex/lib/policyDocumentGate";

type RetryMode = "resume" | "restart";

type ToastPolicy = {
  _id: string;
  documentType?: string | null;
  fileName?: string | null;
  carrier?: string | null;
  policyNumber?: string | null;
  pipelineStatus?: string | null;
  pipelineError?: string | null;
  extractionDataStage?: string | null;
  extractionPreviewError?: string | null;
};

export function policyExtractionToastId(policyId: string) {
  return `policy-extraction:${policyId}`;
}

function documentLabel() {
  return "policy";
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function cleanDisplayText(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed || /^extracting/i.test(trimmed)) return undefined;
  return trimmed;
}

function latestLogMessage(log?: LogEntry[]) {
  if (!log?.length) return undefined;
  const message = log[log.length - 1]?.message;
  return typeof message === "string" && message.trim()
    ? message.trim()
    : undefined;
}

function isActiveStatus(status?: string | null) {
  return status === "running" || status === "paused";
}

function isErrorStatus(status?: string | null) {
  return status === "error";
}

function isFinalStatus(status?: string | null, stage?: string | null) {
  return status === "complete" || stage === "final";
}

function isPreviewStatus(status?: string | null, stage?: string | null) {
  return stage === "preview" && status !== "complete";
}

function showExtractionStatusToast({
  id,
  title,
  description,
  tone,
  duration,
  actions,
}: {
  id: string;
  title: string;
  description?: string;
  tone: OperationalToastTone;
  duration: number;
  actions?: OperationalToastAction[];
}) {
  showOperationalStatusToast({
    id,
    title,
    description,
    tone,
    duration,
    actions,
  });
}

export function showPolicyExtractionQueuedToast({
  policyId,
  documentType: _documentType,
  fileName,
}: {
  policyId: string;
  documentType?: string | null;
  fileName?: string | null;
}) {
  const label = documentLabel();
  showExtractionStatusToast({
    id: policyExtractionToastId(policyId),
    title: `Extracting ${label}`,
    description: cleanDisplayText(fileName)
      ? `${fileName} uploaded. Extraction is queued.`
      : "Extraction is queued.",
    tone: "loading",
    duration: 60_000,
  });
}

export function showPolicyExtractionReadyToast(
  policy: ToastPolicy,
  openPolicy?: () => void,
) {
  const label = documentLabel();
  const title =
    cleanDisplayText(policy.carrier) ??
    cleanDisplayText(policy.policyNumber) ??
    cleanDisplayText(policy.fileName) ??
    titleCase(label);
  const action = openPolicy
    ? [
        {
          label: "Open",
          onClick: () => {
            openPolicy();
            toast.dismiss(policyExtractionToastId(policy._id));
          },
          variant: "secondary" as const,
        },
      ]
    : undefined;

  if (isErrorStatus(policy.pipelineStatus)) {
    showExtractionStatusToast({
      id: policyExtractionToastId(policy._id),
      title: `${titleCase(label)} extraction failed`,
      description:
        policy.extractionPreviewError ??
        policy.pipelineError ??
        "Review the policy for details.",
      tone: "error",
      duration: 12_000,
      actions: action,
    });
    return;
  }

  if (isPreviewStatus(policy.pipelineStatus, policy.extractionDataStage)) {
    showExtractionStatusToast({
      id: policyExtractionToastId(policy._id),
      title: "Extraction complete",
      description: `${title} is available. Enrichment continues in the background.`,
      tone: "success",
      duration: 8_000,
      actions: action,
    });
    return;
  }

  if (isFinalStatus(policy.pipelineStatus, policy.extractionDataStage)) {
    showExtractionStatusToast({
      id: policyExtractionToastId(policy._id),
      title: `${titleCase(label)} enrichment complete`,
      description: `${title} is ready.`,
      tone: "success",
      duration: 6_000,
      actions: action,
    });
  }
}

export function PolicyExtractionBanner({
  policyId,
  status,
  extractionDataStage,
  error,
  log,
  onCancel,
  cancelling,
}: {
  policyId: Id<"policies">;
  status: PipelineStatus | undefined;
  extractionDataStage?: string;
  error?: string;
  log?: LogEntry[];
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  const retry = useAction(api.actions.retryExtraction.retryExtraction);
  const [retryingMode, setRetryingMode] = useState<RetryMode | null>(null);
  const previousStatus = useRef<PipelineStatus | undefined>(undefined);
  const hasShownActiveStatus = useRef(false);
  const toastId = policyExtractionToastId(policyId);
  const latestMessage = useMemo(() => latestLogMessage(log), [log]);
  const isEnriching =
    extractionDataStage === "preview" && status !== "complete";

  const handleRetry = useCallback(
    async (mode: RetryMode) => {
      if (retryingMode) return;

      setRetryingMode(mode);
      try {
        showExtractionStatusToast({
          id: toastId,
          title:
            mode === "resume" ? "Resuming extraction" : "Restarting extraction",
          description: "Queued for the extraction worker.",
          tone: "loading",
          duration: 20_000,
        });
        const result = await retry({ policyId, mode });
        if (result && typeof result === "object" && "error" in result) {
          throw new Error(String(result.error));
        }
        showExtractionStatusToast({
          id: toastId,
          title:
            mode === "resume" ? "Extraction resumed" : "Extraction restarted",
          description: "The extraction worker has the policy.",
          tone: "success",
          duration: 5_000,
        });
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(error, "Failed to restart extraction"),
        );
      } finally {
        setRetryingMode(null);
      }
    },
    [policyId, retry, retryingMode, toastId],
  );

  useEffect(() => {
    if (!status || status === "idle") {
      previousStatus.current = status;
      return;
    }

    if (isActiveStatus(status)) {
      hasShownActiveStatus.current = true;
      showExtractionStatusToast({
        id: toastId,
        title:
          status === "paused"
            ? isEnriching
              ? "Enrichment paused"
              : "Extraction paused"
            : isEnriching
              ? "Enriching policy"
              : "Extracting policy",
        description:
          latestMessage ??
          (isEnriching
            ? "Adding source-backed details."
            : "Preparing policy details."),
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
      previousStatus.current = status;
      return;
    }

    if (status === "error") {
      const nonInsuranceDocument = isNonInsuranceDocument(error);
      showExtractionStatusToast({
        id: toastId,
        title: nonInsuranceDocument
          ? "Not an insurance document"
          : "Extraction failed",
        description: error ?? "Review the policy and retry extraction.",
        tone: "error",
        duration: nonInsuranceDocument ? 10_000 : 20_000,
        actions: !nonInsuranceDocument
          ? [
              {
                label: retryingMode === "resume" ? "Resuming" : "Resume",
                onClick: () => void handleRetry("resume"),
                variant: "primary",
                disabled: retryingMode !== null,
              },
              {
                label: retryingMode === "restart" ? "Restarting" : "Restart",
                onClick: () => void handleRetry("restart"),
                variant: "secondary",
                disabled: retryingMode !== null,
              },
            ]
          : undefined,
      });
      previousStatus.current = status;
      return;
    }

    if (status === "complete" || extractionDataStage === "final") {
      if (
        hasShownActiveStatus.current ||
        isActiveStatus(previousStatus.current)
      ) {
        showExtractionStatusToast({
          id: toastId,
          title: "Enrichment complete",
          description: "Source-backed policy data is ready.",
          tone: "success",
          duration: 5_000,
        });
      } else {
        toast.dismiss(toastId);
      }
      previousStatus.current = status;
    }
  }, [
    cancelling,
    error,
    extractionDataStage,
    handleRetry,
    isEnriching,
    latestMessage,
    onCancel,
    retryingMode,
    status,
    toastId,
  ]);

  return null;
}
