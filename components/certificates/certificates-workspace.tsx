"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAction, useMutation } from "convex/react";
import { BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import {
  CertificateDetailPanel,
  CertificatesTable,
  certificatePolicyLabel,
  certificateVersionActionInput,
  type CertificateHolderDraft,
  type PolicyCertificateRecord,
} from "@/components/certificates/certificate-workspace";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalSkeletonList,
} from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { ListToolbar, type FilterDefinition } from "@/components/ui/list-toolbar";
import { useCachedViewerOrg } from "@/lib/sync/spot-cached-queries";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { usePageContext } from "@/hooks/use-page-context";
import { useFollowedState } from "@/hooks/use-followed-state";
import { usePdf } from "@/components/pdf-context";
import { typeStyle } from "@/lib/typography";
import { CertificateGeneratePanel } from "@/components/certificates/certificate-generate-panel";

type CertificateWorkspaceTab = "active" | "archived";
type CertificatePolicyFilter = `policy:${string}`;

type CertificatesWorkspaceShellArgs = {
  actions: ReactNode;
  rightPanel: ReactNode;
  children: ReactNode;
};

export type CertificatesWorkspaceProps = {
  orgId?: Id<"organizations">;
  readOnly?: boolean;
  renderShell?: (args: CertificatesWorkspaceShellArgs) => ReactNode;
};

const TABS: Array<{ value: CertificateWorkspaceTab; label: string }> = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

function certificatePolicyFilterValue(row: PolicyCertificateRecord): CertificatePolicyFilter {
  return `policy:${String(row.policyId)}`;
}

function certificatePolicyFilterOptions(rows: PolicyCertificateRecord[]) {
  const byValue = new Map<CertificatePolicyFilter, string>();
  for (const row of rows) {
    byValue.set(certificatePolicyFilterValue(row), certificatePolicyLabel(row.policy));
  }
  return Array.from(byValue, ([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function CertificateEmptyPanel({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <OperationalPanel as="div">
      <OperationalPanelBody className="px-4 py-10 text-center">
        <p className={`text-foreground ${typeStyle("body.medium")}`}>
          {title}
        </p>
        {description ? (
          <p className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}>
            {description}
          </p>
        ) : null}
      </OperationalPanelBody>
    </OperationalPanel>
  );
}

function CertificatesPageContext({
  activeCount,
}: {
  activeCount: number;
}) {
  const { setPageContext } = usePageContext();

  useEffect(() => {
    setPageContext({
      pageType: "certificates",
      summary: `${activeCount} active certificate${activeCount === 1 ? "" : "s"}`,
    });

    return () => setPageContext(null);
  }, [activeCount, setPageContext]);

  return null;
}

export function CertificatesWorkspace({
  orgId: orgIdOverride,
  readOnly = false,
  renderShell,
}: CertificatesWorkspaceProps = {}) {
  const generateCertificate = useAction(api.certificates.generateForPolicy);
  const archiveCertificateMutation = useMutation(api.certificateLifecycle.archive);
  const unarchiveCertificateMutation = useMutation(api.certificateLifecycle.unarchive);
  const { openWithUrl } = usePdf();
  const uiKey = `certificates:${orgIdOverride ?? "own"}`;
  const [tab, setTab] = useFollowedState<CertificateWorkspaceTab>(`${uiKey}:tab`, "active");
  const [generateOpen, setGenerateOpen] = useFollowedState(`${uiKey}:generate-open`, false);
  const [selectedCertificateId, setSelectedCertificateId] = useFollowedState<Id<"policyCertificates"> | null>(`${uiKey}:selected`, null);
  const [reissuingCertificateId, setReissuingCertificateId] = useState<Id<"policyCertificates"> | null>(null);
  const [savingCertificateId, setSavingCertificateId] = useState<Id<"policyCertificates"> | null>(null);
  const [archivingCertificateId, setArchivingCertificateId] = useState<Id<"policyCertificates"> | null>(null);
  const [unarchivingCertificateId, setUnarchivingCertificateId] = useState<Id<"policyCertificates"> | null>(null);
  const [policyFilter, setPolicyFilter] = useFollowedState<string[]>(`${uiKey}:policy-filters`, []);
  const viewerOrg = useCachedViewerOrg();
  const orgId =
    orgIdOverride ??
    (viewerOrg?.org?._id as Id<"organizations"> | undefined);
  const certificates = useCachedQuery(
    "certificateLifecycle.listForOrg",
    api.certificateLifecycle.listForOrg,
    orgId ? { orgId } : "skip",
  ) as PolicyCertificateRecord[] | undefined;

  const activeCertificates = useMemo(
    () =>
      (certificates ?? [])
        .filter((row) => row.status === "active")
        .sort((left, right) =>
          Number(right.lastIssuedAt ?? right.currentVersion?.createdAt ?? 0) -
          Number(left.lastIssuedAt ?? left.currentVersion?.createdAt ?? 0),
        ),
    [certificates],
  );
  const archivedCertificates = useMemo(
    () =>
      (certificates ?? [])
        .filter((row) => row.status === "archived")
        .sort((left, right) =>
          Number(right.archivedAt ?? right.updatedAt ?? 0) -
          Number(left.archivedAt ?? left.updatedAt ?? 0),
        ),
    [certificates],
  );
  const selectedCertificate = useMemo(
    () =>
      (certificates ?? []).find((row) => row._id === selectedCertificateId) ??
      null,
    [certificates, selectedCertificateId],
  );
  const visibleTabs = TABS.filter((item) =>
    item.value === "active" ||
    (item.value === "archived" && archivedCertificates.length > 0),
  );
  const visibleTab = visibleTabs.some((item) => item.value === tab) ? tab : "active";
  const tableCertificates = visibleTab === "archived" ? archivedCertificates : activeCertificates;
  const policyFilters = useMemo(
    () => certificatePolicyFilterOptions(tableCertificates),
    [tableCertificates],
  );
  const effectivePolicyFilter = policyFilter.filter((value) =>
    policyFilters.some((option) => option.value === value),
  );
  const visibleCertificates = useMemo(
    () =>
      tableCertificates.filter(
        (row) =>
          effectivePolicyFilter.length === 0 ||
          effectivePolicyFilter.includes(certificatePolicyFilterValue(row)),
      ),
    [effectivePolicyFilter, tableCertificates],
  );

  const isLoading =
    (!orgIdOverride && viewerOrg === undefined) || certificates === undefined;

  const archiveCertificate = useCallback(async (row: PolicyCertificateRecord) => {
    setArchivingCertificateId(row._id);
    try {
      await archiveCertificateMutation({ certificateId: row._id });
      setTab("archived");
      toast.success("Certificate archived");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not archive certificate"),
      );
    } finally {
      setArchivingCertificateId(null);
    }
  }, [archiveCertificateMutation, setTab]);

  const unarchiveCertificate = useCallback(async (row: PolicyCertificateRecord) => {
    setUnarchivingCertificateId(row._id);
    try {
      await unarchiveCertificateMutation({ certificateId: row._id });
      setTab("active");
      toast.success("Certificate restored");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not restore certificate"),
      );
    } finally {
      setUnarchivingCertificateId(null);
    }
  }, [unarchiveCertificateMutation, setTab]);

  const reissueCertificate = useCallback(async (row: PolicyCertificateRecord) => {
    const holder = row.holder;
    if (!holder?.displayName) {
      toast.error("Certificate holder is missing");
      return;
    }
    setReissuingCertificateId(row._id);
    try {
      const result = await generateCertificate(certificateVersionActionInput(row));
      if ((result as { status?: string }).status === "ambiguous_certificate_holder") {
        toast.message((result as { message?: string }).message ?? "Choose the existing certificate to reissue.");
        return;
      }
      if ((result as { status?: string }).status === "held_policy_change_required") {
        toast.message((result as { message?: string }).message ?? "Provider review is needed before reissue.");
        return;
      }
      toast.success("Certificate reissued");
      if ((result as { url?: string }).url) {
        openWithUrl((result as { url: string }).url);
      }
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not reissue certificate"),
      );
    } finally {
      setReissuingCertificateId(null);
    }
  }, [generateCertificate, openWithUrl]);

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
            "Provider review is needed before generating this version.",
        );
        return false;
      }
      const versionNumber = (result as { versionNumber?: number }).versionNumber;
      toast.success(
        versionNumber
          ? `Certificate version ${versionNumber} generated`
          : "New certificate version generated",
      );
      if ((result as { url?: string }).url) {
        openWithUrl((result as { url: string }).url);
      }
      return true;
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Could not update certificate holder",
        ),
      );
      return false;
    } finally {
      setSavingCertificateId(null);
    }
  }, [generateCertificate, openWithUrl]);

  const certificateDetailPanel = useMemo(() => selectedCertificate ? (
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
      />
    ) : null, [
      archiveCertificate,
      archivingCertificateId,
      editCertificateHolder,
      readOnly,
      reissueCertificate,
      reissuingCertificateId,
      savingCertificateId,
      selectedCertificate,
      setSelectedCertificateId,
      unarchiveCertificate,
      unarchivingCertificateId,
    ]);
  const generatePanel = useMemo(() => orgId ? (
      <CertificateGeneratePanel
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        orgId={orgId}
      />
    ) : null, [generateOpen, orgId, setGenerateOpen]);
  const rightPanel = generateOpen ? generatePanel : certificateDetailPanel;
  const actions = useMemo(() => !readOnly && orgId ? (
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
    ) : null, [orgId, readOnly, setGenerateOpen, setSelectedCertificateId]);
  const certificateFilters: FilterDefinition[] = [
    ...(visibleTabs.length > 1
      ? [
          {
            id: "status",
            label: "Status",
            inline: true,
            allLabel: "Active",
            value: visibleTab === "archived" ? ["archived"] : [],
            onChange: (value: string[]) =>
              setTab(value[0] === "archived" ? "archived" : "active"),
            options: [{ value: "archived", label: "Archived" }],
          },
        ]
      : []),
    ...(!isLoading && tableCertificates.length > 0
      ? [
          {
            id: "policy",
            label: "Policy",
            inline: true,
            multiple: true,
            allLabel: "All policies",
            value: effectivePolicyFilter,
            onChange: setPolicyFilter,
            options: policyFilters,
          },
        ]
      : []),
  ];
  const content = (
    <>
      <CertificatesPageContext activeCount={activeCertificates.length} />
      <div className="space-y-4">
        {certificateFilters.length > 0 ? (
          <ListToolbar followKey={uiKey} filters={certificateFilters} />
        ) : null}

        {isLoading ? (
          <OperationalSkeletonList rows={4} />
        ) : tableCertificates.length > 0 ? (
          <>
            {visibleCertificates.length > 0 ? (
              <CertificatesTable
                rows={visibleCertificates}
                sortKey={`${uiKey}:${tab}`}
                selectedCertificateId={selectedCertificateId}
                onSelectCertificate={(row) => setSelectedCertificateId(row._id)}
              />
            ) : (
              <CertificateEmptyPanel title="No certificates match these filters" />
            )}
          </>
        ) : (
          <CertificateEmptyPanel
            title={visibleTab === "archived" ? "No archived certificates" : "No active certificates"}
            description={
              visibleTab === "archived"
                ? undefined
                : "Generate a COI from a policy to create the first holder-based certificate."
            }
          />
        )}
      </div>
    </>
  );

  if (renderShell) {
    return renderShell({ actions, rightPanel, children: content });
  }

  return <AppShell actions={actions} rightPanel={rightPanel}>{content}</AppShell>;
}
