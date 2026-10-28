"use client";

import { PacketLinkDrawer } from "./packet-workspace";

import { RequestCompletionOutcome } from "./request-completion-outcome";
import { DeleteRequestsDialog } from "./delete-requests-dialog";
import { useForwardingCopy } from "@/components/inbox/forwarding-address";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import {
  Copy,
  FileSearch,
  Link,
  Loader2,
  PanelRightOpen,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import {
  REQUEST_STATUS_OPTIONS,
  RequestStatusTag,
  RequestStatusLabel,
  type ProcurementRequestStatus,
} from "@/components/procurement/procurement-shared";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import {
  SelectionDeleteBar,
  useRowSelection,
} from "@/components/operator/bulk-delete";
import {
  ListToolbar,
  type FilterDefinition,
} from "@/components/ui/list-toolbar";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { Checkbox } from "@claritylabs-inc/ui/components/checkbox";
import { EmptyStateCard } from "@claritylabs-inc/ui/components/empty-state-card";
import { DateField } from "@claritylabs-inc/ui/components/date-field";
import { Input } from "@claritylabs-inc/ui/components/input";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
} from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { SearchableSelect } from "@claritylabs-inc/ui/components/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
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
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import { useFollowedState } from "@/hooks/use-followed-state";
import { useLocalDraft } from "@/hooks/use-local-draft";
import { useTableSort } from "@/hooks/use-table-sort";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDisplayDate } from "@/lib/date-format";
import { coverageRequestLabel } from "@/lib/insurance-intake-details";
import { useCachedOperatorClients } from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const NO_POLICY = "__none__";
const NEW_REQUEST_PANEL = "new";
const CLOSED_STATUSES: readonly ProcurementRequestStatus[] = [
  "completed",
  "cancelled",
];

type PolicyOption = {
  policyId: Id<"policies">;
  label: string;
  archived: boolean;
};

type StatusFilter = "all" | "open" | "closed";

const STATUS_ORDER = new Map<string, number>(
  REQUEST_STATUS_OPTIONS.map((option, index) => [option.value, index]),
);
const REQUEST_SORT_COLUMNS = {
  title: (request: ProcurementRequestRow) => request.title,
  client: (request: ProcurementRequestRow) => request.client?.name,
  status: (request: ProcurementRequestRow) => STATUS_ORDER.get(request.status),
  targetDate: (request: ProcurementRequestRow) => request.targetEffectiveDate,
  updated: (request: ProcurementRequestRow) => request.updatedAt,
};

type ProcurementRequestRow = {
  _id: Id<"procurementRequests">;
  clientOrgId: Id<"organizations">;
  title: string;
  status: ProcurementRequestStatus;
  targetEffectiveDate?: string;
  replacingPolicy: { label: string } | null;
  completionOutcome?: React.ComponentProps<
    typeof RequestCompletionOutcome
  >["outcome"];
  resultingPolicy: { label: string } | null;
  updatedAt: number;
  /** Present on the all-clients list. */
  client?: { _id: Id<"organizations">; name: string };
};

const plural = (count: number, noun: string, many = `${noun}s`) =>
  `${count} ${count === 1 ? noun : many}`;

/**
 * Where the request stands across the workspace: applicant and coverage,
 * provider outreach and quotes, client emails, documents, mail and the
 * provider link. Every value comes from the request's existing reads.
 */
function RequestPreviewSummary({
  requestId,
  readOnly,
  children,
}: {
  requestId: Id<"procurementRequests">;
  readOnly: boolean;
  /** Rows shown first, in the same list. */
  children?: ReactNode;
}) {
  const details = useQuery(api.procurementRequests.get, { requestId });
  const providerPanel = useQuery(api.providerOutreach.getPanel, { requestId });
  const clientPanel = useQuery(api.clientOutreach.getPanel, { requestId });
  const links = useQuery(
    api.procurementPacket.listLinks,
    readOnly ? "skip" : { requestId },
  );
  if (!details) return null;
  const { request, outreaches, files, emailThreads, proposals } = details;
  const application = request.application;
  const answers = application?.answers ?? request.intakeAnswers;
  const coverages = (application?.details ?? request.intakeDetails)?.coverages;
  const applicant = [answers?.name, answers?.email]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" · ");

  const added = new Set(outreaches.map((outreach) => outreach.brokerOrgId));
  const moreMatched =
    providerPanel?.candidates.matched.filter(
      (candidate) => !added.has(candidate.brokerOrgId),
    ).length ?? 0;
  const live = (status: string) => status === "active" || status === "reply_check";
  const providerFollowUps =
    providerPanel?.sequences.filter((sequence) => live(sequence.status))
      .length ?? 0;
  const providers = [
    `${outreaches.length} added`,
    moreMatched ? `${moreMatched} more matched` : null,
    providerFollowUps ? `${providerFollowUps} following up` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const activeProposals = proposals.filter(
    (proposal) =>
      proposal.status !== "archived" && proposal.status !== "withdrawn",
  );
  const selected = activeProposals.some(
    (proposal) => proposal.status === "selected",
  );
  const clientEmails = clientPanel?.sequences ?? [];
  const clientFollowUps = clientEmails.filter((sequence) =>
    live(sequence.status),
  ).length;
  const sharedFiles = files.filter(
    (file) => file.brokerRelease === "attached" || file.brokerRelease === "listed",
  ).length;
  const providerLink = links?.find(
    (link) => link.outreachId === null && link.state === "active",
  );

  return (
    <OperationalLabelValueList>
      {children}
      {applicant ? (
        <OperationalLabelValueRow label="Applicant" value={applicant} />
      ) : null}
      <OperationalLabelValueRow
        label="Application"
        value={
          application
            ? `Submitted ${formatDisplayDate(application.submittedAt, "")}`.trim()
            : "Not submitted"
        }
      />
      {coverages?.length ? (
        <OperationalLabelValueRow
          label="Coverage"
          value={coverages.map((line) => coverageRequestLabel(line)).join(", ")}
        />
      ) : null}
      <OperationalLabelValueRow label="Providers" value={providers} />
      <OperationalLabelValueRow
        label="Proposals"
        value={
          activeProposals.length
            ? `${plural(activeProposals.length, "proposal")}${selected ? " · 1 selected" : ""}`
            : "None yet"
        }
      />
      {clientEmails.length ? (
        <OperationalLabelValueRow
          label="Client emails"
          value={`${plural(clientEmails.length, "email")} sent${clientFollowUps ? ` · ${clientFollowUps} following up` : ""}`}
        />
      ) : null}
      <OperationalLabelValueRow
        label="Documents"
        value={`${plural(files.length, "file")}${sharedFiles ? ` · ${sharedFiles} shared with providers` : ""}`}
      />
      <OperationalLabelValueRow
        label="Email"
        value={plural(emailThreads.length, "conversation")}
      />
      {links !== undefined ? (
        <OperationalLabelValueRow
          label="Provider link"
          value={providerLink ? "Active" : "Not created"}
        />
      ) : null}
      <OperationalLabelValueRow
        label="Updated"
        value={formatDisplayDate(request.updatedAt, "—")}
      />
    </OperationalLabelValueList>
  );
}

function ProcurementRequestPreview({
  request,
  basePath,
  onClose,
  readOnly,
}: {
  request: ProcurementRequestRow;
  basePath: string;
  onClose: () => void;
  readOnly: boolean;
}) {
  const router = useRouter();
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

  const [view, setView] = useFollowedState<"summary" | "links">(
    `procurement:${request._id}:preview-view`,
    "summary",
  );
  const back = () => setView("summary");
  const forward = useForwardingCopy(null, readOnly);

  if (view === "links" && !readOnly) {
    return (
      <PacketLinkDrawer
        requestId={request._id}
        onClose={back}
        beforeRegenerate={() => Promise.resolve(true)}
      />
    );
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
                onClick={() => {
                  onClose();
                  router.push(`${basePath}/${request._id}`);
                }}
              >
                Open request
              </PillButton>
              <PillButton
                variant="secondary"
                disabled={links === undefined}
                onClick={() => setView("links")}
              >
                {links === undefined
                  ? "Loading provider link…"
                  : hasBrokerLink
                    ? "View provider link"
                    : "Create provider link"}
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
            <DateField
              key={currentRequest.targetEffectiveDate ?? "unset"}
              id="preview-effective-date"
              label="Target effective date"
              value={currentRequest.targetEffectiveDate ?? ""}
              disabled={saving}
              onChange={(value) => {
                if (value === (currentRequest.targetEffectiveDate ?? "")) return;
                void updateQuickField({ targetEffectiveDate: value || null });
              }}
            />
          </div>
        ) : null}
        <RequestPreviewSummary requestId={request._id} readOnly={readOnly}>
          {request.client ? (
            <OperationalLabelValueRow
              label="Client"
              value={
                <TableNameLink href={`/operator/clients/${request.client._id}`}>
                  {request.client.name}
                </TableNameLink>
              }
            />
          ) : null}
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
        </RequestPreviewSummary>

        <OperationalLabelValueList title="Forwarding email">
          <OperationalLabelValueRow
            label="Forward to"
            layout="stacked"
            value={
              <span className="flex min-w-0 items-start gap-2">
                <span className="min-w-0 flex-1 break-all">
                  {forward.address ?? "Set your team address in Profile"}
                </span>
                <PillButton
                  type="button"
                  variant="icon"
                  iconOnly
                  disabled={forward.loading || forward.busy}
                  label="Copy your forwarding address"
                  onClick={() => void forward.copy()}
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
  const [draft, updateDraft, discardDraft] = useLocalDraft(
    `spot:new-procurement-request:${clientOrgId}`,
    {
      title: "",
      narrative: "",
      targetEffectiveDate: "",
      status: "draft" as ProcurementRequestStatus,
      replacingPolicyId: NO_POLICY,
    },
  );
  const { title, narrative, targetEffectiveDate, status, replacingPolicyId } =
    draft;
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
      discardDraft();
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
          <PillButton
            type="button"
            variant="secondary"
            onClick={() => {
              discardDraft();
              onClose();
            }}
          >
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
            onChange={(event) => updateDraft({ title: event.target.value })}
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
            onChange={(event) =>
              updateDraft({ narrative: event.target.value })
            }
            className="min-h-32"
            maxLength={20_000}
            placeholder="The client’s goals, coverage needs, timing, and constraints."
          />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DateField
            id="new-request-effective-date"
            label="Target effective date"
            value={targetEffectiveDate}
            onChange={(value) => updateDraft({ targetEffectiveDate: value })}
          />
          <label className="block space-y-1.5">
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Status
            </span>
            <Select
              value={status}
              onValueChange={(value) =>
                updateDraft({ status: value as ProcurementRequestStatus })
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
            onChange={(value) => updateDraft({ replacingPolicyId: value })}
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

/**
 * Procurement requests as a table with a preview drawer: one client's when
 * `clientOrgId` is set, otherwise every client's (with a Client column). Rows
 * can be checked for recoverable bulk deletion.
 */
export function ProcurementListWorkspace({
  clientOrgId,
  basePath: clientBasePath,
  readOnly,
  onActions,
  onRightPanel,
  notice,
}: {
  /** Page-level notice (such as read-only), shown under the view tabs. */
  notice?: ReactNode;
  /** Omit to list every client's requests. */
  clientOrgId?: Id<"organizations">;
  /** The client's procurement route; rows of the all-clients list use their own client's. */
  basePath?: string;
  readOnly: boolean;
  onActions?: (node: ReactNode) => void;
  onRightPanel: (node: ReactNode) => void;
}) {
  const router = useRouter();
  const allClients = !clientOrgId;
  const scopeKey = clientOrgId ?? "all";
  const clientRows = useQuery(
    api.procurementRequests.list,
    clientOrgId ? { clientOrgId, limit: 100 } : "skip",
  );
  const allRows = useQuery(
    api.procurementRequests.listAcrossClients,
    allClients ? { limit: 100 } : "skip",
  );
  const requestRows = allClients ? allRows?.requests : clientRows;
  const policyRows = useQuery(
    api.procurementRequests.listPolicyOptions,
    clientOrgId ? { clientOrgId } : "skip",
  );
  const cachedClients = useCachedOperatorClients();
  const clientBrand = useMemo(
    () => new Map((cachedClients ?? []).map((client) => [client._id, client])),
    [cachedClients],
  );
  const requests = useMemo(
    () => (requestRows ?? []) as ProcurementRequestRow[],
    [requestRows],
  );
  const policies = useMemo(
    () => (policyRows ?? []) as PolicyOption[],
    [policyRows],
  );
  const pathFor = useCallback(
    (request: Pick<ProcurementRequestRow, "clientOrgId">) =>
      clientBasePath ?? `/operator/clients/${request.clientOrgId}/procurement`,
    [clientBasePath],
  );
  const [panel, setPanel] = useFollowedState<string | null>(
    `procurement:${scopeKey}:list-panel`,
    null,
  );
  const [filter, setFilter] = useFollowedState<StatusFilter>(
    `procurement:${scopeKey}:list-filter`,
    "all",
  );
  const [search, setSearch] = useFollowedState(
    `procurement:${scopeKey}:list-search`,
    "",
  );
  const [statusFilter, setStatusFilter] = useFollowedState<string[]>(
    `procurement:${scopeKey}:list-status`,
    [],
  );
  const [clientFilter, setClientFilter] = useFollowedState<string[]>(
    `procurement:${scopeKey}:list-client`,
    [],
  );
  const [confirmDelete, setConfirmDelete] = useFollowedState(
    `procurement:${scopeKey}:confirm-delete`,
    false,
  );
  const selectedRequestId = panel === NEW_REQUEST_PANEL ? null : panel;
  const ensureShareUrl = useMutation(api.procurementPacket.ensureShareUrl);
  const [copyingLinkId, setCopyingLinkId] =
    useState<Id<"procurementRequests"> | null>(null);

  const searchText = search.trim().toLowerCase();
  const visibleRequests = requests.filter(
    (request) =>
      (filter === "all" ||
        CLOSED_STATUSES.includes(request.status) === (filter === "closed")) &&
      (statusFilter.length === 0 || statusFilter.includes(request.status)) &&
      (clientFilter.length === 0 || clientFilter.includes(request.clientOrgId)) &&
      (!searchText ||
        [request.title, request.client?.name].some((value) =>
          value?.toLowerCase().includes(searchText),
        )),
  );
  const tableSort = useTableSort(
    `procurement:${scopeKey}:list`,
    visibleRequests,
    REQUEST_SORT_COLUMNS,
  );
  const selection = useRowSelection<Id<"procurementRequests">>(
    `procurement:${scopeKey}:selected`,
    visibleRequests.map((request) => request._id),
  );
  const selectedRequests = visibleRequests.filter((request) =>
    selection.isSelected(request._id),
  );

  async function copyShareLink(request: ProcurementRequestRow) {
    setCopyingLinkId(request._id);
    try {
      const result = ensureShareUrl({ requestId: request._id });
      // Passing the pending URL keeps the click's clipboard permission in Safari.
      if (typeof ClipboardItem !== "undefined")
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": result.then(
              ({ url }) => new Blob([url], { type: "text/plain" }),
            ),
          }),
        ]);
      else await navigator.clipboard.writeText((await result).url);
      toast.success(
        (await result).created
          ? "Shareable link created and copied"
          : "Shareable link copied",
      );
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not copy the shareable link"),
      );
    } finally {
      setCopyingLinkId(null);
    }
  }

  const closeRightPanel = useCallback(() => setPanel(null), [setPanel]);
  const openNewRequest = useCallback(
    () => setPanel(NEW_REQUEST_PANEL),
    [setPanel],
  );
  const openRequestPreview = (request: ProcurementRequestRow) =>
    setPanel(request._id);

  const panelRequest = requests.find((request) => request._id === panel);
  // A preview whose request is gone closes for good rather than reopening if
  // the request returns.
  const panelRequestGone =
    panel !== null &&
    panel !== NEW_REQUEST_PANEL &&
    requestRows !== undefined &&
    !panelRequest;
  useEffect(() => {
    if (panelRequestGone) setPanel(null);
  }, [panelRequestGone, setPanel]);
  useEffect(() => {
    if (panel === NEW_REQUEST_PANEL && clientOrgId) {
      onRightPanel(
        <NewProcurementRequestDrawer
          clientOrgId={clientOrgId}
          policies={policies}
          onClose={closeRightPanel}
          onCreated={(requestId) => {
            closeRightPanel();
            router.push(`${pathFor({ clientOrgId })}/${requestId}`);
          }}
        />,
      );
    } else if (panelRequest) {
      onRightPanel(
        <ProcurementRequestPreview
          key={panelRequest._id}
          request={panelRequest}
          readOnly={readOnly}
          basePath={pathFor(panelRequest)}
          onClose={closeRightPanel}
        />,
      );
    } else {
      onRightPanel(null);
    }
  }, [
    clientOrgId,
    closeRightPanel,
    onRightPanel,
    panel,
    panelRequest,
    pathFor,
    policies,
    readOnly,
    router,
  ]);

  useEffect(() => {
    onActions?.(
      readOnly || !clientOrgId ? null : (
        <PillButton type="button" onClick={openNewRequest}>
          <Plus className="size-3.5" />
          New request
        </PillButton>
      ),
    );
    return () => onActions?.(null);
  }, [clientOrgId, onActions, openNewRequest, readOnly]);

  if (
    requestRows === undefined ||
    (clientOrgId !== undefined && policyRows === undefined)
  ) {
    return (
      <OperationalPanel
        as="div"
        className="flex h-40 items-center justify-center"
      >
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </OperationalPanel>
    );
  }

  if (requests.length === 0)
    return (
      <div className="space-y-4">
        {notice}
        <EmptyStateCard
          title="No procurement requests yet"
          description={
            allClients
              ? "Requests from every client show up here once they are created or submitted."
              : "Create a request to centralize client requirements, provider outreach, documents, quotes, and forwarded email."
          }
          icon={<FileSearch className="size-6" />}
        />
      </div>
    );

  const clientOptions = Array.from(
    new Map(
      requests.flatMap((request) =>
        request.client
          ? [[request.client._id, request.client.name] as const]
          : [],
      ),
    ),
    ([value, label]) => ({ value: value as string, label }),
  ).sort((left, right) => left.label.localeCompare(right.label));
  const filters: FilterDefinition[] = [
    {
      id: "state",
      label: "State",
      inline: true,
      value: filter === "all" ? [] : [filter],
      onChange: (value) => setFilter((value[0] ?? "all") as StatusFilter),
      options: [
        { value: "open", label: "Open" },
        { value: "closed", label: "Closed" },
      ],
    },
    ...(allClients
      ? [
          {
            id: "client",
            label: "Client",
            inline: true,
            multiple: true,
            value: clientFilter,
            onChange: (value: string[]) => {
              setClientFilter(value);
              selection.clear();
            },
            options: clientOptions,
          },
        ]
      : []),
    {
      id: "status",
      label: "Status",
      multiple: true,
      value: statusFilter,
      onChange: (value) => {
        setStatusFilter(value);
        selection.clear();
      },
      options: REQUEST_STATUS_OPTIONS.map(({ value, label }) => ({
        value,
        label,
      })),
    },
  ];

  const columns = 4 + (allClients ? 1 : 0) + (readOnly ? 0 : 2);
  return (
    <div className="flex flex-col gap-4">
      <ListToolbar
        followKey={`procurement:${scopeKey}:list`}
        filters={filters}
        search={{
          value: search,
          onChange: setSearch,
          label: "Search requests",
          placeholder: "Search requests",
        }}
        actions={
          readOnly ? null : (
            <SelectionDeleteBar
              count={selectedRequests.length}
              onClear={selection.clear}
              onDelete={() => setConfirmDelete(true)}
            />
          )
        }
      />
      {notice}
      <OperationalPanel as="div">
        <Table storageKey="spot:procurement:list:columns">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {!readOnly && (
                <TableHead className="w-11 pr-0 pl-4">
                  <Checkbox
                    data-collab-ignore
                    aria-label="Select all requests"
                    checked={selection.allSelected}
                    indeterminate={selection.someSelected}
                    disabled={selection.visibleCount === 0}
                    onCheckedChange={selection.toggleAll}
                  />
                </TableHead>
              )}
              <SortableTableHead
                className={allClients ? "w-[34%]" : "w-[52%]"}
                {...tableSort.head("title")}
              >
                Request
              </SortableTableHead>
              {allClients && (
                <SortableTableHead
                  className="w-[24%]"
                  {...tableSort.head("client")}
                >
                  Client
                </SortableTableHead>
              )}
              <SortableTableHead
                className="w-[16%]"
                {...tableSort.head("status")}
              >
                Status
              </SortableTableHead>
              <SortableTableHead
                className="w-[14%]"
                {...tableSort.head("targetDate")}
              >
                Target date
              </SortableTableHead>
              <SortableTableHead
                className="w-[12%]"
                {...tableSort.head("updated")}
              >
                Updated
              </SortableTableHead>
              {!readOnly && (
                <TableHead className="w-0">
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRequests.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={columns}
                  className={`h-24 px-4 text-muted-foreground ${typeStyle("body.default")}`}
                >
                  No requests match these filters.
                </TableCell>
              </TableRow>
            ) : null}
            {tableSort.rows.map((request) => {
              const brand = request.client
                ? clientBrand.get(request.client._id)
                : undefined;
              return (
                <TableRow
                  key={request._id}
                  tabIndex={0}
                  data-state={
                    selection.isSelected(request._id) ? "selected" : undefined
                  }
                  onClick={() => openRequestPreview(request)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    openRequestPreview(request);
                  }}
                  className={`cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                    selectedRequestId === request._id ? "bg-muted/50" : ""
                  }`}
                >
                  {!readOnly && (
                    <TableCell
                      className="pr-0 pl-4"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Checkbox
                        data-collab-ignore
                        aria-label={`Select ${request.title}`}
                        checked={selection.isSelected(request._id)}
                        onCheckedChange={(checked) =>
                          selection.toggle(request._id, checked)
                        }
                      />
                    </TableCell>
                  )}
                  <TableCell className="min-w-64 whitespace-normal">
                    <TableNameLink href={`${pathFor(request)}/${request._id}`}>
                      {request.title}
                    </TableNameLink>
                  </TableCell>
                  {allClients && (
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      {request.client ? (
                        <div className="flex min-w-0 items-center gap-2.5">
                          <OrgBrandIcon
                            name={request.client.name}
                            iconUrl={brand?.iconUrl}
                            website={brand?.website}
                            size="md"
                          />
                          <TableNameLink
                            href={`/operator/clients/${request.client._id}`}
                            className="truncate"
                          >
                            {request.client.name}
                          </TableNameLink>
                        </div>
                      ) : null}
                    </TableCell>
                  )}
                  <TableCell>
                    <RequestStatusTag status={request.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDisplayDate(request.targetEffectiveDate, "Not set")}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDisplayDate(request.updatedAt, "—")}
                  </TableCell>
                  {!readOnly && (
                    <TableCell
                      className="text-right"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <PillButton
                        type="button"
                        variant="icon"
                        iconOnly
                        label={`Copy shareable link for ${request.title}`}
                        disabled={copyingLinkId === request._id}
                        onClick={() => void copyShareLink(request)}
                      >
                        {copyingLinkId === request._id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Link className="size-3.5" />
                        )}
                      </PillButton>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </OperationalPanel>
      {allClients && allRows?.bounded ? (
        <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
          Showing the most recently updated requests. Open a client’s
          Procurement page for its full list.
        </p>
      ) : null}
      {!readOnly ? (
        <DeleteRequestsDialog
          requests={selectedRequests}
          open={confirmDelete && selectedRequests.length > 0}
          onOpenChange={setConfirmDelete}
          onDeleted={() => selection.clear()}
        />
      ) : null}
    </div>
  );
}
