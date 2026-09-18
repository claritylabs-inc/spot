"use client";

import { useMemo, useRef, useState } from "react";
import { useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DeleteOrganizationButton } from "@/components/operator/delete-organization-button";
import { AppShell } from "@/components/app-shell";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { StatusTag } from "@/components/ui/status-tag";
import { OperationalPanel } from "@/components/ui/operational-panel";
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
  TableNameLink,
} from "@/components/ui/table";
import { Loader2, LogOut, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { OperatorSidebar } from "../operator-sidebar";
import {
  ClientDetailsEditor,
  type ClientEditorHandle,
} from "./client-details-editor";
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
  operatorClientStatusPresentation,
  type OperatorClientRow,
} from "./client-model";
import { typeStyle } from "@/lib/typography";

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
  const editor = useRef<ClientEditorHandle>(null);

  async function saveDetails() {
    return (
      panelMode !== "details" ||
      !editor.current ||
      (await editor.current.saveNow())
    );
  }

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
    if (!(await saveDetails())) return;
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

  async function openDetails(client: OperatorClientRow) {
    if (!(await saveDetails())) return;
    setSelectedId(client._id);
    setPanelMode("details");
  }

  async function openCreate() {
    if (!(await saveDetails())) return;
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
  const rightPanel = (
    <SettingsDrawer
      open={panelMode !== null}
      onOpenChange={async (open) => {
        if (!open && (await saveDetails())) {
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
                {...operatorClientStatusPresentation(selected)}
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
            <DeleteOrganizationButton
              orgId={selected._id}
              name={selected.name}
              type="client"
              disabled={busy || Boolean(current?.activeImpersonation)}
              beforeDelete={saveDetails}
              onDeleted={() => {
                setPanelMode(null);
                setSelectedId(null);
              }}
            />
            <PillButton
              variant="secondary"
              disabled={busy}
              onClick={() => void impersonate(selected)}
            >
              Impersonate
            </PillButton>
            <PillButton
              onClick={async () => {
                if (await saveDetails())
                  router.push(`/operator/clients/${selected._id}`);
              }}
            >
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
        <ClientDetailsEditor
          key={selected._id}
          ref={editor}
          client={selected}
          disabled={Boolean(current?.activeImpersonation)}
        />
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
                          size="md"
                        />
                        <TableNameLink
                          href={`/operator/clients/${client._id}`}
                          className="truncate"
                        >
                          {client.name}
                        </TableNameLink>
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
