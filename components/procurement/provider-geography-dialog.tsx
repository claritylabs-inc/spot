"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { countryOptions } from "@/components/insurance-intake/driver-jurisdiction";
import { InlineFieldCard, InlineFieldRow } from "@/components/ui/inline-fields";
import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  brokerRegionCountry,
  CANADIAN_PROVINCES,
  USPS_STATE_NAMES,
} from "@/convex/lib/brokerProfileValidation";
import { procurementBrokerCriteria } from "@/convex/lib/procurementBrokerMatching";
import {
  normalizeCountry,
  normalizeRegion,
} from "@/convex/lib/providerOutreachMatch";
import {
  addressText,
  coverageRequestLabel,
  type IntakeAddress,
  type IntakeDetails,
} from "@/lib/insurance-intake-details";
import type { IntakeApplication } from "@/lib/intake-application";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@claritylabs-inc/ui/components/dialog";
import { SearchableSelect } from "@claritylabs-inc/ui/components/searchable-select";

/** The request fields `updateApplication` rewrites alongside the application. */
export type ProviderGeographyRequest = {
  _id: Id<"procurementRequests">;
  title: string;
  targetEffectiveDate?: string;
  status: Doc<"procurementRequests">["status"];
  replacingPolicyId?: Id<"policies">;
  resultingPolicyId?: Id<"policies">;
  clientVisible?: boolean;
  intakeRevision?: number;
  updatedAt: number;
  application?: IntakeApplication | null;
};

type AddressPath =
  | { kind: "location"; index: number }
  | { kind: "mailing" }
  | { kind: "property"; coverage: number; property: number };

type Row = {
  key: string;
  path: AddressPath;
  label: string;
  address: IntakeAddress;
};
type Edit = { country: string; state: string };

const SELECTABLE_COUNTRIES = countryOptions.filter((option) =>
  normalizeCountry(option.value),
);

/** The addresses the matcher reads: locations (else mailing), then property addresses. */
function requestAddresses(details: IntakeDetails): Row[] {
  const named = (label: string, name?: string) =>
    name?.trim() ? `${label} · ${name.trim()}` : label;
  const rows: Row[] = details.locations.length
    ? details.locations.map((location, index) => ({
        key: `location:${index}`,
        path: { kind: "location", index },
        label: named(`Operating location ${index + 1}`, location.name),
        address: location.address,
      }))
    : [
        {
          key: "mailing",
          path: { kind: "mailing" },
          label: "Mailing address",
          address: details.mailingAddress,
        },
      ];
  details.coverages.forEach((line, coverage) =>
    (line.properties ?? []).forEach((property, index) =>
      rows.push({
        key: `property:${coverage}:${index}`,
        path: { kind: "property", coverage, property: index },
        label: named(
          `${coverageRequestLabel(line)} · Location ${index + 1}`,
          property.name,
        ),
        address: property.address,
      }),
    ),
  );
  return rows;
}

/** Same rule as the matcher: a country, plus a region of that country for US and Canada. */
function addressProblems(address: { country?: string; state?: string }) {
  const country = normalizeCountry(address.country);
  const problem = (value?: string) =>
    value?.trim() ? "unrecognized" : "missing";
  if (!country) return { country: problem(address.country) };
  if (country !== "US" && country !== "CA") return {};
  const region = normalizeRegion(address.state);
  return region && brokerRegionCountry(region) === country
    ? {}
    : { state: problem(address.state) };
}

const geographyRows = (details: IntakeDetails) =>
  requestAddresses(details).filter(
    (row) => Object.keys(addressProblems(row.address)).length,
  );

/**
 * Whether auto add can run. Geography is only the blocker when the shared
 * criteria reject the application and an address is at fault; any other
 * failure (no saved application, no supported coverage) is left to the server,
 * whose message the operator already sees.
 */
export function providerGeographyPreflight(
  application: IntakeApplication | null | undefined,
) {
  if (!application) return { ready: true };
  try {
    procurementBrokerCriteria(application);
    return { ready: true };
  } catch {
    return { ready: !geographyRows(application.details).length };
  }
}

function patchAddress(
  details: IntakeDetails,
  path: AddressPath,
  patch: Partial<IntakeAddress>,
): IntakeDetails {
  const apply = (address: IntakeAddress) => ({ ...address, ...patch });
  if (path.kind === "mailing")
    return { ...details, mailingAddress: apply(details.mailingAddress) };
  if (path.kind === "location")
    return {
      ...details,
      locations: details.locations.map((location, index) =>
        index === path.index
          ? { ...location, address: apply(location.address) }
          : location,
      ),
    };
  return {
    ...details,
    coverages: details.coverages.map((line, coverage) =>
      coverage === path.coverage
        ? {
            ...line,
            properties: (line.properties ?? []).map((property, index) =>
              index === path.property
                ? { ...property, address: apply(property.address) }
                : property,
            ),
          }
        : line,
    ),
  };
}

const regionNames = (country: string | undefined) =>
  country === "US"
    ? USPS_STATE_NAMES
    : country === "CA"
      ? CANADIAN_PROVINCES
      : null;

type Snapshot = {
  request: ProviderGeographyRequest;
  application: IntakeApplication;
  rows: Row[];
  edits: Record<string, Edit>;
};

/** Edits carry over a reload only for the same address at the same position. */
function snapshot(
  request: ProviderGeographyRequest,
  previous?: Snapshot | null,
): Snapshot | null {
  const { application } = request;
  if (!application) return null;
  const rows = geographyRows(application.details);
  const unchanged = (row: Row) => {
    const before = previous?.rows.find((item) => item.key === row.key);
    const strip = (address: IntakeAddress) =>
      JSON.stringify({ ...address, country: undefined, state: undefined });
    return before && strip(before.address) === strip(row.address);
  };
  return {
    request,
    application,
    rows,
    edits: Object.fromEntries(
      rows.map((row) => [
        row.key,
        unchanged(row)
          ? previous!.edits[row.key]
          : {
              country: row.address.country ?? "",
              state: row.address.state ?? "",
            },
      ]),
    ),
  };
}

/**
 * Fixes request addresses that block provider matching. Cancel never writes;
 * Save rewrites the accepted application with only country and state changed
 * on the listed addresses, then runs `onSaved` to retry the match.
 */
export function ProviderGeographyDialog({
  open,
  onOpenChange,
  request,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Live request; used to detect that the application moved on while open. */
  request: ProviderGeographyRequest;
  onSaved: () => void | Promise<void>;
}) {
  const saveApplication = useMutation(
    api.procurementRequests.updateApplication,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState(() => snapshot(request));
  const stale =
    !!base &&
    ((request.intakeRevision ?? 0) !== (base.request.intakeRevision ?? 0) ||
      request.updatedAt !== base.request.updatedAt);
  const complete = !!base?.rows.every(
    (row) => !Object.keys(addressProblems(base.edits[row.key])).length,
  );

  function setEdit(key: string, edit: Edit) {
    setBase((current) =>
      current
        ? { ...current, edits: { ...current.edits, [key]: edit } }
        : current,
    );
  }

  function changeCountry(key: string, country: string, state: string) {
    const kind = normalizeCountry(country);
    const region = normalizeRegion(state);
    const keep = region && brokerRegionCountry(region) === kind ? region : "";
    setEdit(key, {
      country,
      state: kind === "US" || kind === "CA" ? keep : "",
    });
  }

  async function save() {
    if (!base || busy || stale || !complete) return;
    setBusy(true);
    setError(null);
    try {
      if (base.rows.length) {
        const details = base.rows.reduce((next, row) => {
          const edit = base.edits[row.key];
          const patch: Partial<IntakeAddress> = {};
          if (edit.country !== (row.address.country ?? ""))
            patch.country = edit.country;
          if (edit.state !== (row.address.state ?? ""))
            patch.state = edit.state;
          return Object.keys(patch).length
            ? patchAddress(next, row.path, patch)
            : next;
        }, base.application.details);
        const { request: saved } = base;
        await saveApplication({
          requestId: saved._id,
          expectedRevision: saved.intakeRevision ?? 0,
          expectedUpdatedAt: saved.updatedAt,
          title: saved.title,
          targetEffectiveDate: saved.targetEffectiveDate || null,
          status: saved.status,
          replacingPolicyId: saved.replacingPolicyId ?? null,
          resultingPolicyId: saved.resultingPolicyId ?? null,
          clientVisible: saved.clientVisible ?? true,
          answers: base.application.answers,
          details,
        });
      }
      onOpenChange(false);
      await onSaved();
    } catch (caught) {
      const message = getUserFacingErrorMessage(
        caught,
        "Could not save the application",
      );
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent showCloseButton={!busy} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Set locations to match providers</DialogTitle>
          <DialogDescription>
            Set the missing countries and states or provinces to find matching
            providers.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          {!base ? (
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              Save the request application before adding providers.
            </p>
          ) : null}
          {stale ? (
            <div
              role="status"
              className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-4 py-3 ${typeStyle("body.default")}`}
            >
              <span>This application changed while this was open.</span>
              <PillButton
                type="button"
                variant="secondary"
                size="default"
                disabled={busy}
                onClick={() => {
                  setBase(snapshot(request, base));
                  setError(null);
                }}
              >
                Load latest
              </PillButton>
            </div>
          ) : null}
          {base && !base.rows.length ? (
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              Every address now has the geography providers need.
            </p>
          ) : null}
          {base?.rows.length ? (
            <InlineFieldCard wideLabels>
              {base.rows.map((row) => {
                const edit = base.edits[row.key];
                const country = normalizeCountry(edit.country);
                const names = regionNames(country);
                const problems = addressProblems(edit);
                const region = normalizeRegion(edit.state);
                const hint = problems.country
                  ? problems.country === "missing"
                    ? "Country is required"
                    : `“${edit.country}” isn't a recognized country`
                  : problems.state
                    ? problems.state === "missing"
                      ? `${country === "CA" ? "Province" : "State"} is required`
                      : `“${edit.state}” isn't a ${country === "CA" ? "province" : "state"} of this country`
                    : null;
                return (
                  <InlineFieldRow
                    key={row.key}
                    label={
                      <div className="min-w-0 space-y-0.5">
                        <p
                          className={`text-foreground ${typeStyle("body.medium")}`}
                        >
                          {row.label}
                        </p>
                        <p
                          className={`break-words ${typeStyle("caption.default")}`}
                        >
                          {addressText(row.address) || "No address entered"}
                        </p>
                        {hint ? (
                          <p
                            className={`text-destructive ${typeStyle("caption.default")}`}
                          >
                            {hint}
                          </p>
                        ) : null}
                      </div>
                    }
                  >
                    <div className="grid min-w-0 gap-1 sm:grid-cols-2">
                      <SearchableSelect
                        ariaLabel={`${row.label} country`}
                        placeholder="Select country"
                        value={
                          SELECTABLE_COUNTRIES.find(
                            (option) =>
                              normalizeCountry(option.value) === country,
                          )?.value ?? ""
                        }
                        options={SELECTABLE_COUNTRIES}
                        disabled={busy || stale}
                        onChange={(next) =>
                          changeCountry(row.key, next, edit.state)
                        }
                      />
                      {names ? (
                        <SearchableSelect
                          ariaLabel={`${row.label} ${country === "CA" ? "province" : "state"}`}
                          placeholder={
                            country === "CA"
                              ? "Select province"
                              : "Select state"
                          }
                          value={
                            region && brokerRegionCountry(region) === country
                              ? region
                              : ""
                          }
                          options={Object.entries(names)
                            .map(([value, name]) => ({
                              value,
                              label: `${name} (${value})`,
                            }))
                            .sort((a, b) => a.label.localeCompare(b.label))}
                          disabled={busy || stale}
                          onChange={(state) =>
                            setEdit(row.key, { ...edit, state })
                          }
                        />
                      ) : (
                        <p
                          className={`self-center px-3 text-muted-foreground ${typeStyle("caption.default")}`}
                        >
                          {country
                            ? "No state needed"
                            : "Select a country first"}
                        </p>
                      )}
                    </div>
                  </InlineFieldRow>
                );
              })}
            </InlineFieldCard>
          ) : null}
          {error ? (
            <p
              role="alert"
              className={`text-destructive ${typeStyle("body.default")}`}
            >
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <PillButton
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </PillButton>
          <PillButton
            type="button"
            disabled={busy || !base || stale || !complete}
            onClick={() => void save()}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {busy
              ? "Saving…"
              : base?.rows.length
                ? "Save and add providers"
                : "Add providers"}
          </PillButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
