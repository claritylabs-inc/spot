"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PillButton } from "@/components/ui/pill-button";
import { PolicyUploadDrawer } from "@/components/policy-upload-drawer";
import type { PolicyUploadMode } from "@/components/policy-upload-mode-toggle";
import { PolicyEmptyState } from "@/components/policy-empty-state";
import { StatusTag } from "@/components/ui/status-tag";
import { OperationalPanel } from "@/components/ui/operational-panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArchiveRestore, Upload } from "lucide-react";
import { toast } from "sonner";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import {
  showPolicyExtractionQueuedToast,
  showPolicyExtractionReadyToast,
} from "@/components/shared/extraction-banner";
import { preparePolicyUploadCandidates } from "@/lib/policy-upload-duplicates";
import { normalizeExtractedDate } from "@/convex/lib/valueNormalization";
import { formatDisplayDate } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";

type ClientPolicyRow = {
  _id: Id<"policies">;
  carrier?: string | null;
  mga?: string | null;
  policyNumber?: string | null;
  fileName?: string | null;
  effectiveDate?: string | null;
  expirationDate?: string | null;
  documentType?: string | null;
  pipelineStatus?: string | null;
  pipelineError?: string | null;
  extractionDataStage?: string | null;
  extractionPreviewError?: string | null;
  isDemo?: boolean | null;
  uploadedBySide?:
    | "broker"
    | "client"
    | "operator"
    | "email_scan"
    | "agent_email"
    | null;
  premium?: string | null;
};

const clearNode = (_node: ReactNode) => {};
const clearText = (_value: string | null) => {};

function cleanField(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^extracting/i.test(trimmed)) return undefined;
  return trimmed;
}

function formatDate(value?: string | null) {
  const cleaned = cleanField(value);
  if (!cleaned) return "No date";
  const normalized = normalizeExtractedDate(cleaned);
  return normalized ? formatDisplayDate(normalized) : cleaned;
}

function displayStatus(
  status?: string | null,
  extractionDataStage?: string | null,
) {
  if (extractionDataStage === "preview" && status !== "complete") {
    return "enriching";
  }
  if (
    extractionDataStage === "placeholder" &&
    (!status || status === "idle" || status === "running")
  ) {
    return "extracting";
  }
  if (!status || status === "running") return "extracting";
  return status.replace(/_/g, " ");
}

function statusTone(
  status?: string | null,
  extractionDataStage?: string | null,
) {
  const display = displayStatus(status, extractionDataStage);
  if (display === "complete") return "success" as const;
  if (display === "error" || display === "failed") return "danger" as const;
  if (display === "paused") return "warning" as const;
  if (display === "extracting" || display === "enriching")
    return "info" as const;
  return "neutral" as const;
}

function displayUploadedBy(side?: ClientPolicyRow["uploadedBySide"]) {
  if (side === "broker") return "Broker";
  if (side === "client") return "Client";
  if (side === "email_scan") return "Email scan";
  if (side === "agent_email") return "Agent email";
  if (side === "operator") return "Operator";
  return "Unknown";
}

export type ManagedClientPolicyWorkspaceProps = {
  clientOrgId?: string;
  basePath?: string;
  readOnly?: boolean;
  onActions?: (node: ReactNode) => void;
  onRightPanel?: (node: ReactNode) => void;
  onBreadcrumb?: (node: ReactNode) => void;
  onPolicySelect?: (policyId: Id<"policies">) => void;
  policyPreview?: ReactNode;
};

export function ManagedClientPolicyWorkspace({
  clientOrgId: clientOrgIdProp,
  basePath: basePathProp,
  readOnly = false,
  onActions,
  onRightPanel,
  onBreadcrumb,
  onPolicySelect,
  policyPreview,
}: ManagedClientPolicyWorkspaceProps = {}) {
  const params = useParams<{ clientOrgId: string }>();
  const clientOrgId = clientOrgIdProp ?? params.clientOrgId;
  const basePath = basePathProp ?? `/clients/${clientOrgId}/policies`;
  const router = useRouter();
  const searchParams = useSearchParams();
  const showArchived = searchParams.get("view") === "archived";
  const [uploaderOpen, setUploaderOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const pendingExtractionToastsRef = useRef<
    Record<string, { fileName?: string | null }>
  >({});
  const setActions = onActions ?? clearNode;
  const setRightPanel = onRightPanel ?? clearNode;
  const setBreadcrumbExtra = onBreadcrumb ?? clearText;
  const selectPolicy = useCallback(
    (policyId: Id<"policies">) => {
      if (onPolicySelect) {
        onPolicySelect(policyId);
        return;
      }
      router.push(`${basePath}/${policyId}`);
    },
    [basePath, onPolicySelect, router],
  );

  useEffect(() => {
    setBreadcrumbExtra("Policies");
    return () => setBreadcrumbExtra(null);
  }, [setBreadcrumbExtra]);

  useEffect(() => {
    setActions(
      showArchived || readOnly ? null : (
        <PillButton
          type="button"
          size="compact"
          variant="primary"
          onClick={() => setUploaderOpen(true)}
        >
          <Upload className="h-3.5 w-3.5" />
          Upload policy
        </PillButton>
      ),
    );
    return () => setActions(null);
  }, [readOnly, setActions, showArchived]);

  const policies = useCachedQuery(
    "policies.listForOperator",
    api.policies.listForOperator,
    clientOrgId
      ? {
          clientOrgId: clientOrgId as Id<"organizations">,
          documentType: "policy",
          archived: showArchived,
        }
      : "skip",
  );

  const generateUploadUrl = useMutation(api.policies.generateUploadUrlForOrg);
  const checkDuplicateUploadByHash = useMutation(
    api.policies.checkDuplicateUploadByHash,
  );
  const createOperatorUpload = useMutation(api.policies.createOperatorUpload);
  const restorePolicy = useMutation(api.policies.restore);
  const [restoringId, setRestoringId] = useState<Id<"policies"> | null>(null);
  const extractFromUpload = useAction(
    api.actions.extractFromUpload.extractFromUpload,
  );

  async function handleRestore(policyId: Id<"policies">) {
    setRestoringId(policyId);
    try {
      await restorePolicy({ id: policyId });
      toast.success("Policy restored");
    } catch {
      toast.error("Failed to restore policy");
    } finally {
      setRestoringId(null);
    }
  }

  const uploadStorage = useCallback(
    async (file: File): Promise<string> => {
      if (!clientOrgId) throw new Error("Client organization required");
      const uploadUrl = await generateUploadUrl({
        orgId: clientOrgId as Id<"organizations">,
      });
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      if (!res.ok) throw new Error("Storage upload failed");
      const { storageId } = (await res.json()) as { storageId: string };
      return storageId;
    },
    [clientOrgId, generateUploadUrl],
  );

  const resolvePendingExtractionToasts = useCallback(
    (rows: ClientPolicyRow[] | undefined) => {
      if (!rows) return;
      const pending = pendingExtractionToastsRef.current;
      if (Object.keys(pending).length === 0) return;
      const rowsById = new Map(rows.map((policy) => [policy._id, policy]));
      const readyIds = Object.keys(pending).filter((policyId) =>
        rowsById.has(policyId as Id<"policies">),
      );
      if (readyIds.length === 0) return;

      for (const policyId of readyIds) {
        const policy = rowsById.get(policyId as Id<"policies">);
        if (!policy) continue;
        const pendingPolicy = pending[policyId];
        showPolicyExtractionReadyToast(
          {
            ...policy,
            documentType: policy.documentType ?? "policy",
            fileName: policy.fileName ?? pendingPolicy.fileName,
          },
          () => selectPolicy(policyId as Id<"policies">),
        );
        delete pending[policyId];
      }
    },
    [selectPolicy],
  );

  const handleUpload = useCallback(
    async (files: File[], uploadMode: PolicyUploadMode = "combined") => {
      if (!clientOrgId || files.length === 0) return false;
      setUploading(true);
      const progressToastId = `policy-upload:${clientOrgId}`;
      try {
        const orgId = clientOrgId as Id<"organizations">;
        const candidates = await preparePolicyUploadCandidates(
          files,
          (fileSha256) => checkDuplicateUploadByHash({ orgId, fileSha256 }),
        );
        if (!candidates) return false;

        const storageIds: string[] = [];
        for (let i = 0; i < candidates.length; i++) {
          toast.loading(`Uploading ${i + 1} of ${candidates.length}…`, {
            id: progressToastId,
          });
          storageIds.push(await uploadStorage(candidates[i].file));
        }

        if (uploadMode === "separate") {
          for (let i = 0; i < storageIds.length; i++) {
            const uploadArgs = {
              clientOrgId: orgId,
              fileId: storageIds[i] as Id<"_storage">,
              fileName: candidates[i].file.name,
              fileSha256: candidates[i].fileSha256,
              uploadFileSha256s: [candidates[i].fileSha256],
              documentType: "policy" as const,
            };
            const policyId = (await createOperatorUpload(
              uploadArgs,
            )) as Id<"policies">;
            showPolicyExtractionQueuedToast({
              policyId,
              documentType: "policy",
              fileName: candidates[i].file.name,
            });
            pendingExtractionToastsRef.current[policyId] = {
              fileName: candidates[i].file.name,
            };
            resolvePendingExtractionToasts(
              policies as ClientPolicyRow[] | undefined,
            );

            const result = await extractFromUpload({
              fileId: storageIds[i] as Id<"_storage">,
              fileName: candidates[i].file.name,
              fileSha256: candidates[i].fileSha256,
              policyId,
            });
            if (
              result &&
              typeof result === "object" &&
              "error" in result &&
              typeof result.error === "string"
            ) {
              throw new Error(result.error);
            }
          }
        } else {
          const uploadFileSha256s = candidates.map(
            (candidate) => candidate.fileSha256,
          );
          const uploadArgs = {
            clientOrgId: orgId,
            fileId: storageIds[0] as Id<"_storage">,
            fileName: candidates[0].file.name,
            fileSha256: candidates[0].fileSha256,
            uploadFileSha256s,
            documentType: "policy" as const,
          };
          const policyId = (await createOperatorUpload(
            uploadArgs,
          )) as Id<"policies">;
          const displayFileName =
            candidates.length > 1
              ? `${candidates[0].file.name.replace(/\.pdf$/i, "")} + ${candidates.length - 1} more.pdf`
              : candidates[0].file.name;
          showPolicyExtractionQueuedToast({
            policyId,
            documentType: "policy",
            fileName: displayFileName,
          });
          pendingExtractionToastsRef.current[policyId] = {
            fileName: displayFileName,
          };
          resolvePendingExtractionToasts(
            policies as ClientPolicyRow[] | undefined,
          );

          if (candidates.length > 1) {
            toast.loading(`Merging ${candidates.length} files…`, {
              id: progressToastId,
            });
          }
          const result = await extractFromUpload({
            fileId: storageIds[0] as Id<"_storage">,
            fileName: candidates[0].file.name,
            fileSha256: candidates[0].fileSha256,
            policyId,
            additionalFiles: storageIds.slice(1).map((fileId, i) => ({
              fileId: fileId as Id<"_storage">,
              fileName: candidates[i + 1].file.name,
              fileSha256: candidates[i + 1].fileSha256,
            })),
          });
          if (
            result &&
            typeof result === "object" &&
            "error" in result &&
            typeof result.error === "string"
          ) {
            throw new Error(result.error);
          }
        }
        toast.dismiss(progressToastId);
        return true;
      } catch (err) {
        toast.error("Upload failed. Please try again.", {
          id: progressToastId,
        });
        console.error(err);
        return false;
      } finally {
        setUploading(false);
      }
    },
    [
      clientOrgId,
      checkDuplicateUploadByHash,
      uploadStorage,
      createOperatorUpload,
      extractFromUpload,
      policies,
      resolvePendingExtractionToasts,
    ],
  );

  useEffect(() => {
    const uploadPanel =
      showArchived || readOnly ? null : (
        <PolicyUploadDrawer
          open={uploaderOpen}
          onClose={() => setUploaderOpen(false)}
          onUpload={handleUpload}
          uploading={uploading}
        />
      );
    setRightPanel(uploaderOpen ? uploadPanel : (policyPreview ?? uploadPanel));
    return () => setRightPanel(null);
  }, [
    handleUpload,
    readOnly,
    setRightPanel,
    showArchived,
    policyPreview,
    uploaderOpen,
    uploading,
  ]);

  const isLoading = policies === undefined;
  const rows = (policies ?? []) as ClientPolicyRow[];

  useEffect(() => {
    resolvePendingExtractionToasts(policies as ClientPolicyRow[] | undefined);
  }, [policies, resolvePendingExtractionToasts]);

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="min-h-32" aria-hidden="true" />
      ) : rows.length === 0 && showArchived ? (
        <div
          className={`py-16 text-center text-muted-foreground/50 ${typeStyle("body.default")}`}
        >
          No archived policies
        </div>
      ) : rows.length === 0 && readOnly ? (
        <OperationalPanel className="px-4 py-12 text-center text-muted-foreground">
          <p className={typeStyle("body.default")}>No active policies</p>
        </OperationalPanel>
      ) : rows.length === 0 ? (
        <PolicyEmptyState uploading={uploading} onUpload={handleUpload} />
      ) : (
        <OperationalPanel>
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead
                  className={`w-[22%] px-4 text-muted-foreground ${typeStyle("label.table")}`}
                >
                  Carrier
                </TableHead>
                <TableHead
                  className={`w-[16%] text-muted-foreground ${typeStyle("label.table")}`}
                >
                  Policy no.
                </TableHead>
                <TableHead
                  className={`w-[20%] text-muted-foreground ${typeStyle("label.table")}`}
                >
                  Term
                </TableHead>
                <TableHead
                  className={`w-[12%] text-muted-foreground ${typeStyle("label.table")}`}
                >
                  Premium
                </TableHead>
                <TableHead
                  className={`w-[12%] text-muted-foreground ${typeStyle("label.table")}`}
                >
                  Uploaded by
                </TableHead>
                <TableHead
                  className={`w-[10%] text-muted-foreground ${typeStyle("label.table")}`}
                >
                  Status
                </TableHead>
                <TableHead
                  className={`w-[18%] px-4 text-muted-foreground ${typeStyle("label.table")}`}
                >
                  File
                </TableHead>
                {showArchived && !readOnly ? (
                  <TableHead
                    className={`w-28 px-4 text-right text-muted-foreground ${typeStyle("label.table")}`}
                  >
                    Action
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((policy) => {
                const carrier = cleanField(policy.carrier) ?? "Untitled policy";
                const policyNumber =
                  cleanField(policy.policyNumber) ?? "No policy number";
                return (
                  <TableRow
                    key={policy._id}
                    tabIndex={0}
                    onClick={() => selectPolicy(policy._id)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      selectPolicy(policy._id);
                    }}
                    className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <TableCell className="px-4">
                      <p
                        className={`truncate text-foreground ${typeStyle("body.medium")}`}
                      >
                        {carrier}
                      </p>
                    </TableCell>
                    <TableCell className="max-w-44 truncate text-muted-foreground">
                      {policyNumber}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(policy.effectiveDate)} -{" "}
                      {formatDate(policy.expirationDate)}
                    </TableCell>
                    <TableCell className="max-w-28 truncate text-muted-foreground">
                      {cleanField(policy.premium) ?? "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {displayUploadedBy(policy.uploadedBySide)}
                    </TableCell>
                    <TableCell>
                      <StatusTag
                        tone={
                          policy.isDemo
                            ? "neutral"
                            : statusTone(
                                policy.pipelineStatus,
                                policy.extractionDataStage,
                              )
                        }
                        className={`${typeStyle("label.tag")}`}
                      >
                        {policy.isDemo
                          ? "demo"
                          : displayStatus(
                              policy.pipelineStatus,
                              policy.extractionDataStage,
                            )}
                      </StatusTag>
                    </TableCell>
                    <TableCell className="max-w-60 px-4 truncate text-muted-foreground">
                      {cleanField(policy.fileName) ?? "-"}
                    </TableCell>
                    {showArchived && !readOnly ? (
                      <TableCell className="px-4 text-right">
                        <PillButton
                          size="compact"
                          variant="secondary"
                          disabled={restoringId === policy._id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleRestore(policy._id);
                          }}
                        >
                          <ArchiveRestore className="size-3.5" />
                          {restoringId === policy._id
                            ? "Restoring..."
                            : "Restore"}
                        </PillButton>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </OperationalPanel>
      )}
    </div>
  );
}
