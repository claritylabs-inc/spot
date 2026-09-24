"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAction, useMutation } from "convex/react";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDisplayDateTime } from "@/lib/date-format";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { PillButton } from "@/components/ui/pill-button";
import { CertificateGeneratePanel } from "@/components/certificates/certificate-generate-panel";

type CertificateWorkflowJob = {
  _id: Id<"certificateWorkflowJobs">;
  certificateId: Id<"policyCertificates">;
  kind: string;
  status: string;
  reason?: string;
  recipientName?: string;
  recipientEmail?: string;
  lastError?: string;
  updatedAt: number;
};

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
  const jobs = useCachedQuery(
    "certificateWorkflowJobs.listForOrg.operator",
    api.certificateWorkflowJobs.listForOrg,
    { orgId },
  ) as CertificateWorkflowJob[] | undefined;
  const generateCertificate = useAction(api.certificates.generateForPolicy);
  const archiveCertificateMutation = useMutation(api.certificateLifecycle.archive);
  const unarchiveCertificateMutation = useMutation(api.certificateLifecycle.unarchive);
  const [selectedCertificateId, setSelectedCertificateId] =
    useState<Id<"policyCertificates"> | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [reissuingCertificateId, setReissuingCertificateId] =
    useState<Id<"policyCertificates"> | null>(null);
  const [savingCertificateId, setSavingCertificateId] =
    useState<Id<"policyCertificates"> | null>(null);
  const [archivingCertificateId, setArchivingCertificateId] =
    useState<Id<"policyCertificates"> | null>(null);
  const [unarchivingCertificateId, setUnarchivingCertificateId] =
    useState<Id<"policyCertificates"> | null>(null);

  const openJobs = useMemo(
    () => (jobs ?? []).filter((job) => !["sent", "cancelled"].includes(job.status)),
    [jobs],
  );
  const latestJobByCertificate = useMemo(() => {
    const result = new Map<Id<"policyCertificates">, CertificateWorkflowJob>();
    for (const job of [...openJobs].sort((a, b) => b.updatedAt - a.updatedAt)) {
      if (!result.has(job.certificateId)) result.set(job.certificateId, job);
    }
    return result;
  }, [openJobs]);
  const selectedCertificate = useMemo(
    () =>
      (certificates ?? []).find((row) => row._id === selectedCertificateId) ??
      null,
    [certificates, selectedCertificateId],
  );
  const visibleCertificates = useMemo(() => {
    return [...(certificates ?? [])].sort(
        (left, right) =>
          Number(right.updatedAt ?? right.lastIssuedAt ?? 0) -
          Number(left.updatedAt ?? left.lastIssuedAt ?? 0),
      );
  }, [certificates]);

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
            "Broker review is required before reissue.",
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
            "Broker review is required before generating this version.",
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
  }, [onActions, readOnly]);

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
    unarchiveCertificate,
    unarchivingCertificateId,
  ]);

  return (
    <div className="space-y-4">
      {certificates === undefined || jobs === undefined ? (
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
            <Table className="min-w-[1220px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[10%] px-4">Status</TableHead>
                  <TableHead className="w-[20%]">Holder</TableHead>
                  <TableHead className="w-[20%]">Policy</TableHead>
                  <TableHead className="w-[14%]">Form / request</TableHead>
                  <TableHead className="w-[16%]">Workflow</TableHead>
                  <TableHead className="w-[8%]">Version</TableHead>
                  <TableHead className="w-[12%] px-4">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleCertificates.map((row) => {
                  const version = row.currentVersion;
                  const job = latestJobByCertificate.get(row._id);
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
                      <TableCell className="max-w-56">
                        {job ? (
                          <>
                            <StatusTag tone={statusTone(job.status)} indicator={statusIndicator(job.status)}>
                              {displayValue(job.status)}
                            </StatusTag>
                            <p className={`mt-1 truncate text-muted-foreground ${typeStyle("caption.default")}`}>
                              {job.lastError ?? job.reason ?? displayValue(job.kind)}
                            </p>
                          </>
                        ) : (
                          <span className="text-muted-foreground">No open job</span>
                        )}
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
