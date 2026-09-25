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
import { StatusLabel, type StatusPresentation } from "@claritylabs-inc/ui/components/status-tag";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalSkeletonList,
} from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import { Tabs, TabsList, TabsTrigger } from "@claritylabs-inc/ui/components/tabs";
import { useCachedViewerOrg } from "@/lib/sync/spot-cached-queries";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { usePageContext } from "@/hooks/use-page-context";
import { usePdf } from "@/components/pdf-context";
import { typeStyle } from "@/lib/typography";
import { CertificateGeneratePanel } from "@/components/certificates/certificate-generate-panel";

type CertificateWorkspaceTab = "active" | "archived";
type CertificatePolicyFilter = "all" | `policy:${string}`;

export type CertificatesWorkspaceShellArgs = {
  actions: ReactNode;
  rightPanel: ReactNode;
  toolbar: ReactNode;
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

const TAB_STATUS: Record<CertificateWorkspaceTab, StatusPresentation> = {
  active: { tone: "success" },
  archived: { tone: "neutral", indicator: "inactive" },
};

function certificatePolicyFilterValue(row: PolicyCertificateRecord): CertificatePolicyFilter {
  return `policy:${String(row.policyId)}`;
}

function certificatePolicyFilterOptions(rows: PolicyCertificateRecord[]) {
  const byValue = new Map<CertificatePolicyFilter, string>();
  for (const row of rows) {
    byValue.set(certificatePolicyFilterValue(row), certificatePolicyLabel(row.policy));
  }
  return [
    { value: "all" as const, label: "All policies" },
    ...Array.from(byValue, ([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label)),
  ];
}

function filterCertificates({
  rows,
  policyFilter,
}: {
  rows: PolicyCertificateRecord[];
  policyFilter: CertificatePolicyFilter;
}) {
  return rows.filter((row) =>
    policyFilter === "all" || certificatePolicyFilterValue(row) === policyFilter,
  );
}

function CertificatesPolicyFilter({
  value,
  label,
  options,
  onValueChange,
}: {
  value: CertificatePolicyFilter;
  label: string;
  options: Array<{ value: CertificatePolicyFilter; label: string }>;
  onValueChange: (value: CertificatePolicyFilter) => void;
}) {
  return (
    <label className={`flex min-w-0 max-w-xl flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
      Policy
      <Select
        value={value}
        onValueChange={(next) => next && onValueChange(next as CertificatePolicyFilter)}
      >
        <SelectTrigger className="w-full">
          <SelectValue>{label}</SelectValue>
        </SelectTrigger>
        <SelectContent className="w-auto min-w-(--anchor-width) max-w-[36rem]">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="block max-w-[32rem] truncate">
                {option.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
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
  const [tab, setTab] = useState<CertificateWorkspaceTab>("active");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [selectedCertificateId, setSelectedCertificateId] = useState<Id<"policyCertificates"> | null>(null);
  const [reissuingCertificateId, setReissuingCertificateId] = useState<Id<"policyCertificates"> | null>(null);
  const [savingCertificateId, setSavingCertificateId] = useState<Id<"policyCertificates"> | null>(null);
  const [archivingCertificateId, setArchivingCertificateId] = useState<Id<"policyCertificates"> | null>(null);
  const [unarchivingCertificateId, setUnarchivingCertificateId] = useState<Id<"policyCertificates"> | null>(null);
  const [policyFilter, setPolicyFilter] = useState<CertificatePolicyFilter>("all");
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
  const effectivePolicyFilter = policyFilters.some((option) => option.value === policyFilter)
    ? policyFilter
    : "all";
  const policyFilterLabel = policyFilters.find((option) => option.value === effectivePolicyFilter)?.label ??
    "All policies";
  const visibleCertificates = useMemo(
    () =>
      filterCertificates({
        rows: tableCertificates,
        policyFilter: effectivePolicyFilter,
      }),
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
  }, [archiveCertificateMutation]);

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
  }, [unarchiveCertificateMutation]);

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
        toast.message((result as { message?: string }).message ?? "Broker review is needed before reissue.");
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
            "Broker review is needed before generating this version.",
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
      unarchiveCertificate,
      unarchivingCertificateId,
    ]);
  const generatePanel = useMemo(() => orgId ? (
      <CertificateGeneratePanel
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        orgId={orgId}
      />
    ) : null, [generateOpen, orgId]);
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
    ) : null, [orgId, readOnly]);
  const toolbar = visibleTabs.length > 1 ? (
    <Select
      value={visibleTab}
      onValueChange={(value) => {
        if (value) setTab(value as CertificateWorkspaceTab);
      }}
    >
      <SelectTrigger className="w-40" aria-label="Certificate status">
        <SelectValue>
          <StatusLabel {...TAB_STATUS[visibleTab]}>
            {visibleTabs.find((item) => item.value === visibleTab)?.label ?? "Active"}
          </StatusLabel>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {visibleTabs.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            <StatusLabel {...TAB_STATUS[item.value]}>{item.label}</StatusLabel>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ) : null;
  const content = (
    <>
      <CertificatesPageContext activeCount={activeCertificates.length} />
      <div className="space-y-4">
        {!renderShell && visibleTabs.length > 1 ? (
          <Tabs
            value={visibleTab}
            onValueChange={(value) =>
              setTab(value as CertificateWorkspaceTab)
            }
          >
            <TabsList variant="pill">
              {visibleTabs.map((item) => (
                <TabsTrigger key={item.value} value={item.value}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : null}

        {isLoading ? (
          <OperationalSkeletonList rows={4} />
        ) : tableCertificates.length > 0 ? (
          <>
            <div>
              <CertificatesPolicyFilter
                value={effectivePolicyFilter}
                label={policyFilterLabel}
                options={policyFilters}
                onValueChange={setPolicyFilter}
              />
            </div>
            {visibleCertificates.length > 0 ? (
              <CertificatesTable
                rows={visibleCertificates}
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
    return renderShell({ actions, rightPanel, toolbar, children: content });
  }

  return <AppShell actions={actions} rightPanel={rightPanel}>{content}</AppShell>;
}
