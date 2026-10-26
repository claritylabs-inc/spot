"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PillButton } from "@/components/ui/pill-button";
import { PolicyUploadDrawer } from "@/components/policy-upload-drawer";
import { PolicyEmptyState } from "@/components/policy-empty-state";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import {
  StatusTag,
  type StatusTagTone,
} from "@claritylabs-inc/ui/components/status-tag";
import { OperationalPanel } from "@claritylabs-inc/ui/components/operational-panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableNameLink,
  SortableTableHead,
} from "@/components/ui/table";
import { ArchiveRestore, Upload } from "lucide-react";
import { toast } from "sonner";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { usePolicyUpload } from "@/hooks/use-policy-upload";
import { useFollowedState } from "@/hooks/use-followed-state";
import { useTableSort } from "@/hooks/use-table-sort";
import { normalizeExtractedDate } from "@/convex/lib/valueNormalization";
import { formatDisplayDate } from "@/lib/date-format";
import {
  extractionState,
  type ExtractionStateKind,
} from "@/lib/extraction-state";
import { typeStyle } from "@/lib/typography";

type ClientPolicyRow = {
  _id: Id<"policies">;
  carrier?: string | null;
  policyNumber?: string | null;
  fileName?: string | null;
  effectiveDate?: string | null;
  expirationDate?: string | null;
  documentType?: string | null;
  pipelineStatus?: string | null;
  pipelineError?: string | null;
  extractionDataStage?: string | null;
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

const EXTRACTION_STATUS: Record<
  ExtractionStateKind,
  { label: string; tone: StatusTagTone }
> = {
  extracting: { label: "Reading…", tone: "info" },
  ready: { label: "Ready", tone: "success" },
  needs_review: { label: "Needs review", tone: "warning" },
  failed: { label: "Couldn't read", tone: "danger" },
  not_a_policy: { label: "Not a policy", tone: "warning" },
};

function displayUploadedBy(side?: ClientPolicyRow["uploadedBySide"]) {
  if (side === "broker") return "Provider";
  if (side === "client") return "Client";
  if (side === "email_scan") return "Email scan";
  if (side === "agent_email") return "Agent email";
  if (side === "operator") return "Operator";
  return "Unknown";
}

function sortableDate(value?: string | null) {
  const cleaned = cleanField(value);
  return cleaned ? (normalizeExtractedDate(cleaned) ?? cleaned) : undefined;
}

function sortablePremium(value?: string | null) {
  const digits = cleanField(value)?.replace(/[^\d.]/g, "");
  return digits ? Number(digits) : undefined;
}

const POLICY_SORT_COLUMNS = {
  carrier: (policy: ClientPolicyRow) => cleanField(policy.carrier),
  policyNumber: (policy: ClientPolicyRow) => cleanField(policy.policyNumber),
  term: (policy: ClientPolicyRow) => sortableDate(policy.effectiveDate),
  premium: (policy: ClientPolicyRow) => sortablePremium(policy.premium),
  uploadedBy: (policy: ClientPolicyRow) =>
    displayUploadedBy(policy.uploadedBySide),
  status: (policy: ClientPolicyRow) =>
    policy.isDemo ? "demo" : EXTRACTION_STATUS[extractionState(policy).kind].label,
  file: (policy: ClientPolicyRow) => cleanField(policy.fileName),
};

export type ManagedClientPolicyWorkspaceProps = {
  clientOrgId?: string;
  basePath?: string;
  readOnly?: boolean;
  showArchived?: boolean;
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
  showArchived = false,
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
  const [uploaderOpen, setUploaderOpen] = useFollowedState(
    `policy:client:${clientOrgId}:uploader-open`,
    false,
  );
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
  }, [readOnly, setActions, setUploaderOpen, showArchived]);

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

  const createOperatorUpload = useMutation(api.policies.createOperatorUpload);
  const restorePolicy = useMutation(api.policies.restore);
  const [restoringId, setRestoringId] = useState<Id<"policies"> | null>(null);
  const { upload: handleUpload, uploading } = usePolicyUpload({
    orgId: clientOrgId as Id<"organizations"> | undefined,
    registerUpload: useCallback(
      (args) =>
        createOperatorUpload({
          ...args,
          clientOrgId: clientOrgId as Id<"organizations">,
          documentType: "policy",
        }),
      [clientOrgId, createOperatorUpload],
    ),
    rows: policies as ClientPolicyRow[] | undefined,
    onOpenPolicy: useCallback(
      (policyId: Id<"policies">) => router.push(`${basePath}/${policyId}`),
      [basePath, router],
    ),
  });

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
    setUploaderOpen,
    showArchived,
    policyPreview,
    uploaderOpen,
    uploading,
  ]);

  const isLoading = policies === undefined;
  const rows = useMemo(
    () => (policies ?? []) as ClientPolicyRow[],
    [policies],
  );
  const tableSort = useTableSort(
    `policy:client:${clientOrgId}:${showArchived ? "archived" : "active"}`,
    rows,
    POLICY_SORT_COLUMNS,
  );

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
          <Table storageKey="spot:policies:list:columns" className="min-w-[900px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortableTableHead
                  className={`w-[22%] px-4 text-muted-foreground ${typeStyle("label.table")}`}
                  {...tableSort.head("carrier")}
                >
                  Carrier
                </SortableTableHead>
                <SortableTableHead
                  className={`w-[16%] text-muted-foreground ${typeStyle("label.table")}`}
                  {...tableSort.head("policyNumber")}
                >
                  Policy no.
                </SortableTableHead>
                <SortableTableHead
                  className={`w-[20%] text-muted-foreground ${typeStyle("label.table")}`}
                  {...tableSort.head("term")}
                >
                  Term
                </SortableTableHead>
                <SortableTableHead
                  className={`w-[12%] text-muted-foreground ${typeStyle("label.table")}`}
                  {...tableSort.head("premium")}
                >
                  Premium
                </SortableTableHead>
                <SortableTableHead
                  className={`w-[12%] text-muted-foreground ${typeStyle("label.table")}`}
                  {...tableSort.head("uploadedBy")}
                >
                  Uploaded by
                </SortableTableHead>
                <SortableTableHead
                  className={`w-[10%] text-muted-foreground ${typeStyle("label.table")}`}
                  {...tableSort.head("status")}
                >
                  Status
                </SortableTableHead>
                <SortableTableHead
                  className={`w-[18%] px-4 text-muted-foreground ${typeStyle("label.table")}`}
                  {...tableSort.head("file")}
                >
                  File
                </SortableTableHead>
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
              {tableSort.rows.map((policy) => {
                const carrier = cleanField(policy.carrier) ?? "Untitled policy";
                const policyNumber =
                  cleanField(policy.policyNumber) ?? "No policy number";
                const status = EXTRACTION_STATUS[extractionState(policy).kind];
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
                      <TableNameLink
                        href={`${basePath}/${policy._id}`}
                        className="truncate"
                      >
                        {carrier}
                      </TableNameLink>
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
                      {policy.isDemo ? (
                        <Badge variant="outline">demo</Badge>
                      ) : (
                        <StatusTag tone={status.tone}>{status.label}</StatusTag>
                      )}
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
