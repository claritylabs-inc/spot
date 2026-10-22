"use client";
import { brokerRegionCountry } from "@/convex/lib/brokerProfileValidation";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { Input } from "@claritylabs-inc/ui/components/input";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { typeStyle } from "@/lib/typography";
import { Checkbox } from "@claritylabs-inc/ui/components/checkbox";
import {
  BulkDeleteBar,
  useRowSelection,
} from "@/components/operator/bulk-delete";
import { OperationalPanel } from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import { StatusLabel } from "@claritylabs-inc/ui/components/status-tag";
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
  const [creating, setCreating] = useState(false);
  const rows = useQuery(api.brokerProfiles.list, {});
  const selection = useRowSelection(rows?.map((row) => row.broker._id) ?? []);

  return (
    <AppShell
      actions={
        <PillButton
          size="compact"
          // Keep focus in an open draft row so its blur does not submit it.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setCreating(true);
            document.getElementById(NEW_BROKER_NAME_ID)?.focus();
          }}
        >
          <Plus className="size-3.5" />
          Create provider
        </PillButton>
      }
    >
      <div className="@container/brokers space-y-4">
        <BulkDeleteBar
          type="broker"
          orgIds={selection.selectedIds}
          className="justify-end"
          onClear={selection.clear}
        />
        <OperationalPanel data-operator-inline-fields>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-11 pl-4 pr-0">
                  <Checkbox
                    aria-label="Select all providers"
                    checked={selection.allSelected}
                    indeterminate={selection.someSelected}
                    disabled={selection.visibleCount === 0}
                    onCheckedChange={selection.toggleAll}
                  />
                </TableHead>
                <TableHead className="w-[40%] px-4">Provider</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>States</TableHead>
                <TableHead>Lines</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {creating ? (
                <NewBrokerRow onDone={() => setCreating(false)} />
              ) : null}
              {rows === undefined ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32">
                    <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 && !creating ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className={`h-32 px-4 text-muted-foreground ${typeStyle("body.default")}`}
                  >
                    No insurance providers yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow
                    key={row.broker._id}
                    data-state={
                      selection.isSelected(row.broker._id)
                        ? "selected"
                        : undefined
                    }
                  >
                    <TableCell className="pl-4 pr-0">
                      <Checkbox
                        aria-label={`Select ${row.broker.name}`}
                        checked={selection.isSelected(row.broker._id)}
                        onCheckedChange={(checked) =>
                          selection.toggle(row.broker._id, checked)
                        }
                      />
                    </TableCell>
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
                      <BrokerStatusField
                        brokerOrgId={row.broker._id}
                        name={row.broker.name}
                        status={row.profile?.networkStatus ?? "prospect"}
                      />
                    </TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground">
                      {[...(row.profile?.nationwideCountries ?? []).map(code => `${code} nationwide`), ...(row.profile?.writingStates ?? []).filter(code => !(row.profile?.nationwideCountries ?? []).includes(brokerRegionCountry(code)))].join(", ") || "—"}
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

function NetworkStatusSelect({
  value,
  onChange,
  label,
  disabled,
  onOpenChange,
}: {
  value: NetworkStatus;
  onChange: (value: NetworkStatus) => void;
  label: string;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Select
      value={value}
      items={NETWORK_STATUS_LABELS}
      disabled={disabled}
      onOpenChange={onOpenChange}
      onValueChange={(next) => {
        if (next && next !== value && next in NETWORK_STATUS_LABELS)
          onChange(next as NetworkStatus);
      }}
    >
      <SelectTrigger className="w-full" aria-label={label}>
        <SelectValue>
          <StatusLabel {...NETWORK_STATUS_PRESENTATION[value]}>
            {NETWORK_STATUS_LABELS[value]}
          </StatusLabel>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.entries(NETWORK_STATUS_LABELS).map(([option, optionLabel]) => (
          <SelectItem key={option} value={option}>
            <StatusLabel
              {...NETWORK_STATUS_PRESENTATION[option as NetworkStatus]}
            >
              {optionLabel}
            </StatusLabel>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function BrokerStatusField({
  brokerOrgId,
  name,
  status,
}: {
  brokerOrgId: Id<"organizations">;
  name: string;
  status: NetworkStatus;
}) {
  const update = useMutation(api.brokerProfiles.upsert);
  return (
    <NetworkStatusSelect
      value={status}
      label={`Status for ${name}`}
      onChange={(networkStatus) =>
        void update({ brokerOrgId, networkStatus }).catch((error) =>
          toast.error(
            getUserFacingErrorMessage(error, "Could not save the status"),
          ),
        )
      }
    />
  );
}

const NEW_BROKER_NAME_ID = "new-broker-name";

/** Draft table row that creates a provider on Enter or when focus leaves it. */
function NewBrokerRow({ onDone }: { onDone: () => void }) {
  const create = useMutation(api.brokerProfiles.createStandalone);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<NetworkStatus>("prospect");
  const [busy, setBusy] = useState(false);
  const row = useRef<HTMLTableRowElement>(null);
  const selectOpen = useRef(false);

  async function submit() {
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) return onDone();
    setBusy(true);
    try {
      await create({
        name: trimmed,
        networkStatus: status,
        writingStates: [],
        lineOfBusinessCodes: [],
      });
      toast.success("Provider created");
      onDone();
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not create the provider"),
      );
      setBusy(false);
    }
  }

  return (
    <TableRow
      ref={row}
      className="hover:bg-transparent"
      onBlur={(event) => {
        if (
          !selectOpen.current &&
          !row.current?.contains(event.relatedTarget as Node | null)
        )
          void submit();
      }}
    >
      <TableCell className="px-4">
        <Input
          id={NEW_BROKER_NAME_ID}
          autoFocus
          aria-label="New provider name"
          placeholder="Provider name"
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
            if (event.key === "Escape" && !busy) onDone();
          }}
        />
      </TableCell>
      <TableCell>
        <NetworkStatusSelect
          value={status}
          label="New provider status"
          disabled={busy}
          onChange={setStatus}
          onOpenChange={(open) => {
            selectOpen.current = open;
          }}
        />
      </TableCell>
      <TableCell />
      <TableCell className="text-muted-foreground">
        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
      </TableCell>
    </TableRow>
  );
}
