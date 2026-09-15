"use client";

import { RequestCompletionOutcome } from "./request-completion-outcome";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { Copy, FileSearch, Loader2, PanelRightOpen, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  REQUEST_STATUS_OPTIONS,
  RequestStatusTag,
  procurementRequestStatusLabel,
  type ProcurementRequestStatus,
} from "@/components/procurement/procurement-shared";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { Input } from "@/components/ui/input";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableNameLink,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDisplayDate } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const NO_POLICY = "__none__";

type PolicyOption = {
  policyId: Id<"policies">;
  label: string;
  archived: boolean;
};

type ProcurementRequestRow = {
  _id: Id<"procurementRequests">;
  title: string;
  status: ProcurementRequestStatus;
  targetEffectiveDate?: string;
  forwardingAddress: string;
  replacingPolicy: { label: string } | null;
  completionOutcome?: React.ComponentProps<
    typeof RequestCompletionOutcome
  >["outcome"];
  resultingPolicy: { label: string } | null;
  brokerCount: number;
  quoteCount: number;
  outstandingFileCount: number;
  emailThreadCount: number;
  updatedAt: number;
};

function ProcurementRequestPreview({
  request,
  basePath,
  onClose,
}: {
  request: ProcurementRequestRow;
  basePath: string;
  onClose: () => void;
}) {
  async function copyAddress() {
    await navigator.clipboard.writeText(request.forwardingAddress);
    toast.success("Forwarding address copied");
  }

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={request.title}
      actions={<RequestStatusTag status={request.status} />}
      footer={
        <PillButton
          href={`${basePath}/${request._id}`}
          size="compact"
          className="w-full sm:w-auto"
        >
          <PanelRightOpen className="size-3.5" />
          Open full workspace
        </PillButton>
      }
    >
      <div className="space-y-5">
        <OperationalLabelValueList title="Current state">
          <RequestCompletionOutcome outcome={request.completionOutcome} />
          <OperationalLabelValueRow
            label="Target effective date"
            value={formatDisplayDate(request.targetEffectiveDate, "Not set")}
          />
          <OperationalLabelValueRow
            label="Replaces"
            value={request.replacingPolicy?.label ?? "No policy"}
          />
          <OperationalLabelValueRow
            label="Resulting policy"
            value={request.resultingPolicy?.label ?? "Not linked"}
          />
          <OperationalLabelValueRow
            label="Broker activity"
            value={`${request.brokerCount} ${request.brokerCount === 1 ? "broker" : "brokers"} · ${request.quoteCount} ${request.quoteCount === 1 ? "quote" : "quotes"}`}
          />
          <OperationalLabelValueRow
            label="Follow-up"
            value={`${request.outstandingFileCount} ${request.outstandingFileCount === 1 ? "file" : "files"} outstanding · ${request.emailThreadCount} email ${request.emailThreadCount === 1 ? "thread" : "threads"}`}
          />
          <OperationalLabelValueRow
            label="Updated"
            value={formatDisplayDate(request.updatedAt, "—")}
          />
        </OperationalLabelValueList>

        <OperationalLabelValueList title="Forwarding email">
          <OperationalLabelValueRow
            label="Address"
            layout="stacked"
            value={
              <span className="flex min-w-0 items-start gap-2">
                <span className="min-w-0 flex-1 break-all">
                  {request.forwardingAddress}
                </span>
                <PillButton
                  type="button"
                  variant="icon"
                  iconOnly
                  label={`Copy forwarding address for ${request.title}`}
                  onClick={() => void copyAddress()}
                >
                  <Copy className="size-3.5" />
                </PillButton>
              </span>
            }
          />
        </OperationalLabelValueList>
      </div>
    </SettingsDrawer>
  );
}

function NewProcurementRequestDrawer({
  clientOrgId,
  policies,
  onClose,
  onCreated,
}: {
  clientOrgId: Id<"organizations">;
  policies: PolicyOption[];
  onClose: () => void;
  onCreated: (requestId: Id<"procurementRequests">) => void;
}) {
  const createRequest = useMutation(api.procurementRequests.create);
  const [title, setTitle] = useState("");
  const [narrative, setNarrative] = useState("");
  const [targetEffectiveDate, setTargetEffectiveDate] = useState("");
  const [status, setStatus] = useState<ProcurementRequestStatus>("draft");
  const [replacingPolicyId, setReplacingPolicyId] = useState(NO_POLICY);
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!title.trim() || !narrative.trim()) {
      toast.error("Enter a title and shared request details");
      return;
    }
    setSaving(true);
    try {
      const result = await createRequest({
        clientOrgId,
        title,
        narrative,
        targetEffectiveDate: targetEffectiveDate || undefined,
        status,
        replacingPolicyId:
          replacingPolicyId === NO_POLICY
            ? undefined
            : (replacingPolicyId as Id<"policies">),
      });
      toast.success("Procurement request created");
      onCreated(result.requestId);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Failed to create procurement request",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
      title="New procurement request"
      footer={
        <>
          <PillButton type="button" variant="secondary" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton type="button" onClick={create} disabled={saving}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Create request
          </PillButton>
        </>
      }
    >
      <div className="space-y-5">
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Request title
          </span>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            placeholder="Property renewal replacement"
          />
        </label>
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Shared request details
          </span>
          <Textarea
            value={narrative}
            onChange={(event) => setNarrative(event.target.value)}
            className="min-h-32"
            maxLength={20_000}
            placeholder="The client’s goals, coverage needs, timing, and constraints."
          />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Target effective date
            </span>
            <Input
              type="date"
              value={targetEffectiveDate}
              onChange={(event) => setTargetEffectiveDate(event.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Status
            </span>
            <Select
              value={status}
              onValueChange={(value) =>
                setStatus(value as ProcurementRequestStatus)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {procurementRequestStatusLabel(status)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {REQUEST_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Policy being replaced
          </span>
          <SearchableSelect
            value={replacingPolicyId}
            onChange={setReplacingPolicyId}
            options={[
              { value: NO_POLICY, label: "No policy" },
              ...policies.map((policy) => ({
                value: policy.policyId,
                label: `${policy.label}${policy.archived ? " · Archived" : ""}`,
              })),
            ]}
          />
        </label>
      </div>
    </SettingsDrawer>
  );
}

export function ProcurementListWorkspace({
  clientOrgId,
  basePath,
  readOnly,
  onActions,
  onRightPanel,
}: {
  clientOrgId: Id<"organizations">;
  basePath: string;
  readOnly: boolean;
  onActions?: (node: ReactNode) => void;
  onRightPanel: (node: ReactNode) => void;
}) {
  const router = useRouter();
  const requestRows = useQuery(api.procurementRequests.list, {
    clientOrgId,
    limit: 100,
  });
  const policyRows = useQuery(api.procurementRequests.listPolicyOptions, {
    clientOrgId,
  });
  const requests = useMemo(
    () => (requestRows ?? []) as ProcurementRequestRow[],
    [requestRows],
  );
  const policies = useMemo(
    () => (policyRows ?? []) as PolicyOption[],
    [policyRows],
  );
  const [selectedRequestId, setSelectedRequestId] =
    useState<Id<"procurementRequests"> | null>(null);

  const closeRightPanel = useCallback(() => {
    setSelectedRequestId(null);
    onRightPanel(null);
  }, [onRightPanel]);
  const openNewRequest = useCallback(() => {
    setSelectedRequestId(null);
    onRightPanel(
      <NewProcurementRequestDrawer
        clientOrgId={clientOrgId}
        policies={policies}
        onClose={closeRightPanel}
        onCreated={(requestId) => {
          closeRightPanel();
          router.push(`${basePath}/${requestId}`);
        }}
      />,
    );
  }, [basePath, clientOrgId, closeRightPanel, onRightPanel, policies, router]);

  const openRequestPreview = useCallback(
    (request: ProcurementRequestRow) => {
      setSelectedRequestId(request._id);
      onRightPanel(
        <ProcurementRequestPreview
          request={request}
          basePath={basePath}
          onClose={closeRightPanel}
        />,
      );
    },
    [basePath, closeRightPanel, onRightPanel],
  );

  useEffect(() => {
    onActions?.(
      readOnly ? null : (
        <PillButton type="button" onClick={openNewRequest}>
          <Plus className="size-3.5" />
          New request
        </PillButton>
      ),
    );
    return () => onActions?.(null);
  }, [onActions, openNewRequest, readOnly]);

  if (requestRows === undefined || policyRows === undefined) {
    return (
      <OperationalPanel
        as="div"
        className="flex h-40 items-center justify-center"
      >
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </OperationalPanel>
    );
  }

  return requests.length === 0 ? (
    <EmptyStateCard
      title="No procurement requests yet"
      description="Create a request to centralize client requirements, broker outreach, documents, quotes, and forwarded email."
      icon={<FileSearch className="size-6" />}
    />
  ) : (
    <OperationalPanel as="div">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[52%]">Request</TableHead>
            <TableHead className="w-[18%]">Status</TableHead>
            <TableHead className="w-[18%]">Target date</TableHead>
            <TableHead className="w-[12%]">Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.map((request) => (
            <TableRow
              key={request._id}
              tabIndex={0}
              onClick={() => openRequestPreview(request)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                openRequestPreview(request);
              }}
              className={`cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                selectedRequestId === request._id ? "bg-muted/50" : ""
              }`}
            >
              <TableCell className="min-w-64 whitespace-normal">
                <TableNameLink
                  href={`${basePath}/${request._id}`}
                >
                  {request.title}
                </TableNameLink>
              </TableCell>
              <TableCell>
                <RequestStatusTag status={request.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDisplayDate(request.targetEffectiveDate, "Not set")}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDisplayDate(request.updatedAt, "\u2014")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </OperationalPanel>
  );
}
