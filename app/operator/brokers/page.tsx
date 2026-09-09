"use client";

import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { TokenListField } from "@/components/broker-network/token-list-field";
import { OperatorSidebar } from "../operator-sidebar";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { Input } from "@/components/ui/input";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusTag } from "@/components/ui/status-tag";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDisplayDate } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

type NetworkStatus = "prospect" | "active" | "inactive" | "blacklisted";
type BrokerRow = NonNullable<FunctionReturnType<typeof api.brokerProfiles.get>>;

const ALL = "all";

const NETWORK_STATUS_LABELS: Record<NetworkStatus, string> = {
  prospect: "Prospect",
  active: "Active",
  inactive: "Inactive",
  blacklisted: "Blacklisted",
};

export default function OperatorBrokersPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<NetworkStatus | typeof ALL>(ALL);
  const [writingState, setWritingState] = useState("");
  const [line, setLine] = useState("");
  const [selectedId, setSelectedId] = useState<Id<"organizations"> | null>(
    null,
  );
  const [creating, setCreating] = useState(false);
  const rows = useQuery(api.brokerProfiles.list, {
    search: search.trim() || undefined,
    status: status === ALL ? undefined : status,
    writingState: writingState.trim() || undefined,
    lineOfBusinessCode: line.trim() || undefined,
  });
  const selected = useQuery(
    api.brokerProfiles.get,
    selectedId ? { brokerOrgId: selectedId } : "skip",
  );

  return (
    <AppShell
      actions={
        <PillButton
          size="compact"
          onClick={() => {
            setSelectedId(null);
            setCreating(true);
          }}
        >
          <Plus className="size-3.5" />
          Create broker
        </PillButton>
      }
      rightPanel={
        <BrokerDrawer
          key={selected?.broker._id ?? (creating ? "create" : "closed")}
          open={creating || !!selected}
          row={selected ?? null}
          onCreated={(brokerOrgId) => {
            setCreating(false);
            setSelectedId(brokerOrgId);
          }}
          onClose={() => {
            setCreating(false);
            setSelectedId(null);
          }}
        />
      }
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          active="brokers"
        />
      )}
      customSidebarStorageKey="operator-sidebar"
      disablePersistentChat
      disableCommandPalette
    >
      <div className="@container/brokers space-y-4">
        <div className="grid gap-3 @xl/brokers:grid-cols-2 @5xl/brokers:grid-cols-[minmax(16rem,1fr)_11rem_9rem_11rem]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search brokers"
              aria-label="Search brokers"
            />
          </div>
          <Select
            value={status}
            items={{ [ALL]: "All statuses", ...NETWORK_STATUS_LABELS }}
            onValueChange={(value) =>
              setStatus((value ?? ALL) as NetworkStatus | typeof ALL)
            }
          >
            <SelectTrigger aria-label="Filter by network status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {Object.entries(NETWORK_STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={writingState}
            onChange={(event) =>
              setWritingState(event.target.value.toUpperCase().slice(0, 2))
            }
            placeholder="State"
            aria-label="Writing state"
          />
          <Input
            value={line}
            onChange={(event) => setLine(event.target.value.toUpperCase())}
            placeholder="ACORD line"
            aria-label="ACORD line"
          />
        </div>
        <OperationalPanel>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40%] px-4">Broker</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>States</TableHead>
                <TableHead>Lines</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows === undefined ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32">
                    <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className={`h-32 px-4 text-muted-foreground ${typeStyle("body.default")}`}
                  >
                    No brokers match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow
                    key={row.broker._id}
                    className="cursor-pointer"
                    tabIndex={0}
                    onClick={() => {
                      setCreating(false);
                      setSelectedId(row.broker._id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setCreating(false);
                        setSelectedId(row.broker._id);
                      }
                    }}
                  >
                    <TableCell className="px-4">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <OrgBrandIcon
                          name={row.broker.name}
                          iconUrl={row.broker.iconUrl}
                          website={row.broker.website}
                          size="md"
                        />
                        <div className="min-w-0">
                          <p
                            className={`truncate text-foreground ${typeStyle("body.medium")}`}
                          >
                            {row.broker.name}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusTag
                        tone={
                          row.profile?.networkStatus === "active"
                            ? "success"
                            : row.profile?.networkStatus === "blacklisted"
                              ? "danger"
                              : row.profile?.networkStatus === "inactive"
                                ? "neutral"
                                : "warning"
                        }
                      >
                        {
                          NETWORK_STATUS_LABELS[
                            row.profile?.networkStatus ?? "prospect"
                          ]
                        }
                      </StatusTag>
                    </TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground">
                      {row.profile?.writingStates.join(", ") || "—"}
                    </TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground">
                      {row.profile?.lineOfBusinessCodes.join(", ") || "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </OperationalPanel>
      </div>
    </AppShell>
  );
}

function BrokerDrawer({
  open,
  row,
  onCreated,
  onClose,
}: {
  open: boolean;
  row: BrokerRow | null;
  onCreated: (brokerOrgId: Id<"organizations">) => void;
  onClose: () => void;
}) {
  const create = useMutation(api.brokerProfiles.createStandalone);
  const update = useMutation(api.brokerProfiles.upsert);
  const generateLogoUploadUrl = useMutation(
    api.brokerProfiles.generateLogoUploadUrl,
  );
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(row?.broker.name ?? "");
  const [website, setWebsite] = useState(row?.broker.website ?? "");
  const [status, setStatus] = useState<NetworkStatus>(
    row?.profile?.networkStatus ?? "prospect",
  );
  const [address, setAddress] = useState(
    row?.profile?.officeAddress?.street1 ?? "",
  );
  const [city, setCity] = useState(row?.profile?.officeAddress?.city ?? "");
  const [state, setState] = useState(row?.profile?.officeAddress?.state ?? "");
  const [postalCode, setPostalCode] = useState(
    row?.profile?.officeAddress?.postalCode ?? "",
  );
  const [states, setStates] = useState(row?.profile?.writingStates ?? []);
  const [lines, setLines] = useState(row?.profile?.lineOfBusinessCodes ?? []);
  const key = row?.broker._id ?? "create";

  const values = {
    name,
    website,
    status,
    address,
    city,
    state,
    postalCode,
    states,
    lines,
  };
  const savedValues = useRef(values);
  const autoSave = useLocalFirstAutoSave({
    mutationName: "brokerProfiles.upsert",
    args: values,
    enabled: !!row,
    canSave: !!name.trim(),
    flush: async (next) => {
      if (!row) return;
      const previous = savedValues.current;
      const officeChanged =
        next.address !== previous.address ||
        next.city !== previous.city ||
        next.state !== previous.state ||
        next.postalCode !== previous.postalCode;
      await update({
        brokerOrgId: row.broker._id,
        name: next.name !== previous.name ? next.name.trim() : undefined,
        website:
          next.website !== previous.website
            ? next.website.trim() || null
            : undefined,
        networkStatus:
          next.status !== previous.status ? next.status : undefined,
        officeAddress: officeChanged
          ? {
              street1:
                next.address !== previous.address
                  ? next.address.trim()
                  : undefined,
              city: next.city !== previous.city ? next.city.trim() : undefined,
              state:
                next.state !== previous.state ? next.state.trim() : undefined,
              postalCode:
                next.postalCode !== previous.postalCode
                  ? next.postalCode.trim()
                  : undefined,
            }
          : undefined,
        writingStates:
          next.states !== previous.states ? next.states : undefined,
        lineOfBusinessCodes:
          next.lines !== previous.lines ? next.lines : undefined,
      });
      savedValues.current = next;
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Could not save the broker"),
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (row) {
      await autoSave.saveNow();
      return;
    }
    setSaving(true);
    try {
      const { brokerOrgId } = await create({
        name: name.trim(),
        website: website.trim() || undefined,
        networkStatus: status,
        officeAddress: {
          street1: address,
          city,
          state,
          postalCode,
          country: "US",
        },
        writingStates: states,
        lineOfBusinessCodes: lines,
      });
      toast.success("Broker created");
      onCreated(brokerOrgId);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not create the broker"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    if (!row) return;
    setSaving(true);
    try {
      const uploadUrl = await generateLogoUploadUrl({
        brokerOrgId: row.broker._id,
      });
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) throw new Error("Upload failed");
      const { storageId } = (await response.json()) as {
        storageId: Id<"_storage">;
      };
      await update({
        brokerOrgId: row.broker._id,
        iconStorageId: storageId,
      });
      toast.success("Broker logo saved");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not save the broker logo"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsDrawer
      key={key}
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          if (!row) onClose();
          else
            void autoSave.saveNow().then((saved) => {
              if (saved) onClose();
            });
        }
      }}
      title={row?.broker.name ?? "Create broker"}
      actions={<AutoSaveStatus status={autoSave.status} />}
      footer={
        !row ? (
          <PillButton
            type="submit"
            form="broker-profile-form"
            disabled={saving || !name.trim()}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Create broker
          </PillButton>
        ) : undefined
      }
    >
      <form id="broker-profile-form" className="space-y-4" onSubmit={submit}>
        <Field label="Broker name">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Website">
          <Input
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />
        </Field>
        {row ? (
          <Field label="Logo">
            <div className="flex items-center gap-3">
              {row.broker.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={row.broker.iconUrl}
                  alt=""
                  className="size-10 rounded-md border border-input object-contain"
                />
              ) : null}
              <PillButton
                type="button"
                variant="secondary"
                disabled={saving}
                onClick={() =>
                  document
                    .getElementById(`operator-broker-logo-${row.broker._id}`)
                    ?.click()
                }
              >
                Upload logo
              </PillButton>
              <input
                id={`operator-broker-logo-${row.broker._id}`}
                className="hidden"
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadLogo(file);
                  event.currentTarget.value = "";
                }}
              />
            </div>
          </Field>
        ) : null}
        <Field label="Network status">
          <Select
            value={status}
            items={NETWORK_STATUS_LABELS}
            onValueChange={(value) =>
              setStatus((value ?? "prospect") as NetworkStatus)
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(NETWORK_STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Primary office">
          <Input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Street address"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City">
            <Input
              value={city}
              onChange={(event) => setCity(event.target.value)}
            />
          </Field>
          <Field label="State">
            <Input
              maxLength={2}
              value={state}
              onChange={(event) => setState(event.target.value.toUpperCase())}
            />
          </Field>
        </div>
        <Field label="Postal code">
          <Input
            value={postalCode}
            onChange={(event) => setPostalCode(event.target.value)}
          />
        </Field>
        <Field label="USPS writing states" help="Press Enter or comma to add.">
          <TokenListField
            value={states}
            onChange={setStates}
            placeholder="CA, NV, OR"
            ariaLabel="Add writing state"
          />
        </Field>
        <Field
          label="ACORD lines"
          help="Press Enter or comma to add exact LOBCd values."
        >
          <TokenListField
            value={lines}
            onChange={setLines}
            placeholder="CGL, PROP, UMBRC"
            ariaLabel="Add ACORD line"
          />
        </Field>
        {row &&
        (row.contacts.length > 0 ||
          (row.proposalCount ?? 0) > 0 ||
          row.lastOutreachAt) ? (
          <div
            className={`border-t border-border pt-4 text-muted-foreground ${typeStyle("body.default")}`}
          >
            {row.contacts.length > 0 ? (
              <p>{row.contacts.length} contacts</p>
            ) : null}
            {(row.proposalCount ?? 0) > 0 ? (
              <p>{row.proposalCount} proposals</p>
            ) : null}
            {row.lastOutreachAt ? (
              <p>Last outreach {formatDisplayDate(row.lastOutreachAt)}</p>
            ) : null}
          </div>
        ) : null}
      </form>
    </SettingsDrawer>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span
        className={`mb-1.5 block text-muted-foreground ${typeStyle("label.field")}`}
      >
        {label}
      </span>
      {children}
      {help ? (
        <span
          className={`mt-1 block text-muted-foreground ${typeStyle("caption.default")}`}
        >
          {help}
        </span>
      ) : null}
    </label>
  );
}
