"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DeleteOrganizationButton } from "@/components/operator/delete-organization-button";
import { AppShell } from "@/components/app-shell";
import { TokenListField } from "@/components/broker-network/token-list-field";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { FileDropZone } from "@claritylabs-inc/ui/components/file-drop";
import { AddressAutofillInput } from "@/components/ui/address-autofill-input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@claritylabs-inc/ui/components/tabs";
import { Input } from "@claritylabs-inc/ui/components/input";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { typeStyle } from "@/lib/typography";
import { OperationalPanel } from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import {
  StatusTag,
  StatusLabel,
  type StatusPresentation,
} from "@claritylabs-inc/ui/components/status-tag";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BrokerActivity } from "@/components/broker-network/broker-activity";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

type NetworkStatus = "prospect" | "active" | "inactive" | "blacklisted";
type BrokerRow = NonNullable<FunctionReturnType<typeof api.brokerProfiles.get>>;

const NETWORK_STATUS_LABELS: Record<NetworkStatus, string> = {
  prospect: "Prospect",
  active: "Active",
  inactive: "Inactive",
  blacklisted: "Restricted",
};

const NETWORK_STATUS_PRESENTATION: Record<NetworkStatus, StatusPresentation> = {
  prospect: { tone: "warning", indicator: "draft" },
  active: { tone: "success", indicator: "complete" },
  inactive: { tone: "neutral", indicator: "inactive" },
  blacklisted: { tone: "danger", indicator: "cancelled" },
};

export default function OperatorBrokersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("brokerId") as Id<"organizations"> | null;
  function setSelectedId(id: Id<"organizations"> | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (id) next.set("brokerId", id);
    else next.delete("brokerId");
    router.replace(
      `/operator/brokers${next.size ? `?${next.toString()}` : ""}`,
      { scroll: false },
    );
  }
  const [creating, setCreating] = useState(false);
  const rows = useQuery(api.brokerProfiles.list, {});
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
          Create provider
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
    >
      <div className="@container/brokers space-y-4">
        <OperationalPanel>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40%] px-4">Provider</TableHead>
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
                    No insurance providers yet.
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
                        {...NETWORK_STATUS_PRESENTATION[
                          row.profile?.networkStatus ?? "prospect"
                        ]}
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
  const [address2, setAddress2] = useState(
    row?.profile?.officeAddress?.street2 ?? "",
  );
  const [country, setCountry] = useState(
    row?.profile?.officeAddress?.country ?? "",
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
    address2,
    country,
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
        next.address2 !== previous.address2 ||
        next.country !== previous.country ||
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
              street2:
                next.address2 !== previous.address2
                  ? next.address2.trim()
                  : undefined,
              country:
                next.country !== previous.country
                  ? next.country.trim()
                  : undefined,
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
      getUserFacingErrorMessage(error, "Could not save the provider"),
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
          street2: address2,
          city,
          state,
          postalCode,
          country,
        },
        writingStates: states,
        lineOfBusinessCodes: lines,
      });
      toast.success("Provider created");
      onCreated(brokerOrgId);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not create the provider"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    if (!row) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      toast.error("Choose an image smaller than 5 MB");
      return;
    }
    setSaving(true);
    const notification = toast.loading("Uploading logo…");
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
      toast.success("Provider logo saved", { id: notification });
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not save the provider logo"),
        { id: notification },
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
      title={row?.broker.name ?? "Create provider"}
      actions={<AutoSaveStatus status={autoSave.status} />}
      footer={
        !row ? (
          <PillButton
            type="submit"
            form="broker-profile-form"
            disabled={saving || !name.trim()}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Create provider
          </PillButton>
        ) : (
          <DeleteOrganizationButton
            orgId={row.broker._id}
            name={row.broker.name}
            type="broker"
            disabled={saving}
            beforeDelete={autoSave.saveNow}
            onDeleted={onClose}
          />
        )
      }
    >
      <form id="broker-profile-form" onSubmit={submit}>
        <Tabs defaultValue="profile">
          <TabsList variant="pill" className="mb-4">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="appetite">Appetite</TabsTrigger>
            {row ? <TabsTrigger value="activity">Activity</TabsTrigger> : null}
          </TabsList>
          <TabsContent value="profile" className="space-y-4">
            <Field label="Provider name">
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
                <div className="space-y-2.5">
                  <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-muted/20 p-3">
                    <OrgBrandIcon
                      name={row.broker.name}
                      iconUrl={row.broker.iconUrl}
                      website={row.broker.website}
                      size="xl"
                      className="rounded-lg"
                    />
                    <div className="min-w-0">
                      <p className={typeStyle("body.medium")}>
                        {row.broker.name}
                      </p>
                      <p
                        className={`text-muted-foreground ${typeStyle("caption.default")}`}
                      >
                        {row.broker.iconUrl
                          ? "Current logo"
                          : "No logo uploaded yet"}
                      </p>
                    </div>
                  </div>
                  <FileDropZone
                    accept="image/*"
                    disabled={saving}
                    idleLabel="Upload a logo"
                    activeLabel="Drop logo to upload"
                    hint="PNG, JPG, or SVG · Max 5 MB"
                    padding="px-4 py-3"
                    className="min-h-24"
                    onFile={(file) => void uploadLogo(file)}
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
                  <SelectValue>
                    <StatusLabel {...NETWORK_STATUS_PRESENTATION[status]}>
                      {NETWORK_STATUS_LABELS[status]}
                    </StatusLabel>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(NETWORK_STATUS_LABELS).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        <StatusLabel
                          {...NETWORK_STATUS_PRESENTATION[
                            value as NetworkStatus
                          ]}
                        >
                          {label}
                        </StatusLabel>
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Primary office">
              <AddressAutofillInput
                id="broker-office-address"
                display="street1"
                value={{
                  street1: address,
                  street2: address2,
                  city,
                  state,
                  zip: postalCode,
                  country,
                }}
                onChange={(next) => {
                  setAddress(next.street1 ?? "");
                  setAddress2(next.street2 ?? "");
                  setCountry(next.country ?? "");
                  setCity(next.city ?? "");
                  setState(next.state ?? "");
                  setPostalCode(next.zip ?? "");
                }}
              />
            </Field>
            <Field label="Suite or unit">
              <Input
                value={address2}
                onChange={(event) => setAddress2(event.target.value)}
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
                  onChange={(event) =>
                    setState(event.target.value.toUpperCase())
                  }
                />
              </Field>
            </div>
            <Field label="Postal code">
              <Input
                value={postalCode}
                onChange={(event) => setPostalCode(event.target.value)}
              />
            </Field>
          </TabsContent>
          <TabsContent value="appetite" className="space-y-4">
            <Field label="States serviced" help="Press Enter or comma to add.">
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
          </TabsContent>
          {row ? (
            <TabsContent value="activity">
              <BrokerActivity brokerOrgId={row.broker._id} />
            </TabsContent>
          ) : null}
        </Tabs>
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
