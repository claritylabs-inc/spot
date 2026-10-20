"use client";

import { normalizeWebsiteUrl } from "@claritylabs-inc/ui/lib/website";
import { WebsiteInput } from "@claritylabs-inc/ui/components/website-input";
import { useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
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
import { ClientStatusField, ClientWebsiteField } from "./client-row-fields";

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
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ClientFilter>("all");

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
  const stopOperatorImpersonation = useStopOperatorImpersonation(
    current?.activeImpersonation,
  );

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
      <PillButton
        size="compact"
        disabled={readOnly}
        // Keep focus in an open draft row so its blur does not submit it.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setCreating(true);
          document.getElementById(NEW_CLIENT_NAME_ID)?.focus();
        }}
      >
        <Plus className="size-3.5" />
        Create client
      </PillButton>
    </>
  );
  return (
    <AppShell actions={actions}>
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
        </div>
        <OperationalPanel data-operator-inline-fields>
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
              {creating ? (
                <NewClientRow onDone={() => setCreating(false)} />
              ) : null}
              {clients === undefined ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={5}
                    className="h-32 text-center text-muted-foreground"
                  >
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : filteredClients?.length === 0 &&
                filteredApplications.length === 0 &&
                !creating ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={5}
                    className={`h-32 px-4 text-muted-foreground ${typeStyle("body.default")}`}
                  >
                    {searchText || filter !== "all"
                      ? "No clients match this search."
                      : "No client accounts found."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredClients?.map((client) => (
                  <TableRow key={client._id}>
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

const NEW_CLIENT_NAME_ID = "new-client-name";

/** Draft table row that creates a client on Enter or when focus leaves it. */
function NewClientRow({ onDone }: { onDone: () => void }) {
  const createClient = useAction(api.operator.createSoloClient);
  const { seedClient } = useOperatorClientCacheActions();
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const row = useRef<HTMLTableRowElement>(null);

  async function submit() {
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) return onDone();
    setBusy(true);
    try {
      const result = await createClient({
        name: trimmed,
        website: normalizeWebsiteUrl(website) || website.trim() || undefined,
        users: [],
      });
      await seedClient({
        clientOrgId: result.clientOrgId,
        name: trimmed,
        website: normalizeWebsiteUrl(website) || website.trim() || undefined,
      });
      toast.success("Client created");
      onDone();
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Failed to create client"));
      setBusy(false);
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter") void submit();
    if (event.key === "Escape" && !busy) onDone();
  }

  return (
    <TableRow
      ref={row}
      className="hover:bg-transparent"
      onBlur={(event) => {
        if (!row.current?.contains(event.relatedTarget as Node | null))
          void submit();
      }}
    >
      <TableCell className="px-4">
        <Input
          id={NEW_CLIENT_NAME_ID}
          autoFocus
          aria-label="New client name"
          placeholder="Client name"
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </TableCell>
      <TableCell />
      <TableCell className="max-w-44">
        <WebsiteInput
          aria-label="New client website"
          value={website}
          disabled={busy}
          onChange={setWebsite}
          onKeyDown={onKeyDown}
        />
      </TableCell>
      <TableCell />
      <TableCell className="px-4 text-muted-foreground">
        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
      </TableCell>
    </TableRow>
  );
}
