"use client";

import { RequestEditor } from "./procurement-request-workspace";
import { PacketLinkDrawer } from "./packet-workspace";

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
  RequestStatusLabel,
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
  emailThreadCount: number;
  updatedAt: number;
};

function ProcurementRequestPreview({
  request,
  basePath,
  onClose,
  policies,
  readOnly,
}: {
  request: ProcurementRequestRow;
  basePath: string;
  onClose: () => void;
  policies: PolicyOption[];
  readOnly: boolean;
}) {
  const details = useQuery(api.procurementRequests.get, {
    requestId: request._id,
  });
  const currentRequest = details?.request ?? request;
  const links = useQuery(
    api.procurementPacket.listLinks,
    readOnly ? "skip" : { requestId: request._id },
  );
  const hasBrokerLink = links?.some(
    (link) => link.outreachId === null && link.state === "active",
  );
  const updateRequest = useMutation(api.procurementRequests.update);
  const [saving, setSaving] = useState(false);

  async function updateQuickField(patch: {
    status?: ProcurementRequestStatus;
    targetEffectiveDate?: string | null;
  }) {
    setSaving(true);
    try {
      await updateRequest({ requestId: request._id, ...patch });
      return true;
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not update the request"),
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  const [view, setView] = useState<"summary" | "edit" | "links">("summary");
  const back = () => setView("summary");

  if (view === "edit" && details && !readOnly) {
    return (
      <RequestEditor
        request={details.request}
        policies={policies}
        onClose={back}
      />
    );
  }
  if (view === "links" && !readOnly) {
    return (
      <PacketLinkDrawer
        requestId={request._id}
        onClose={back}
        beforeRegenerate={() => Promise.resolve(true)}
      />
    );
  }
  async function copyAddress() {
    await navigator.clipboard.writeText(currentRequest.forwardingAddress);
    toast.success("Forwarding address copied");
  }

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={currentRequest.title}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {!readOnly ? (
            <>
              <PillButton
                variant="secondary"
                disabled={!details}
                onClick={() => setView("edit")}
              >
                Edit request
              </PillButton>
              <PillButton
                variant="secondary"
                disabled={links === undefined}
                onClick={() => setView("links")}
              >
                {links === undefined
                  ? "Loading broker link…"
                  : hasBrokerLink
                    ? "View broker link"
                    : "Create broker link"}
              </PillButton>
            </>
          ) : null}
          <PillButton
            href={`${basePath}/${currentRequest._id}`}
            size="compact"
            className="w-full sm:w-auto"
          >
            <PanelRightOpen className="size-3.5" />
            Open full workspace
          </PillButton>
        </div>
      }
    >
      <div className="space-y-5">
        {!readOnly ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <span
                className={`text-muted-foreground ${typeStyle("label.field")}`}
              >
                Status
              </span>
              <Select
                value={currentRequest.status}
                disabled={saving}
                onValueChange={(value) => {
                  if (value !== currentRequest.status)
                    void updateQuickField({
                      status: value as ProcurementRequestStatus,
                    });
                }}
              >
                <SelectTrigger className="w-full" aria-label="Request status">
                  <SelectValue>
                    <RequestStatusLabel status={currentRequest.status} />
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {REQUEST_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <RequestStatusLabel status={option.value} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="block space-y-1.5">
              <span
                className={`text-muted-foreground ${typeStyle("label.field")}`}
              >
                Target effective date
              </span>
              <Input
                key={currentRequest.targetEffectiveDate ?? "unset"}
                type="date"
                aria-label="Target effective date"
                defaultValue={currentRequest.targetEffectiveDate ?? ""}
                disabled={saving}
                onBlur={async (event) => {
                  const input = event.currentTarget;
                  if (!input.validity.valid) return;
                  const value = input.value;
                  if (value === (currentRequest.targetEffectiveDate ?? ""))
                    return;
                  if (
                    !(await updateQuickField({
                      targetEffectiveDate: value || null,
                    }))
                  ) {
                    input.value = currentRequest.targetEffectiveDate ?? "";
                  }
                }}
              />
            </label>
          </div>
        ) : null}
        <OperationalLabelValueList>
          {readOnly ? (
            <>
              <OperationalLabelValueRow
                label="Status"
                value={<RequestStatusTag status={currentRequest.status} />}
              />
              <OperationalLabelValueRow
                label="Target effective date"
                value={formatDisplayDate(
                  currentRequest.targetEffectiveDate,
                  "Not set",
                )}
              />
            </>
          ) : null}
          <RequestCompletionOutcome
            outcome={currentRequest.completionOutcome}
          />
          {currentRequest.replacingPolicy ? (
            <OperationalLabelValueRow
              label="Replaces"
              value={currentRequest.replacingPolicy.label}
            />
          ) : null}
          {currentRequest.resultingPolicy ? (
            <OperationalLabelValueRow
              label="Resulting policy"
              value={currentRequest.resultingPolicy.label}
            />
          ) : null}
          <OperationalLabelValueRow
            label="Activity"
            value={`${currentRequest.brokerCount} ${currentRequest.brokerCount === 1 ? "broker" : "brokers"} · ${currentRequest.quoteCount} ${currentRequest.quoteCount === 1 ? "quote" : "quotes"} · ${currentRequest.emailThreadCount} email ${currentRequest.emailThreadCount === 1 ? "thread" : "threads"}`}
          />
          <OperationalLabelValueRow
            label="Updated"
            value={formatDisplayDate(currentRequest.updatedAt, "—")}
          />
        </OperationalLabelValueList>

        <OperationalLabelValueList title="Forwarding email">
          <OperationalLabelValueRow
            label="Address"
            layout="stacked"
            value={
              <span className="flex min-w-0 items-start gap-2">
                <span className="min-w-0 flex-1 break-all">
                  {currentRequest.forwardingAddress}
                </span>
                <PillButton
                  type="button"
                  variant="icon"
                  iconOnly
                  label={`Copy forwarding address for ${currentRequest.title}`}
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
                  <RequestStatusLabel status={status} />
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {REQUEST_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <RequestStatusLabel status={option.value} />
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
          key={request._id}
          request={request}
          policies={policies}
          readOnly={readOnly}
          basePath={basePath}
          onClose={closeRightPanel}
        />,
      );
    },
    [basePath, closeRightPanel, onRightPanel, policies, readOnly],
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
                <TableNameLink href={`${basePath}/${request._id}`}>
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
