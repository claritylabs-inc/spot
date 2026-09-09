"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import dayjs from "dayjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  FileText,
  Link2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { StatusTag } from "@/components/ui/status-tag";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import {
  OperationalPanel,
  OperationalLabelValueList,
  OperationalLabelValueRow,
} from "@/components/ui/operational-panel";
import { Input } from "@/components/ui/input";
import { PillButton } from "@/components/ui/pill-button";
import { Textarea } from "@/components/ui/textarea";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { useActiveOrgContext } from "@/lib/hooks/use-active-org-context";
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";
import { formatDisplayDate } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";

type ConnectedOrgsApi = {
  connectedOrgs: {
    listVendors: FunctionReference<"query">;
    listClients: FunctionReference<"query">;
    requestVendorAccess: FunctionReference<"mutation">;
    requestVendorAccessByEmail: FunctionReference<"action">;
    resendVendorInvitation: FunctionReference<"action">;
    approve: FunctionReference<"mutation">;
    revoke: FunctionReference<"mutation">;
  };
  compliance: {
    listVendorCompliance: FunctionReference<"query">;
  };
};

const connectedOrgsApi = api as unknown as ConnectedOrgsApi;

export type ConnectedOrgsPageKind = "clients" | "vendors";

type ConnectedOrgRow = {
  _id: string;
  kind?: "relationship" | "invitation";
  invitationId?: Id<"connectedOrgInvitations">;
  invitationStatus?: "pending" | "accepted" | "expired" | "revoked";
  relationshipId?: Id<"connectedOrgRelationships">;
  status: "pending" | "active" | "expired" | "revoked";
  relationshipLabel?: string;
  note?: string;
  updatedAt: number;
  clientOrg?: {
    _id: Id<"organizations">;
    name: string;
    website?: string;
  } | null;
  vendorOrg?: {
    _id: Id<"organizations">;
    name: string;
    website?: string;
  } | null;
  vendorEmail?: string;
};

type VendorComplianceSummary = {
  relationshipId: Id<"connectedOrgRelationships">;
  status: "non_compliant" | "attention" | "no_requirements" | "compliant";
  requirementCount: number;
  policyCount: number;
  metCount: number;
  missingCount: number;
  expiringSoonCount: number;
  checks: VendorComplianceCheck[];
};

type VendorComplianceCheck = {
  requirement: {
    _id: Id<"insuranceRequirements">;
    title: string;
    kind: "coverage" | "insurer" | "condition";
    lineOfBusiness?: string;
    limits?: Array<{ kind: string; amount: number; label?: string }>;
    provisions?: string[];
    requirementText: string;
  };
  status: "met" | "not_met" | "expiring_soon" | "expired" | "unverified";
  expiresAt?: string;
  daysUntilExpiration?: number;
  notes?: string;
  matchedPolicy?: {
    _id: Id<"policies">;
    carrier?: string;
    policyNumber?: string;
    insuredName?: string;
    expectedInsuredName?: string;
    expirationDate?: string;
    coverageName?: string;
    coverageLimit?: string;
    detectedLimitAmount?: number;
  };
};

function VendorStatusTag({
  row,
  complianceSummary,
}: {
  row: ConnectedOrgRow;
  complianceSummary?: VendorComplianceSummary;
}) {
  if (row.status !== "active") {
    return <StatusTag tone="warning">Invited</StatusTag>;
  }
  if (!complianceSummary || complianceSummary.policyCount === 0) {
    return <StatusTag>Waiting on policies</StatusTag>;
  }
  if (complianceSummary.status === "compliant") {
    return (
      <StatusTag tone="success">Active / compliant</StatusTag>
    );
  }
  if (complianceSummary.status === "attention") {
    return (
      <StatusTag tone="warning">
        <AlertCircle className="h-3 w-3" />
        Needs attention
      </StatusTag>
    );
  }
  return (
    <StatusTag tone="danger">Active / noncompliant</StatusTag>
  );
}

function RelationshipStatusTag({
  status,
}: {
  status: ConnectedOrgRow["status"];
}) {
  const tone =
    status === "active"
      ? "success"
      : status === "pending"
        ? "warning"
        : status === "expired"
          ? "danger"
          : "neutral";
  return <StatusTag tone={tone} className={`${typeStyle("label.tag")}`}>{status}</StatusTag>;
}

function formatDate(value: string | undefined) {
  if (!value) return "No expiration date";
  return formatDisplayDate(value, value);
}

function formatMoney(value: number | undefined) {
  if (value === undefined) return undefined;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function ComplianceCheckStatusTag({
  status,
}: {
  status: VendorComplianceCheck["status"];
}) {
  if (status === "met") {
    return (
      <StatusTag tone="success">
        <CheckCircle2 className="h-3 w-3" />
        Met
      </StatusTag>
    );
  }
  if (status === "expiring_soon") {
    return (
      <StatusTag tone="warning">
        <AlertCircle className="h-3 w-3" />
        Needs attention
      </StatusTag>
    );
  }
  return (
    <StatusTag tone="danger">
      <AlertCircle className="h-3 w-3" />
      Not met
    </StatusTag>
  );
}

function VendorComplianceChecklist({
  summary,
}: {
  summary: VendorComplianceSummary;
}) {
  if (summary.requirementCount === 0) {
    return (
      <div className={`border-t border-border px-4 py-4 text-muted-foreground ${typeStyle("body.default")}`}>
        No vendor requirements are configured yet.
      </div>
    );
  }
  return (
    <div className="border-t border-border">
      {summary.checks.map((check) => {
        const detectedLimit =
          check.matchedPolicy?.coverageLimit ??
          formatMoney(check.matchedPolicy?.detectedLimitAmount);
        return (
          <div
            key={check.requirement._id}
            className="grid gap-3 border-b border-border-subtle px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className={`truncate text-foreground ${typeStyle("body.medium")}`}>
                  {check.requirement.title}
                </p>
                <ComplianceCheckStatusTag status={check.status} />
              </div>
              <p className={`line-clamp-2 text-muted-foreground ${typeStyle("caption.default")}`}>
                {check.requirement.requirementText}
              </p>
              {check.requirement.limits?.length ? (
                <p className={`text-muted-foreground/75 ${typeStyle("caption.default")}`}>
                  Required limit:{" "}
                  <span className="text-foreground">
                    {check.requirement.limits
                      .map((limit) => limit.label ?? formatMoney(limit.amount) ?? limit.amount)
                      .join(" · ")}
                  </span>
                </p>
              ) : null}
            </div>
            <div className="min-w-0 rounded-md border border-border bg-background/40 px-3 py-2">
              {check.matchedPolicy ? (
                <div className={`space-y-1 text-muted-foreground ${typeStyle("caption.default")}`}>
                  <p className="truncate text-foreground">
                    {check.matchedPolicy.carrier ?? "Policy"}{" "}
                    {check.matchedPolicy.policyNumber ?? ""}
                  </p>
                  <p>
                    Coverage:{" "}
                    <span className="text-foreground">
                      {check.matchedPolicy.coverageName ?? "Matched coverage"}
                    </span>
                    {detectedLimit ? (
                      <>
                        {" "}
                        · Limit{" "}
                        <span className="text-foreground">{detectedLimit}</span>
                      </>
                    ) : null}
                  </p>
                  <p>
                    Expires:{" "}
                    <span className="text-foreground">
                      {formatDate(check.matchedPolicy.expirationDate)}
                    </span>
                  </p>
                  <p>
                    Insured:{" "}
                    <span className="text-foreground">
                      {check.matchedPolicy.insuredName ?? "Not detected"}
                    </span>
                    {check.matchedPolicy.expectedInsuredName ? (
                      <>
                        {" "}
                        · Expected{" "}
                        <span className="text-foreground">
                          {check.matchedPolicy.expectedInsuredName}
                        </span>
                      </>
                    ) : null}
                  </p>
                  {check.notes ? (
                    <p className="line-clamp-2 text-muted-foreground/75">
                      {check.notes}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className={`space-y-1 text-muted-foreground ${typeStyle("caption.default")}`}>
                  <p className="text-foreground">No matching policy found</p>
                  <p>{check.notes ?? "Upload a matching active policy."}</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RelationshipDrawer({
  row,
  side,
  onApprove,
  onResend,
  resending,
  onRevoke,
  onCancelInvitation,
  complianceSummary,
  onViewPolicies,
  onClose,
  canManage,
}: {
  row: ConnectedOrgRow;
  side: "vendor" | "client";
  onApprove?: (id: Id<"connectedOrgRelationships">) => void;
  onResend?: (row: ConnectedOrgRow) => void;
  resending: boolean;
  onRevoke: (id: Id<"connectedOrgRelationships">) => void;
  onCancelInvitation: (row: ConnectedOrgRow) => void;
  complianceSummary?: VendorComplianceSummary;
  onViewPolicies: (vendorOrgId: Id<"organizations">) => void;
  onClose: () => void;
  canManage: boolean;
}) {
  const org = side === "vendor" ? row.vendorOrg : row.clientOrg;
  const displayName = org?.name ?? row.vendorEmail ?? "Unknown organization";
  const relationshipId =
    row.kind === "invitation"
      ? row.relationshipId
      : (row._id as Id<"connectedOrgRelationships">);
  return (
    <SettingsDrawer
      open
      title={displayName}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      footer={
        row.status !== "revoked" ? (
          <>
            {side === "vendor" &&
            row.status === "active" &&
            row.vendorOrg?._id &&
            onViewPolicies ? (
              <PillButton
                size="compact"
                variant="secondary"
                onClick={() => onViewPolicies(row.vendorOrg!._id)}
              >
                <FileText className="h-3.5 w-3.5" />
                Policies
              </PillButton>
            ) : null}
            {canManage &&
            onResend &&
            (row.invitationId || row.kind === "invitation") &&
            (row.status === "pending" ||
              row.status === "expired" ||
              row.invitationStatus === "pending" ||
              row.invitationStatus === "expired") ? (
              <PillButton
                size="compact"
                variant="secondary"
                disabled={resending}
                onClick={() => onResend(row)}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${resending ? "animate-spin" : ""}`}
                />
                Resend
              </PillButton>
            ) : null}
            {canManage &&
            onApprove &&
            row.status === "pending" &&
            relationshipId ? (
              <PillButton
                size="compact"
                onClick={() => onApprove(relationshipId)}
              >
                <Check className="h-3.5 w-3.5" />
                Approve
              </PillButton>
            ) : null}
            {canManage && relationshipId ? (
              <PillButton
                size="compact"
                variant="destructive"
                onClick={() => onRevoke(relationshipId)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Revoke
              </PillButton>
            ) : null}

            {canManage &&
            row.kind === "invitation" &&
            !relationshipId ? (
              <PillButton
                variant="destructive"
                onClick={() => onCancelInvitation(row)}
              >
                Cancel invitation
              </PillButton>
            ) : null}
          </>
        ) : undefined
      }
    >
      <OperationalLabelValueList>
        <OperationalLabelValueRow
          label="Status"
          value={<RelationshipStatusTag status={row.status} />}
        />
        {row.vendorEmail ? (
          <OperationalLabelValueRow label="Contact" value={row.vendorEmail} />
        ) : null}
        {row.relationshipLabel ? (
          <OperationalLabelValueRow
            label="Relationship"
            value={row.relationshipLabel}
          />
        ) : null}
        {org?.website ? (
          <OperationalLabelValueRow label="Website" value={org.website} />
        ) : null}
        {row.note ? (
          <OperationalLabelValueRow label="Note" value={row.note} />
        ) : null}
      </OperationalLabelValueList>
      {complianceSummary ? (
        <VendorComplianceChecklist summary={complianceSummary} />
      ) : null}
    </SettingsDrawer>
  );
}

export function ConnectedOrgsSection({
  page = "vendors",
}: {
  page?: ConnectedOrgsPageKind;
}) {
  const router = useRouter();
  const currentOrg = useActiveOrgContext();
  const orgId = currentOrg?.orgId;
  const canManage =
    currentOrg?.role === "admin" && !currentOrg.isReadOnlyImpersonation;
  const vendorRows = useCachedQuery(
    "connectedOrgs.listVendors",
    connectedOrgsApi.connectedOrgs.listVendors,
    currentOrg?.orgId ? { orgId: currentOrg.orgId } : "skip",
  ) as ConnectedOrgRow[] | undefined;
  const clientRows = useCachedQuery(
    "connectedOrgs.listClients",
    connectedOrgsApi.connectedOrgs.listClients,
    currentOrg?.orgId ? { orgId: currentOrg.orgId } : "skip",
  ) as ConnectedOrgRow[] | undefined;
  const vendorCompliance = useCachedQuery(
    "compliance.listVendorCompliance",
    connectedOrgsApi.compliance.listVendorCompliance,
    currentOrg?.orgId ? { clientOrgId: currentOrg.orgId } : "skip",
  ) as VendorComplianceSummary[] | undefined;
  const updateVendorRows = useUpdateCachedQuery<
    ConnectedOrgRow[],
    { orgId: Id<"organizations"> }
  >("connectedOrgs.listVendors");
  const updateClientRows = useUpdateCachedQuery<
    ConnectedOrgRow[],
    { orgId: Id<"organizations"> }
  >("connectedOrgs.listClients");
  const requestVendorAccessByEmail = useAction(
    connectedOrgsApi.connectedOrgs.requestVendorAccessByEmail,
  );
  const resendVendorInvitation = useAction(
    connectedOrgsApi.connectedOrgs.resendVendorInvitation,
  );
  const approve = useMutation(connectedOrgsApi.connectedOrgs.approve);
  const revoke = useMutation(connectedOrgsApi.connectedOrgs.revoke);
  const revokeInvitation = useMutation(api.connectedOrgs.revokeInvitation);

  const [requestOpen, setRequestOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const closeDetails = useCallback(() => setSelectedId(null), []);
  const [vendorEmail, setVendorEmail] = useState("");
  const [relationshipLabel, setRelationshipLabel] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resendingInvitationId, setResendingInvitationId] = useState<
    string | null
  >(null);
  const { setActions, setRightPanel } = useSettingsActions();

  useEffect(() => {
    setActions(
      page === "vendors" && canManage ? (
        <PillButton size="compact" onClick={() => setRequestOpen(true)}>
          <Link2 className="h-3.5 w-3.5" />
          Add vendor
        </PillButton>
      ) : null,
    );
    return () => setActions(null);
  }, [page, setActions, canManage]);

  const approveRelationship = useCallback(
    async (id: Id<"connectedOrgRelationships">) => {
      try {
        await approve({ relationshipId: id });
        const updateRows =
          page === "vendors" ? updateVendorRows : updateClientRows;
        if (orgId) {
          await updateRows({ orgId: orgId }, (current) =>
            current.map((row) =>
              row.relationshipId === id || row._id === id
                ? {
                    ...row,
                    status: "active",
                    invitationStatus:
                      row.invitationStatus === "pending"
                        ? "accepted"
                        : row.invitationStatus,
                    updatedAt: dayjs().valueOf(),
                  }
                : row,
            ),
          );
        }
        toast.success("Connection approved");
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(error, "Could not approve connection"),
        );
      }
    },
    [approve, orgId, page, updateClientRows, updateVendorRows],
  );

  const revokeRelationship = useCallback(
    async (id: Id<"connectedOrgRelationships">) => {
      try {
        await revoke({ relationshipId: id });
        const updateRows =
          page === "vendors" ? updateVendorRows : updateClientRows;
        if (orgId) {
          await updateRows({ orgId: orgId }, (current) =>
            current.map((row) =>
              row.relationshipId === id || row._id === id
                ? {
                    ...row,
                    status: "revoked",
                    invitationStatus:
                      row.invitationStatus === "pending"
                        ? "revoked"
                        : row.invitationStatus,
                    updatedAt: dayjs().valueOf(),
                  }
                : row,
            ),
          );
        }
        toast.success("Connection revoked");
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(error, "Could not revoke connection"),
        );
      }
    },
    [revoke, orgId, page, updateClientRows, updateVendorRows],
  );

  const resendInvitation = useCallback(
    async (row: ConnectedOrgRow) => {
      const invitationId =
        row.invitationId ??
        (row.kind === "invitation"
          ? (row._id as Id<"connectedOrgInvitations">)
          : null);
      if (!invitationId) return;
      setResendingInvitationId(row._id);
      try {
        await resendVendorInvitation({
          invitationId,
        });
        toast.success("Vendor invite resent");
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(error, "Could not resend invite"),
        );
      } finally {
        setResendingInvitationId(null);
      }
    },
    [resendVendorInvitation],
  );

  const cancelInvitation = useCallback(
    async (row: ConnectedOrgRow) => {
      const invitationId =
        row.invitationId ?? (row._id as Id<"connectedOrgInvitations">);
      try {
        await revokeInvitation({ invitationId });
        toast.success("Invitation cancelled");
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(error, "Could not cancel invitation"),
        );
      }
    },
    [revokeInvitation],
  );
  const viewPolicies = useCallback(
    (vendorOrgId: Id<"organizations">) => {
      router.push(`/connect/vendors/${vendorOrgId}/policies`);
    },
    [router],
  );

  const rows = page === "vendors" ? vendorRows : clientRows;
  const complianceByRelationshipId = new Map(
    (vendorCompliance ?? []).map((summary) => [
      summary.relationshipId,
      summary,
    ]),
  );
  function relationshipIdForSummary(row: ConnectedOrgRow) {
    if (row.relationshipId) return row.relationshipId;
    if (row.kind === "relationship") {
      return row._id as Id<"connectedOrgRelationships">;
    }
    return null;
  }

  const selectedRow = rows?.find((row) => row._id === selectedId);
  const selectedRelationshipId = selectedRow
    ? relationshipIdForSummary(selectedRow)
    : null;
  const selectedSummary = selectedRelationshipId
    ? complianceByRelationshipId.get(selectedRelationshipId)
    : undefined;

  useEffect(() => {
    if (!requestOpen) {
      setRightPanel(
        selectedRow ? (
          <RelationshipDrawer
            row={selectedRow}
            side={page === "vendors" ? "vendor" : "client"}
            onApprove={page === "clients" ? approveRelationship : undefined}
            onResend={page === "vendors" ? resendInvitation : undefined}
            resending={resendingInvitationId === selectedRow._id}
            onRevoke={revokeRelationship}
            onCancelInvitation={cancelInvitation}
            complianceSummary={page === "vendors" ? selectedSummary : undefined}
            onViewPolicies={viewPolicies}
            onClose={closeDetails}
            canManage={canManage}
          />
        ) : null,
      );
      return () => setRightPanel(null);
    }
    async function handleSubmit(event?: FormEvent) {
      event?.preventDefault();
      if (!currentOrg?.orgId) return;
      setSubmitting(true);
      try {
        await requestVendorAccessByEmail({
          clientOrgId: currentOrg.orgId,
          vendorEmail: vendorEmail.trim(),
          relationshipLabel: relationshipLabel.trim() || undefined,
          note: note.trim() || undefined,
        });
        toast.success("Vendor access request sent");
        setVendorEmail("");
        setRelationshipLabel("");
        setNote("");
        setRequestOpen(false);
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(error, "Could not request vendor access"),
        );
      } finally {
        setSubmitting(false);
      }
    }

    setRightPanel(
      <SettingsDrawer
        open={requestOpen}
        onOpenChange={setRequestOpen}
        title="Add Vendor"
        footer={
          <>
            <PillButton
              variant="secondary"
              disabled={submitting}
              onClick={() => setRequestOpen(false)}
            >
              Cancel
            </PillButton>
            <PillButton
              disabled={submitting || !vendorEmail.trim()}
              onClick={() => void handleSubmit()}
            >
              {submitting ? "Requesting…" : "Request access"}
            </PillButton>
          </>
        }
      >
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            Enter a vendor contact email. If they already have an account, we’ll
            send the request to their org; otherwise we’ll send an invite link
            so they can create an account and approve access.
          </p>
          <label
            className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
          >
            Vendor email
            <Input
              value={vendorEmail}
              onChange={(e) => setVendorEmail(e.target.value)}
              placeholder="contact@example.com"
            />
          </label>
          <label
            className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
          >
            Relationship label
            <Input
              value={relationshipLabel}
              onChange={(e) => setRelationshipLabel(e.target.value)}
              placeholder="e.g. Required subcontractor coverage"
            />
          </label>
          <label
            className={`flex flex-col gap-1.5 text-muted-foreground ${typeStyle("label.field")}`}
          >
            Note
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              placeholder="What insurance information do you need to monitor?"
            />
          </label>
        </form>
      </SettingsDrawer>,
    );
    return () => setRightPanel(null);
  }, [
    currentOrg?.orgId,
    selectedRow,
    selectedSummary,
    page,
    approveRelationship,
    resendInvitation,
    resendingInvitationId,
    revokeRelationship,
    cancelInvitation,
    viewPolicies,
    closeDetails,
    canManage,
    note,
    relationshipLabel,
    requestOpen,
    requestVendorAccessByEmail,
    setRightPanel,
    submitting,
    vendorEmail,
  ]);

  if (
    rows === undefined ||
    (page === "vendors" && vendorCompliance === undefined)
  ) {
    return <div className="min-h-32" aria-hidden="true" />;
  }

  if (rows.length === 0) {
    return page === "vendors" ? (
      <EmptyStateCard
        title="No vendors yet"
        description="Request access from a vendor to monitor their insurance records against your standards."
        actionLabel={canManage ? "Add Vendor" : undefined}
        onAction={canManage ? () => setRequestOpen(true) : undefined}
      />
    ) : (
      <EmptyStateCard
        title="No clients yet"
        description="Clients you report insurance requirements to will appear here when they ask to monitor your records."
      />
    );
  }

  return (
    <OperationalPanel as="div">
      {rows.map((row) => {
        const org = page === "vendors" ? row.vendorOrg : row.clientOrg;
        const name = org?.name ?? row.vendorEmail ?? "Unknown organization";
        const summaryId = relationshipIdForSummary(row);
        return (
          <button
            key={row._id}
            type="button"
            onClick={() => {
              setRequestOpen(false);
              setSelectedId(row._id);
            }}
            className="flex w-full items-center justify-between gap-4 border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-emphasized"
          >
            <span className={`min-w-0 truncate ${typeStyle("body.medium")}`}>
              {name}
            </span>
            {page === "vendors" && row.status === "active" ? (
              <VendorStatusTag
                row={row}
                complianceSummary={
                  summaryId
                    ? complianceByRelationshipId.get(summaryId)
                    : undefined
                }
              />
            ) : (
              <RelationshipStatusTag status={row.status} />
            )}
          </button>
        );
      })}
    </OperationalPanel>
  );
}
