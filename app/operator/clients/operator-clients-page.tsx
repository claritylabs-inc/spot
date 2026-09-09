"use client";

import { useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { StatusTag } from "@/components/ui/status-tag";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { Input } from "@/components/ui/input";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, LogOut, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { OperatorSidebar } from "../operator-sidebar";
import { getPublicAgentDomain } from "@/lib/domains";
import {
  useCachedOperatorClients,
  useCachedOperatorCurrent,
  useOperatorClientCacheActions,
} from "@/lib/sync/operator-cached-queries";
import { useStopOperatorImpersonation } from "@/hooks/use-stop-operator-impersonation";
import { useStartOperatorImpersonation } from "@/hooks/use-start-operator-impersonation";
import { formatDisplayDate } from "@/lib/date-format";
import {
  operatorClientStatusLabel,
  type OperatorClientRow,
} from "./client-model";
import { typeStyle } from "@/lib/typography";

const AGENT_DOMAIN = getPublicAgentDomain();

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className={`text-muted-foreground ${typeStyle("caption.medium")}`}>
        {label}
      </span>
      {children}
    </label>
  );
}

export default function OperatorClientsScreen() {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<Id<"organizations"> | null>(
    null,
  );
  const [panelMode, setPanelMode] = useState<"create" | "details" | null>(null);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);

  const current = useCachedOperatorCurrent();
  const clients = useCachedOperatorClients();
  const searchText = search.trim().toLowerCase();
  const filteredClients = clients?.filter((client) =>
    [
      client.name,
      client.website,
      client.primaryContactEmail,
      client.adminEmail,
    ].some((value) => value?.toLowerCase().includes(searchText)),
  );
  const { seedClient } = useOperatorClientCacheActions();
  const createClient = useAction(api.operator.createSoloClient);
  const { startImpersonation } = useStartOperatorImpersonation();
  const stopOperatorImpersonation = useStopOperatorImpersonation(
    current?.activeImpersonation,
  );

  const selected = useMemo(
    () => clients?.find((client) => client._id === selectedId) ?? null,
    [clients, selectedId],
  );
  const channelOverview = useQuery(
    api.agentChannels.getForOperator,
    selected && panelMode === "details"
      ? { clientOrgId: selected._id }
      : "skip",
  );

  async function submitClient(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await createClient({
        name,
        website: website || undefined,
        users: [],
      });
      await seedClient({
        clientOrgId: result.clientOrgId,
        name,
        website: website || undefined,
      });
      toast.success("Client created");
      router.push(`/operator/clients/${result.clientOrgId}`);
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Failed to create client"));
      setBusy(false);
    }
  }

  async function impersonate(client: OperatorClientRow) {
    setBusy(true);
    try {
      await startImpersonation({
        targetOrgId: client._id,
        targetRole: "admin",
        destination: "/policies",
        failureMessage: "Failed to impersonate client",
      });
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Failed to impersonate client"),
      );
    } finally {
      setBusy(false);
    }
  }

  function contactEmail(client: OperatorClientRow) {
    return client.primaryContactEmail ?? client.adminEmail;
  }

  function openDetails(client: OperatorClientRow) {
    setSelectedId(client._id);
    setPanelMode("details");
  }

  function openCreate() {
    setPanelMode("create");
  }

  const actions = (
    <>
      {current?.activeImpersonation ? (
        <PillButton
          variant="secondary"
          size="compact"
          label="Stop impersonating"
          expandLabel
          onClick={async () => {
            await stopOperatorImpersonation();
            toast.success("Impersonation stopped");
          }}
        >
          <LogOut className="size-3.5" />
        </PillButton>
      ) : null}
      <PillButton size="compact" onClick={openCreate}>
        <Plus className="size-3.5" />
        Create client
      </PillButton>
    </>
  );
  const enabledChannels = channelOverview
    ? [
        channelOverview.settings.emailEnabled ? "Email" : null,
        channelOverview.settings.imessageEnabled ? "iMessage" : null,
        channelOverview.settings.slackEnabled ? "Slack" : null,
      ]
        .filter(Boolean)
        .join(", ") || "None"
    : null;

  const rightPanel = (
    <SettingsDrawer
      open={panelMode !== null}
      onOpenChange={(open) => {
        if (!open) {
          setPanelMode(null);
          setSelectedId(null);
        }
      }}
      title={
        panelMode === "create" || !selected ? (
          "Create client"
        ) : (
          <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <span className="min-w-0 truncate">{selected.name}</span>
            <span className="flex shrink-0 items-center gap-2">
              <StatusTag
                tone={
                  selected.operatorStatus === "live" && !selected.inviteStatus
                    ? "success"
                    : "warning"
                }
              >
                {operatorClientStatusLabel(selected)}
              </StatusTag>
            </span>
          </span>
        )
      }
      footer={
        panelMode === "create" ? (
          <PillButton
            type="submit"
            form="operator-create-client-form"
            disabled={busy || !name.trim()}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Create client
          </PillButton>
        ) : selected ? (
          <>
            <PillButton
              variant="secondary"
              disabled={busy}
              onClick={() => void impersonate(selected)}
            >
              Impersonate
            </PillButton>
            <PillButton href={`/operator/clients/${selected._id}`}>
              Manage client
            </PillButton>
          </>
        ) : null
      }
    >
      {panelMode === "create" ? (
        <form
          id="operator-create-client-form"
          onSubmit={submitClient}
          className="space-y-3"
        >
          <Field label="Client name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Client organization"
              required
            />
          </Field>
          <Field label="Website">
            <Input
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              placeholder="https://example.com"
            />
          </Field>
        </form>
      ) : selected ? (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <OrgBrandIcon
              name={selected.name}
              iconUrl={selected.iconUrl}
              website={selected.website}
              size="lg"
            />
            <div className="min-w-0">
              <p
                className={`truncate text-foreground ${typeStyle("body.medium")}`}
              >
                {selected.primaryContactName ??
                  selected.adminName ??
                  "No primary contact"}
              </p>
              <p
                className={`truncate text-muted-foreground ${typeStyle("body.default")}`}
              >
                {contactEmail(selected) ?? "No contact email"}
              </p>
            </div>
          </div>

          <OperationalLabelValueList title="Client details">
            <OperationalLabelValueRow
              label="Website"
              value={selected.website ?? "Not set"}
            />
            <OperationalLabelValueRow
              label="Created"
              value={formatDisplayDate(selected.createdAt)}
            />
          </OperationalLabelValueList>

          <OperationalLabelValueList title="Agent channels">
            <OperationalLabelValueRow
              label="Active channels"
              value={
                enabledChannels ?? (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                )
              }
            />
            <OperationalLabelValueRow
              label="Email"
              value={
                channelOverview?.agentEmailAddress ? (
                  channelOverview.agentEmailAddress.handle ? (
                    `${channelOverview.agentEmailAddress.handle}@${AGENT_DOMAIN}`
                  ) : (
                    "Not configured"
                  )
                ) : (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                )
              }
            />
            <OperationalLabelValueRow
              label="Slack"
              value={
                channelOverview ? (
                  channelOverview.connection ? (
                    `${channelOverview.connection.teamName}${
                      channelOverview.joinedChannels.length > 0
                        ? ` · ${channelOverview.joinedChannels.length} joined ${channelOverview.joinedChannels.length === 1 ? "channel" : "channels"}`
                        : " · No joined channels"
                    }`
                  ) : (
                    "Not connected"
                  )
                ) : (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                )
              }
            />
          </OperationalLabelValueList>
        </div>
      ) : null}
    </SettingsDrawer>
  );

  return (
    <AppShell
      actions={actions}
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          active="clients"
        />
      )}
      customSidebarStorageKey="operator-sidebar"
      disablePersistentChat
      disableCommandPalette
      rightPanel={rightPanel}
    >
      <main className="flex w-full flex-col gap-4">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search clients"
            aria-label="Search clients"
          />
        </div>
        <OperationalPanel>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead
                  className={`w-[25%] px-4 text-muted-foreground ${typeStyle("label.table")}`}
                >
                  Client
                </TableHead>
                <TableHead
                  className={`w-[22%] text-muted-foreground ${typeStyle("label.table")}`}
                >
                  Admin
                </TableHead>
                <TableHead
                  className={`w-[18%] text-muted-foreground ${typeStyle("label.table")}`}
                >
                  Website
                </TableHead>
                <TableHead
                  className={`w-[10%] text-muted-foreground ${typeStyle("label.table")}`}
                >
                  Status
                </TableHead>
                <TableHead
                  className={`w-[8%] px-4 text-muted-foreground ${typeStyle("label.table")}`}
                >
                  Created
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients === undefined ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={5}
                    className="h-32 text-center text-muted-foreground"
                  >
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : filteredClients?.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={5}
                    className={`h-32 px-4 text-muted-foreground ${typeStyle("body.default")}`}
                  >
                    {searchText
                      ? "No clients match this search."
                      : "No client accounts found."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredClients?.map((client) => (
                  <TableRow
                    key={client._id}
                    tabIndex={0}
                    onClick={() => openDetails(client)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      openDetails(client);
                    }}
                    className={`cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                      selectedId === client._id ? "bg-muted/50" : ""
                    }`}
                  >
                    <TableCell className="px-4">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <OrgBrandIcon
                          name={client.name}
                          iconUrl={client.iconUrl}
                          website={client.website}
                          size="md"
                        />
                        <p
                          className={`truncate text-foreground ${typeStyle("body.medium")}`}
                        >
                          {client.name}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-muted-foreground">
                      {contactEmail(client) ?? "No admin"}
                    </TableCell>
                    <TableCell className="max-w-44 truncate text-muted-foreground">
                      {client.website ?? "Not set"}
                    </TableCell>
                    <TableCell>
                      <StatusTag
                        tone={
                          client.operatorStatus === "live" &&
                          !client.inviteStatus
                            ? "success"
                            : "warning"
                        }
                      >
                        {operatorClientStatusLabel(client)}
                      </StatusTag>
                    </TableCell>
                    <TableCell className="px-4 text-muted-foreground">
                      {formatDisplayDate(client.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </OperationalPanel>
      </main>
    </AppShell>
  );
}
