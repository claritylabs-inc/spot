"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
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
} from "@claritylabs-inc/ui/components/status-tag";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableNameLink,
} from "@/components/ui/table";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  NETWORK_STATUS_LABELS,
  NETWORK_STATUS_PRESENTATION,
  type NetworkStatus,
} from "./broker-model";

export default function OperatorBrokersPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const rows = useQuery(api.brokerProfiles.list, {});
  const openBroker = (brokerOrgId: Id<"organizations">) =>
    router.push(`/operator/brokers/${brokerOrgId}`);

  return (
    <AppShell
      actions={
        <PillButton
          size="compact"
          onClick={() => setCreating(true)}
        >
          <Plus className="size-3.5" />
          Create provider
        </PillButton>
      }
      rightPanel={
        <CreateBrokerDrawer
          key={creating ? "open" : "closed"}
          open={creating}
          onCreated={openBroker}
          onClose={() => setCreating(false)}
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
                    onClick={() => openBroker(row.broker._id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openBroker(row.broker._id);
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
                        <TableNameLink
                          href={`/operator/brokers/${row.broker._id}`}
                          className="truncate"
                        >
                          {row.broker.name}
                        </TableNameLink>
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

function CreateBrokerDrawer({
  open,
  onCreated,
  onClose,
}: {
  open: boolean;
  onCreated: (brokerOrgId: Id<"organizations">) => void;
  onClose: () => void;
}) {
  const create = useMutation(api.brokerProfiles.createStandalone);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<NetworkStatus>("prospect");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const { brokerOrgId } = await create({
        name: name.trim(),
        website: website.trim() || undefined,
        networkStatus: status,
        writingStates: [],
        lineOfBusinessCodes: [],
      });
      toast.success("Provider created");
      onCreated(brokerOrgId);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not create the provider"),
      );
      setSaving(false);
    }
  }

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Create provider"
      footer={
        <PillButton
          type="submit"
          form="broker-create-form"
          disabled={saving || !name.trim()}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          Create provider
        </PillButton>
      }
    >
      <form id="broker-create-form" onSubmit={submit} className="space-y-4">
        <Field label="Provider name">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </Field>
        <Field label="Website">
          <Input
            value={website}
            placeholder="https://example.com"
            onChange={(event) => setWebsite(event.target.value)}
          />
        </Field>
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
              {Object.entries(NETWORK_STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  <StatusLabel
                    {...NETWORK_STATUS_PRESENTATION[value as NetworkStatus]}
                  >
                    {label}
                  </StatusLabel>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </form>
    </SettingsDrawer>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
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
    </label>
  );
}
