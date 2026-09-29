"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAction, useMutation } from "convex/react";
import { useBackgroundTasks } from "@claritylabs-inc/ui/components/background-tasks";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { PolicyUploadMode } from "@/components/policy-upload-mode-toggle";
import { preparePolicyUploadCandidates } from "@/lib/policy-upload-duplicates";
import {
  showPolicyExtractionQueuedToast,
  showPolicyExtractionReadyToast,
} from "@/components/shared/extraction-banner";
import {
  extractionState,
  type ExtractionStatePolicy,
} from "@/lib/extraction-state";

type RegisterUploadArgs = {
  fileId: Id<"_storage">;
  fileName: string;
  fileSha256: string;
  uploadFileSha256s: string[];
};

type UploadedPolicyRow = ExtractionStatePolicy & {
  _id: Id<"policies">;
  documentType?: string | null;
  fileName?: string | null;
};

/**
 * Upload flow shared by the client Policies page and the operator client
 * workspace: duplicate check, storage upload, placeholder registration, and
 * extraction, in combined (one merged policy) or separate (one per file) mode.
 */
export function usePolicyUpload<Row extends UploadedPolicyRow>({
  orgId,
  registerUpload,
  rows,
  onOpenPolicy,
}: {
  orgId: Id<"organizations"> | undefined;
  /** Creates the placeholder policy row with the caller's provenance. */
  registerUpload: (args: RegisterUploadArgs) => Promise<Id<"policies">>;
  /** Route-scoped observation of policies queued by this mounted uploader. */
  rows: Row[] | undefined;
  onOpenPolicy: (policyId: Id<"policies">) => void;
}) {
  const pendingRef = useRef<Record<string, { fileName?: string | null }>>({});
  const { run, tasks } = useBackgroundTasks();
  const taskId = `policy-upload:${orgId}`;
  const uploading = tasks.get(taskId)?.status === "running";
  const generateUploadUrl = useMutation(api.policies.generateUploadUrlForOrg);
  const checkDuplicateUploadByHash = useMutation(
    api.policies.checkDuplicateUploadByHash,
  );
  const extractFromUpload = useAction(
    api.actions.extractFromUpload.extractFromUpload,
  );

  const announceReady = useCallback(() => {
    if (!rows) return;
    const pending = pendingRef.current;
    const rowsById = new Map(rows.map((policy) => [policy._id, policy]));
    for (const policyId of Object.keys(pending)) {
      const policy = rowsById.get(policyId as Id<"policies">);
      if (!policy || extractionState(policy).kind === "extracting") continue;
      showPolicyExtractionReadyToast(
        { ...policy, fileName: policy.fileName ?? pending[policyId].fileName },
        () => onOpenPolicy(policyId as Id<"policies">),
      );
      delete pending[policyId];
    }
  }, [onOpenPolicy, rows]);

  useEffect(() => {
    announceReady();
  }, [announceReady]);

  const queue = useCallback(
    (policyId: Id<"policies">, fileName: string) => {
      showPolicyExtractionQueuedToast({ policyId, fileName });
      pendingRef.current[policyId] = { fileName };
      announceReady();
    },
    [announceReady],
  );

  const upload = useCallback(
    async (files: File[], uploadMode: PolicyUploadMode = "combined") => {
      if (!orgId || files.length === 0) return false;
      const outcome = await run<Id<"policies">[] | null>({
        id: taskId,
        title: "Uploading policies",
        successTitle: (policyIds) =>
          policyIds ? "Policies queued for extraction" : "Upload cancelled",
        errorTitle: "Policy upload failed",
        onSuccess: (policyIds) =>
          policyIds?.length
            ? [
                {
                  label: "Open policy",
                  onClick: () => onOpenPolicy(policyIds[0]),
                },
              ]
            : undefined,
        execute: async (report) => {
          report({ message: "Checking for duplicate files" });
          const candidates = await preparePolicyUploadCandidates(
            files,
            (fileSha256) => checkDuplicateUploadByHash({ orgId, fileSha256 }),
          );
          if (!candidates) {
            report({
              message: "Upload cancelled before any files were uploaded",
            });
            return null;
          }
          const policyIds: Id<"policies">[] = [];

          const storageIds: Id<"_storage">[] = [];
          for (let i = 0; i < candidates.length; i++) {
            report({
              message: "Uploading files",
              completed: i,
              total: candidates.length,
            });
            const response = await fetch(await generateUploadUrl({ orgId }), {
              method: "POST",
              headers: { "Content-Type": "application/pdf" },
              body: candidates[i].file,
            });
            if (!response.ok) throw new Error("Storage upload failed");
            const { storageId } = (await response.json()) as {
              storageId: Id<"_storage">;
            };
            storageIds.push(storageId);
            report({
              message: "Uploading files",
              completed: i + 1,
              total: candidates.length,
            });
          }

          const extract = async (
            args: Parameters<typeof extractFromUpload>[0],
          ) => {
            const result = await extractFromUpload(args);
            if (result && typeof result === "object" && "error" in result) {
              throw new Error(String(result.error));
            }
          };

          report({ message: "Registering policies and starting extraction" });
          if (uploadMode === "separate") {
            for (let i = 0; i < storageIds.length; i++) {
              const { file, fileSha256 } = candidates[i];
              const policyId = await registerUpload({
                fileId: storageIds[i],
                fileName: file.name,
                fileSha256,
                uploadFileSha256s: [fileSha256],
              });
              policyIds.push(policyId);
              queue(policyId, file.name);
              await extract({
                fileId: storageIds[i],
                fileName: file.name,
                fileSha256,
                policyId,
              });
            }
          } else {
            const [primary, ...rest] = candidates;
            const policyId = await registerUpload({
              fileId: storageIds[0],
              fileName: primary.file.name,
              fileSha256: primary.fileSha256,
              uploadFileSha256s: candidates.map(
                (candidate) => candidate.fileSha256,
              ),
            });
            policyIds.push(policyId);
            queue(
              policyId,
              rest.length > 0
                ? `${primary.file.name.replace(/\.pdf$/i, "")} + ${rest.length} more.pdf`
                : primary.file.name,
            );
            report({
              message:
                rest.length > 0
                  ? "Merging files and starting extraction"
                  : "Starting extraction",
            });
            await extract({
              fileId: storageIds[0],
              fileName: primary.file.name,
              fileSha256: primary.fileSha256,
              policyId,
              additionalFiles: rest.map((candidate, i) => ({
                fileId: storageIds[i + 1],
                fileName: candidate.file.name,
                fileSha256: candidate.fileSha256,
              })),
            });
          }
          report({ message: "Extraction continues in the background" });
          return policyIds;
        },
      });
      if (outcome.status === "error") console.error(outcome.error);
      return outcome.status === "success" && outcome.result !== null;
    },
    [
      checkDuplicateUploadByHash,
      extractFromUpload,
      generateUploadUrl,
      orgId,
      onOpenPolicy,
      run,
      taskId,
      registerUpload,
      queue,
    ],
  );

  return { upload, uploading };
}
