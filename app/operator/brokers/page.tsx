"use client";
import {
  brokerAreaFit,
  brokerRegionCountry,
  brokerWritingCountries,
  BROKER_REGION_CODES,
  CANADIAN_PROVINCES,
  USPS_STATE_NAMES,
} from "@/convex/lib/brokerProfileValidation";
import {
  ACORD_LOB_LABELS,
  PROVIDER_ACORD_LOB_CODES,
} from "@/convex/lib/linesOfBusiness";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Globe, Loader2, MapPin, Plus, Shield } from "lucide-react";
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
import {
  StatusLabel,
  StatusTag,
} from "@claritylabs-inc/ui/components/status-tag";
import { CountryFlag } from "@/components/ui/country-flag";
import { RegionFlag } from "@/components/ui/region-flag";
import { ListToolbar } from "@/components/ui/list-toolbar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  SortableTableHead,
  TableRow,
  TableNameLink,
} from "@/components/ui/table";
import { useFollowedState } from "@/hooks/use-followed-state";
import { useTableSort } from "@/hooks/use-table-sort";
import type { FunctionReturnType } from "convex/server";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  NETWORK_STATUS_LABELS,
  NETWORK_STATUS_PRESENTATION,
  type NetworkStatus,
} from "./broker-model";

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
function countryOption(code: string) {
  const label = countryNames.of(code) ?? code;
  return { value: code, label, icon: <CountryFlag code={code} label={label} /> };
}
// US first: most providers write there.
const COUNTRY_ORDER = ["US", "CA"];
function countryRank(code: string) {
  const rank = COUNTRY_ORDER.indexOf(code);
  return rank === -1 ? COUNTRY_ORDER.length : rank;
}
const regionOptions = BROKER_REGION_CODES.map((value) => {
  const country = brokerRegionCountry(value);
  const name =
    USPS_STATE_NAMES[value] ??
    CANADIAN_PROVINCES[value as keyof typeof CANADIAN_PROVINCES];
  return {
    value,
    country,
    label: `${name} (${value})`,
    icon: <RegionFlag country={country} region={value} label={name} />,
  };
}).sort(
  (a, b) =>
    countryRank(a.country) - countryRank(b.country) ||
    a.label.localeCompare(b.label),
);
const lineOptions = PROVIDER_ACORD_LOB_CODES.map((value) => ({
  value,
  label: `${ACORD_LOB_LABELS[value]} (${value})`,
})).sort((a, b) => a.label.localeCompare(b.label));
const statusOptions = Object.entries(NETWORK_STATUS_LABELS).map(
  ([value, label]) => ({ value, label }),
);

type BrokerRow = FunctionReturnType<typeof api.brokerProfiles.list>[number];

function serviceArea(row: BrokerRow) {
  return [
    ...(row.profile?.nationwideCountries ?? []).map((code) => {
      const excluded = (row.profile?.excludedStates ?? []).filter(
        (region) => brokerRegionCountry(region) === code,
      );
      return `${code} nationwide${excluded.length ? ` except ${excluded.join(", ")}` : ""}`;
    }),
    ...(row.profile?.writingStates ?? []).filter(
      (code) =>
        !row.profile?.excludedStates?.includes(code) &&
        !(row.profile?.nationwideCountries ?? []).includes(
          brokerRegionCountry(code),
        ),
    ),
    ...(row.profile?.writingCountries ?? [])
      .filter(
        (code) =>
          code !== "CA" &&
          code !== "US" &&
          !row.profile?.nationwideCountries?.includes(code),
      )
      .map((code) => countryNames.of(code) ?? code),
  ].join(", ");
}

const STATUS_ORDER = Object.keys(NETWORK_STATUS_LABELS);
const NO_BROKERS: BrokerRow[] = [];
const BROKER_SORT_COLUMNS = {
  name: (row: BrokerRow) => row.broker.name,
  status: (row: BrokerRow) =>
    STATUS_ORDER.indexOf(row.profile?.networkStatus ?? "prospect"),
  area: serviceArea,
  lines: (row: BrokerRow) => row.profile?.lineOfBusinessCodes.join(", "),
};

export default function OperatorBrokersPage() {
  const [creating, setCreating] = useFollowedState("brokers:creating", false);
  const [countries, setCountries] = useFollowedState<string[]>(
    "brokers:countries",
    [],
  );
  const [regions, setRegions] = useFollowedState<string[]>(
    "brokers:regions",
    [],
  );
  const [lines, setLines] = useFollowedState<string[]>("brokers:lines", []);
  const [statuses, setStatuses] = useFollowedState<string[]>(
    "brokers:statuses",
    [],
  );
  const rows = useQuery(api.brokerProfiles.list, {});
  const countryOptions = useMemo(
    () =>
      [
        ...new Set([
          "US",
          "CA",
          ...(rows ?? []).flatMap((row) =>
            brokerWritingCountries(row.profile),
          ),
        ]),
      ]
        .map(countryOption)
        .sort(
          (a, b) =>
            countryRank(a.value) - countryRank(b.value) ||
            a.label.localeCompare(b.label),
        ),
    [rows],
  );
  const filteredRows = rows?.filter((row) => {
    const profile = row.profile;
    return (
      (statuses.length === 0 ||
        statuses.includes(profile?.networkStatus ?? "prospect")) &&
      (lines.length === 0 ||
        lines.some((line) => profile?.lineOfBusinessCodes.includes(line))) &&
      (countries.length === 0 ||
        countries.some((country) =>
          brokerWritingCountries(profile).includes(country),
        )) &&
      (regions.length === 0 ||
        (profile &&
          regions.some(
            (region) =>
              brokerAreaFit(profile, brokerRegionCountry(region), region) ===
              "match",
          )))
    );
  });
  const tableSort = useTableSort(
    "brokers:list",
    filteredRows ?? NO_BROKERS,
    BROKER_SORT_COLUMNS,
  );
  const selection = useRowSelection(
    "brokers:list:selected",
    filteredRows?.map((row) => row.broker._id) ?? [],
  );
  const hasFilters =
    countries.length > 0 ||
    regions.length > 0 ||
    lines.length > 0 ||
    statuses.length > 0;
  // Changing filters drops a selection the rows may no longer show.
  const filterSetter =
    (set: (value: string[]) => void) => (value: string[]) => {
      set(value);
      selection.clear();
    };

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
        <ListToolbar
          followKey="brokers:list"
          filters={[
            {
              id: "status",
              label: "Status",
              inline: true,
              multiple: true,
              options: statusOptions,
              value: statuses,
              onChange: filterSetter(setStatuses),
            },
            {
              id: "country",
              label: "Country",
              icon: <Globe />,
              multiple: true,
              options: countryOptions,
              value: countries,
              onChange: (next) => {
                filterSetter(setCountries)(next);
                // Keep only states and provinces in the chosen countries.
                if (next.length)
                  setRegions((current) =>
                    current.filter((region) =>
                      next.includes(brokerRegionCountry(region)),
                    ),
                  );
              },
            },
            {
              id: "region",
              label: "State",
              icon: <MapPin />,
              multiple: true,
              options: countries.length
                ? regionOptions.filter((option) =>
                    countries.includes(option.country),
                  )
                : regionOptions,
              value: regions,
              onChange: filterSetter(setRegions),
            },
            {
              id: "line",
              label: "Coverage line",
              icon: <Shield />,
              multiple: true,
              options: lineOptions,
              value: lines,
              onChange: filterSetter(setLines),
            },
          ]}
        />
        <BulkDeleteBar
          type="broker"
          orgIds={selection.selectedIds}
          className="justify-end"
          onClear={selection.clear}
        />
        <OperationalPanel data-operator-inline-fields>
          <Table storageKey="spot:brokers:list:columns" className="min-w-[800px] table-fixed">
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
                <SortableTableHead
                  className="w-[40%] px-4"
                  {...tableSort.head("name")}
                >
                  Provider
                </SortableTableHead>
                <SortableTableHead {...tableSort.head("status")}>
                  Status
                </SortableTableHead>
                <SortableTableHead {...tableSort.head("area")}>
                  Service area
                </SortableTableHead>
                <SortableTableHead {...tableSort.head("lines")}>
                  Lines
                </SortableTableHead>
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
              ) : filteredRows?.length === 0 && !creating ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className={`h-32 px-4 text-muted-foreground ${typeStyle("body.default")}`}
                  >
                    {hasFilters
                      ? "No providers match these filters."
                      : "No insurance providers yet."}
                  </TableCell>
                </TableRow>
              ) : (
                tableSort.rows.map((row) => (
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
                        {row.profile?.isTest ? (
                          <StatusTag tone="neutral">Test</StatusTag>
                        ) : null}
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
                      {serviceArea(row) || "—"}
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
      <SelectTrigger className="w-full pl-0" aria-label={label}>
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
      <TableCell />
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
