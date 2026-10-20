"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import { OperationalPanel } from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { Input } from "@claritylabs-inc/ui/components/input";
import { Tabs, TabsList, TabsTrigger } from "@claritylabs-inc/ui/components/tabs";
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
import {
  useCachedOperatorClients,
  useCachedOperatorCurrent,
  useOperatorClientCacheActions,
} from "@/lib/sync/operator-cached-queries";
import { useStopOperatorImpersonation } from "@/hooks/use-stop-operator-impersonation";
import { formatDisplayDate } from "@/lib/date-format";
import {
  ONBOARDING_CLIENT_STATUS,
  operatorClientDisplayStatus,
  type OperatorClientRow,
} from "./client-model";
import { typeStyle } from "@/lib/typography";
import { Checkbox } from "@claritylabs-inc/ui/components/checkbox";
import {
  BulkDeleteBar,
  useRowSelection,
} from "@/components/operator/bulk-delete";
import { ClientStatusField, ClientWebsiteField } from "./client-row-fields";

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

function applicationName(application: {
  companyName?: string;
  applicantName?: string;
  applicantEmail?: string;
}) {
  return (
    application.companyName ??
    application.applicantName ??
    application.applicantEmail ??
    "Unnamed applicant"
  );
}

type ClientFilter = "all" | "active" | "limited" | "onboarding";

export default function OperatorClientsScreen() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ClientFilter>("all");
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);

  const current = useCachedOperatorCurrent();
  const readOnly = Boolean(current?.activeImpersonation);
  const clients = useCachedOperatorClients();
  const unlinkedApplications = useQuery(
    api.operator.listUnlinkedApplications,
  );
  const searchText = search.trim().toLowerCase();
  const matchesSearch = (values: (string | undefined)[]) =>
    values.some((value) => value?.toLowerCase().includes(searchText));
  const filteredClients = clients?.filter(
    (client) =>
      (filter === "all" || operatorClientDisplayStatus(client) === filter) &&
      matchesSearch([
        client.name,
        client.dba,
        client.website,
        client.primaryContactEmail,
        client.adminEmail,
      ]),
  );
  const selection = useRowSelection(
    filteredClients?.map((client) => client._id) ?? [],
  );
  // Applicants who have not named their company yet have no client record.
  const filteredApplications =
    filter === "all" || filter === "onboarding"
      ? (unlinkedApplications?.filter((application) =>
          matchesSearch([
            application.companyName,
            application.applicantName,
            application.applicantEmail,
          ]),
        ) ?? [])
      : [];
  const { seedClient } = useOperatorClientCacheActions();
  const createClient = useAction(api.operator.createSoloClient);
  const stopOperatorImpersonation = useStopOperatorImpersonation(
    current?.activeImpersonation,
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

  function contactEmail(client: OperatorClientRow) {
    return client.primaryContactEmail ?? client.adminEmail;
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
      <PillButton size="compact" onClick={() => setCreating(true)}>
        <Plus className="size-3.5" />
        Create client
      </PillButton>
    </>
  );
  const rightPanel = (
    <SettingsDrawer
      open={creating}
      onOpenChange={setCreating}
      title="Create client"
      footer={
        <PillButton
          type="submit"
          form="operator-create-client-form"
          disabled={busy || !name.trim()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Create client
        </PillButton>
      }
    >
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
    </SettingsDrawer>
  );

  return (
    <AppShell
      actions={actions}
      rightPanel={rightPanel}
    >
      <main className="flex w-full flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search clients"
              aria-label="Search clients"
            />
          </div>
          <Tabs
            value={filter}
            onValueChange={(value) => {
              if (value) setFilter(value as ClientFilter);
            }}
          >
            <TabsList variant="pill" aria-label="Client status">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="limited">Limited</TabsTrigger>
              <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
            </TabsList>
          </Tabs>
          <BulkDeleteBar
            type="client"
            selectedIds={selection.selectedIds}
            disabled={readOnly}
            onClear={selection.clear}
          />
        </div>
        <OperationalPanel data-operator-inline-fields>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10 pl-4 pr-0">
                  <Checkbox
                    aria-label="Select all clients"
                    checked={selection.allSelected}
                    indeterminate={selection.someSelected}
                    disabled={readOnly || !filteredClients?.length}
                    onCheckedChange={selection.toggleAll}
                  />
                </TableHead>
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
                    colSpan={6}
                    className="h-32 text-center text-muted-foreground"
                  >
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : filteredClients?.length === 0 &&
                filteredApplications.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={6}
                    className={`h-32 px-4 text-muted-foreground ${typeStyle("body.default")}`}
                  >
                    {searchText || filter !== "all"
                      ? "No clients match this search."
                      : "No client accounts found."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredClients?.map((client) => (
                  <TableRow
                    key={client._id}
                    data-state={
                      selection.isSelected(client._id) ? "selected" : undefined
                    }
                  >
                    <TableCell className="w-10 pl-4 pr-0">
                      <Checkbox
                        aria-label={`Select ${client.dba ?? client.name}`}
                        checked={selection.isSelected(client._id)}
                        disabled={readOnly}
                        onCheckedChange={(checked) =>
                          selection.toggle(client._id, checked)
                        }
                      />
                    </TableCell>
                    <TableCell className="px-4">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <OrgBrandIcon
                          name={client.dba ?? client.name}
                          iconUrl={client.iconUrl}
                          website={client.website}
                          size="md"
                        />
                        <TableNameLink
                          href={`/operator/clients/${client._id}`}
                          className="truncate"
                        >
                          {client.dba ?? client.name}
                        </TableNameLink>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-muted-foreground">
                      {contactEmail(client) ?? "No admin"}
                    </TableCell>
                    <TableCell className="max-w-44">
                      <ClientWebsiteField
                        client={client}
                        disabled={readOnly}
                      />
                    </TableCell>
                    <TableCell>
                      <ClientStatusField client={client} disabled={readOnly} />
                    </TableCell>
                    <TableCell className="px-4 text-muted-foreground">
                      {formatDisplayDate(client.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
              {clients === undefined
                ? null
                : filteredApplications.map((application) => (
                    <TableRow
                      key={application.requestId}
                      className="hover:bg-transparent"
                    >
                      <TableCell className="w-10 pl-4 pr-0" />
                      <TableCell className="px-4">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <OrgBrandIcon
                            name={applicationName(application)}
                            size="md"
                          />
                          <span className="truncate">
                            {applicationName(application)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-56 truncate text-muted-foreground">
                        {application.applicantEmail ?? "No email"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        Not set
                      </TableCell>
                      <TableCell>
                        <StatusTag
                          tone={ONBOARDING_CLIENT_STATUS.tone}
                          indicator={ONBOARDING_CLIENT_STATUS.indicator}
                        >
                          {ONBOARDING_CLIENT_STATUS.label}
                        </StatusTag>
                      </TableCell>
                      <TableCell className="px-4 text-muted-foreground">
                        {formatDisplayDate(application.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </OperationalPanel>
      </main>
    </AppShell>
  );
}
