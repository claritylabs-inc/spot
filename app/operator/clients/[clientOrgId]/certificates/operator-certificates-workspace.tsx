"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAction, useMutation } from "convex/react";
import { useFollowedState } from "@/hooks/use-followed-state";
import { BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import {
  CertificateDetailPanel,
  certificateVersionActionInput,
  type CertificateHolderDraft,
  type PolicyCertificateRecord,
} from "@/components/certificates/certificate-workspace";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalSkeletonList,
} from "@claritylabs-inc/ui/components/operational-panel";
import { StatusTag, type StatusIndicatorKind } from "@claritylabs-inc/ui/components/status-tag";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
  SortableTableHead,
} from "@/components/ui/table";
import { usePageContextLayer } from "@/hooks/use-page-context";
import { useTableSort } from "@/hooks/use-table-sort";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDisplayDateTime } from "@/lib/date-format";
import {
  certificateContextRelated,
  certificateContextSummary,
} from "@/lib/policy-page-context";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { PillButton } from "@/components/ui/pill-button";
import { CertificateGeneratePanel } from "@/components/certificates/certificate-generate-panel";

function displayValue(value?: string) {
  return value?.replaceAll("_", " ") ?? "—";
}

function statusIndicator(status?: string): StatusIndicatorKind {
  if (["active", "issued", "sent"].includes(status ?? "")) return "complete";
  if (status === "cancelled" || status === "void") return "cancelled";
  if (status === "archived") return "inactive";
  if (status === "failed" || status === "blocked_missing_contact") return "error";
  if (status === "review_required") return "waiting";
  if (status === "sending") return "progress";
  if (status === "draft") return "draft";
  return "pending";
}

function statusTone(status?: string) {
  if (status === "active" || status === "issued" || status === "sent") {
    return "success" as const;
  }
  if (status === "failed" || status === "blocked_missing_contact") {
    return "danger" as const;
  }
  if (status === "review_required") return "warning" as const;
  if (status === "sending" || status === "queued") return "info" as const;
  return "neutral" as const;
}

const CERTIFICATE_SORT_COLUMNS = {
  status: (row: PolicyCertificateRecord) => displayValue(row.status),
  holder: (row: PolicyCertificateRecord) => row.holder?.displayName,
  policy: (row: PolicyCertificateRecord) => row.policy?.policyNumber,
  form: (row: PolicyCertificateRecord) => row.currentVersion?.formCode,
  version: (row: PolicyCertificateRecord) => row.currentVersion?.versionNumber,
  updated: (row: PolicyCertificateRecord) =>
    row.updatedAt ?? row.lastIssuedAt ?? row.currentVersion?.createdAt,
};

export function OperatorCertificatesWorkspace({
  orgId,
  readOnly,
  onActions,
  onRightPanel,
}: {
  orgId: Id<"organizations">;
  readOnly: boolean;
  onActions: (actions: ReactNode) => void;
  onRightPanel: (panel: ReactNode) => void;
}) {
  const certificates = useCachedQuery(
    "certificateLifecycle.listForOrg.operator",
    api.certificateLifecycle.listForOrg,
    { orgId },
  ) as PolicyCertificateRecord[] | undefined;
  const generateCertificate = useAction(api.certificates.generateForPolicy);
  const archiveCertificateMutation = useMutation(api.certificateLifecycle.archive);
  const unarchiveCertificateMutation = useMutation(api.certificateLifecycle.unarchive);
  const [selectedCertificateId, setSelectedCertificateId] =
    useFollowedState<Id<"policyCertificates"> | null>(
      `clients:${orgId}:certificates:selected`,
      null,
    );
  const [generateOpen, setGenerateOpen] = useFollowedState(
    `clients:${orgId}:certificates:generate-open`,
    false,
  );
  const [reissuingCertificateId, setReissuingCertificateId] =
    useState<Id<"policyCertificates"> | null>(null);
  const [savingCertificateId, setSavingCertificateId] =
    useState<Id<"policyCertificates"> | null>(null);
  const [archivingCertificateId, setArchivingCertificateId] =
    useState<Id<"policyCertificates"> | null>(null);
  const [unarchivingCertificateId, setUnarchivingCertificateId] =
    useState<Id<"policyCertificates"> | null>(null);

  const selectedCertificate = useMemo(
    () =>
      (certificates ?? []).find((row) => row._id === selectedCertificateId) ??
      null,
    [certificates, selectedCertificateId],
  );
  const visibleCertificates = useMemo(() => certificates ?? [], [certificates]);
  const tableSort = useTableSort(
    `clients:${orgId}:certificates`,
    visibleCertificates,
    CERTIFICATE_SORT_COLUMNS,
    { key: "updated", direction: "desc" },
  );

  const archiveCertificate = useCallback(async (row: PolicyCertificateRecord) => {
    setArchivingCertificateId(row._id);
    try {
      await archiveCertificateMutation({ certificateId: row._id });
      toast.success("Certificate archived");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not archive certificate"));
    } finally {
      setArchivingCertificateId(null);
    }
  }, [archiveCertificateMutation]);

  const unarchiveCertificate = useCallback(async (row: PolicyCertificateRecord) => {
    setUnarchivingCertificateId(row._id);
    try {
      await unarchiveCertificateMutation({ certificateId: row._id });
      toast.success("Certificate restored");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not restore certificate"));
    } finally {
      setUnarchivingCertificateId(null);
    }
  }, [unarchiveCertificateMutation]);

  const reissueCertificate = useCallback(async (row: PolicyCertificateRecord) => {
    if (!row.holder?.displayName) {
      toast.error("Certificate holder is missing");
      return;
    }
    setReissuingCertificateId(row._id);
    try {
      const result = await generateCertificate(certificateVersionActionInput(row));
      const status = (result as { status?: string }).status;
      if (status === "ambiguous_certificate_holder" || status === "held_policy_change_required") {
        toast.message(
          (result as { message?: string }).message ??
            "Provider review is required before reissue.",
        );
        return;
      }
      toast.success("Certificate reissued");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not reissue certificate"));
    } finally {
      setReissuingCertificateId(null);
    }
  }, [generateCertificate]);

  const editCertificateHolder = useCallback(async (
    row: PolicyCertificateRecord,
    draft: CertificateHolderDraft,
  ) => {
    setSavingCertificateId(row._id);
    try {
      const result = await generateCertificate(
        certificateVersionActionInput(row, draft),
      );
      if ((result as { status?: string }).status === "held_policy_change_required") {
        toast.message(
          (result as { message?: string }).message ??
            "Provider review is required before generating this version.",
        );
        return false;
      }
      toast.success("New certificate version generated");
      return true;
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not update certificate holder"),
      );
      return false;
    } finally {
      setSavingCertificateId(null);
    }
  }, [generateCertificate]);

  // The AI panel works on the open certificate while its panel is shown.
  const contextCertificate =
    generateOpen && !readOnly ? null : selectedCertificate;
  usePageContextLayer(
    contextCertificate
      ? {
          pageType: "certificate",
          entityId: contextCertificate._id,
          summary: certificateContextSummary(contextCertificate),
          related: certificateContextRelated({ ...contextCertificate, orgId }),
        }
      : null,
  );

  useEffect(() => {
    onActions(readOnly ? null : (
      <PillButton
        type="button"
        size="compact"
        variant="primary"
        onClick={() => {
          setSelectedCertificateId(null);
          setGenerateOpen(true);
        }}
      >
        <BadgeCheck className="size-3.5" />
        Generate certificate
      </PillButton>
    ));
    return () => onActions(null);
  }, [onActions, readOnly, setGenerateOpen, setSelectedCertificateId]);

  useEffect(() => {
    if (generateOpen && !readOnly) {
      onRightPanel(
        <CertificateGeneratePanel
          open
          onOpenChange={setGenerateOpen}
          orgId={orgId}
        />,
      );
      return () => onRightPanel(null);
    }
    if (!selectedCertificate) {
      onRightPanel(null);
      return;
    }
    onRightPanel(
      <CertificateDetailPanel
        row={selectedCertificate}
        onClose={() => setSelectedCertificateId(null)}
        onReissue={!readOnly ? reissueCertificate : undefined}
        onEditHolder={!readOnly ? editCertificateHolder : undefined}
        onArchive={!readOnly ? archiveCertificate : undefined}
        onUnarchive={!readOnly ? unarchiveCertificate : undefined}
        reissuing={reissuingCertificateId === selectedCertificate._id}
        savingHolder={savingCertificateId === selectedCertificate._id}
        archiving={archivingCertificateId === selectedCertificate._id}
        unarchiving={unarchivingCertificateId === selectedCertificate._id}
        actionPresentation="labels"
      />,
    );
    return () => onRightPanel(null);
  }, [
    archivingCertificateId,
    archiveCertificate,
    editCertificateHolder,
    generateOpen,
    onRightPanel,
    orgId,
    readOnly,
    reissueCertificate,
    reissuingCertificateId,
    savingCertificateId,
    selectedCertificate,
    setGenerateOpen,
    setSelectedCertificateId,
    unarchiveCertificate,
    unarchivingCertificateId,
  ]);

  return (
    <div className="space-y-4">
      {certificates === undefined ? (
        <OperationalSkeletonList rows={5} />
      ) : visibleCertificates.length === 0 ? (
        <OperationalPanel as="div">
          <OperationalPanelBody
            className={`py-10 text-center text-muted-foreground ${typeStyle("body.default")}`}
          >
            No certificates are available.
          </OperationalPanelBody>
        </OperationalPanel>
      ) : (
        <OperationalPanel as="div">
          <div className="overflow-x-auto">
            <Table storageKey="spot:certificates:columns" className="min-w-[1220px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortableTableHead className="w-[12%] px-4" {...tableSort.head("status")}>
                    Status
                  </SortableTableHead>
                  <SortableTableHead className="w-[24%]" {...tableSort.head("holder")}>
                    Holder
                  </SortableTableHead>
                  <SortableTableHead className="w-[24%]" {...tableSort.head("policy")}>
                    Policy
                  </SortableTableHead>
                  <SortableTableHead className="w-[16%]" {...tableSort.head("form")}>
                    Form / request
                  </SortableTableHead>
                  <SortableTableHead className="w-[10%]" {...tableSort.head("version")}>
                    Version
                  </SortableTableHead>
                  <SortableTableHead className="w-[14%] px-4" {...tableSort.head("updated")}>
                    Updated
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableSort.rows.map((row) => {
                  const version = row.currentVersion;
                  return (
                    <TableRow
                      key={row._id}
                      className="cursor-pointer"
                      aria-selected={selectedCertificateId === row._id}
                      data-state={selectedCertificateId === row._id ? "selected" : undefined}
                      tabIndex={0}
                      onClick={() => setSelectedCertificateId(row._id)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        setSelectedCertificateId(row._id);
                      }}
                    >
                      <TableCell className="px-4">
                        <StatusTag tone={statusTone(row.status)} indicator={statusIndicator(row.status)}>
                          {displayValue(row.status)}
                        </StatusTag>
                      </TableCell>
                      <TableCell className="max-w-64">
                        <p className={`truncate text-foreground ${typeStyle("body.medium")}`}>
                          {row.holder?.displayName ?? "Certificate holder"}
                        </p>
                        <p className={`truncate text-muted-foreground ${typeStyle("caption.default")}`}>
                          {row.holder?.email ?? row.holder?.contactName ?? "No contact"}
                        </p>
                      </TableCell>
                      <TableCell className="max-w-64">
                        <p className="truncate text-foreground">
                          {row.policy?.policyNumber ?? "Policy"}
                        </p>
                        <p className={`truncate text-muted-foreground ${typeStyle("caption.default")}`}>
                          {row.policy?.carrier ?? row.policy?.security ?? "Carrier unavailable"}
                        </p>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <p>{displayValue(version?.formCode)}</p>
                        <p className={typeStyle("caption.default")}>
                          {displayValue(version?.requestKind)}
                        </p>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {version ? `v${version.versionNumber}` : "—"}
                      </TableCell>
                      <TableCell className="px-4 text-muted-foreground">
                        {formatDisplayDateTime(
                          row.updatedAt ?? row.lastIssuedAt ?? version?.createdAt,
                          "—",
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </OperationalPanel>
      )}
    </div>
  );
}
