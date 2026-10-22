"use client";

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { countryOptions } from "@/components/insurance-intake/driver-jurisdiction";
import { InlineFieldCard, InlineFieldRow } from "@/components/ui/inline-fields";
import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  CANADIAN_PROVINCES,
  USPS_STATE_NAMES,
} from "@/convex/lib/brokerProfileValidation";
import { procurementBrokerCriteria } from "@/convex/lib/procurementBrokerMatching";
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
  | { kind: "property"; coverageIndex: number; propertyIndex: number };

type FieldProblem = "missing" | "unrecognized";

export type GeographyIssue = {
  key: string;
  path: AddressPath;
  label: string;
  address: IntakeAddress;
  country: FieldProblem | null;
  state: FieldProblem | null;
};

export type GeographyPreflight =
  | { ready: true }
  | { ready: false; issues: GeographyIssue[] };

type Edit = { country: string; state: string };

function probeApplication(address: IntakeAddress): IntakeApplication {
  return {
    answers: {},
    files: [],
    submittedAt: 0,
    revision: 0,
    details: {
      coverages: [{ coverage: "general_liability", limits: {} }],
      locations: [],
      mailingAddress: address,
    } as unknown as IntakeDetails,
  };
}

/**
 * The matcher is the single authority on what counts as a usable address.
 * Probing it with one address and a supported coverage reports acceptance
 * without duplicating its country and region normalization.
 */
function matcherAccepts(address: IntakeAddress) {
  try {
    procurementBrokerCriteria(probeApplication(address));
    return true;
  } catch {
    return false;
  }
}

type RegionKind = "US" | "CA" | "other" | "unknown";

function regionKind(country: string | undefined): RegionKind {
  if (!country?.trim()) return "unknown";
  if (matcherAccepts({ country, state: "CA" })) return "US";
  if (matcherAccepts({ country, state: "ON" })) return "CA";
  return matcherAccepts({ country }) ? "other" : "unknown";
}

function assessAddress(address: IntakeAddress) {
  if (matcherAccepts(address)) return null;
  const kind = regionKind(address.country);
  if (kind === "unknown")
    return {
      country: (address.country?.trim()
        ? "unrecognized"
        : "missing") as FieldProblem,
      state: null,
    };
  return {
    country: null,
    state: (address.state?.trim() ? "unrecognized" : "missing") as FieldProblem,
  };
}

/**
 * Mirrors `procurementBrokerCriteria`: operating locations, else the mailing
 * address, plus every coverage property address.
 */
function requestAddresses(details: IntakeDetails) {
  const entries: {
    key: string;
    path: AddressPath;
    label: string;
    address: IntakeAddress;
  }[] = [];
  const named = (base: string, name?: string) =>
    name?.trim() ? `${base} · ${name.trim()}` : base;
  if (details.locations.length)
    details.locations.forEach((location, index) =>
      entries.push({
        key: `location:${index}`,
        path: { kind: "location", index },
        label: named(`Operating location ${index + 1}`, location.name),
        address: location.address,
      }),
    );
  else
    entries.push({
      key: "mailing",
      path: { kind: "mailing" },
      label: "Mailing address (no operating locations listed)",
      address: details.mailingAddress,
    });
  details.coverages.forEach((line, coverageIndex) =>
    (line.properties ?? []).forEach((property, propertyIndex) =>
      entries.push({
        key: `property:${coverageIndex}:${propertyIndex}`,
        path: { kind: "property", coverageIndex, propertyIndex },
        label: named(
          `${coverageRequestLabel(line)} property ${propertyIndex + 1}`,
          property.name,
        ),
        address: property.address,
      }),
    ),
  );
  return entries;
}

export function providerGeographyIssues(
  details: IntakeDetails,
): GeographyIssue[] {
  return requestAddresses(details).flatMap((entry) => {
    const problem = assessAddress(entry.address);
    return problem ? [{ ...entry, ...problem }] : [];
  });
}

/**
 * Decides whether auto-add can run. Anything other than missing or invalid
 * geography (no saved application, no supported coverage) is left to the
 * server, which reports it; probing a copy with valid placeholder addresses
 * detects that without reading error text.
 */
export function providerGeographyPreflight(
  application: IntakeApplication | null | undefined,
): GeographyPreflight {
  if (!application) return { ready: true };
  const issues = providerGeographyIssues(application.details);
  if (!issues.length) return { ready: true };
  try {
    procurementBrokerCriteria({
      ...application,
      details: withAddresses(application.details, issues, () => ({
        country: "United States",
        state: "CA",
      })),
    });
  } catch {
    return { ready: true };
  }
  return { ready: false, issues };
}

function patchAddress(
  details: IntakeDetails,
  path: AddressPath,
  patch: Partial<IntakeAddress>,
): IntakeDetails {
  if (path.kind === "mailing")
    return {
      ...details,
      mailingAddress: { ...details.mailingAddress, ...patch },
    };
  if (path.kind === "location")
    return {
      ...details,
      locations: details.locations.map((location, index) =>
        index === path.index
          ? { ...location, address: { ...location.address, ...patch } }
          : location,
      ),
    };
  return {
    ...details,
    coverages: details.coverages.map((line, coverageIndex) =>
      coverageIndex === path.coverageIndex
        ? {
            ...line,
            properties: (line.properties ?? []).map((property, index) =>
              index === path.propertyIndex
                ? {
                    ...property,
                    address: { ...property.address, ...patch },
                  }
                : property,
            ),
          }
        : line,
    ),
  };
}

function withAddresses(
  details: IntakeDetails,
  issues: GeographyIssue[],
  edit: (issue: GeographyIssue) => Edit,
) {
  return issues.reduce((next, issue) => {
    const { country, state } = edit(issue);
    const patch: Partial<IntakeAddress> = {};
    if (country !== (issue.address.country ?? "")) patch.country = country;
    if (state !== (issue.address.state ?? "")) patch.state = state;
    return Object.keys(patch).length
      ? patchAddress(next, issue.path, patch)
      : next;
  }, details);
}

const COUNTRY_SELECT_OPTIONS = (() => {
  let options: typeof countryOptions | undefined;
  return () =>
    (options ??= countryOptions.filter((option) => {
      const kind = regionKind(option.value);
      return kind !== "unknown";
    }));
})();

function regionOptions(kind: RegionKind) {
  const names: Readonly<Record<string, string>> | null =
    kind === "US"
      ? USPS_STATE_NAMES
      : kind === "CA"
        ? CANADIAN_PROVINCES
        : null;
  return Object.entries(names ?? {})
    .map(([value, name]) => ({ value, label: `${name} (${value})` }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function selectedRegion(
  options: { value: string; label: string }[],
  state: string,
) {
  const wanted = state
    .trim()
    .toLowerCase()
    .replace(/^(us|ca)-/, "");
  return (
    options.find(
      (option) =>
        option.value.toLowerCase() === wanted ||
        option.label.toLowerCase().startsWith(`${wanted} (`),
    )?.value ?? ""
  );
}

/** Edits survive a rebase only for the same address at the same position. */
function signature(address: IntakeAddress) {
  return JSON.stringify({ ...address, country: undefined, state: undefined });
}

function problemText(
  problem: FieldProblem | null,
  noun: string,
  value?: string,
) {
  if (!problem) return null;
  return problem === "missing"
    ? `${noun} is required`
    : `“${value}” isn't a recognized ${noun.toLowerCase()}`;
}

type Base = {
  request: ProviderGeographyRequest;
  application: IntakeApplication;
  issues: GeographyIssue[];
};

function snapshot(live: ProviderGeographyRequest): Base | null {
  if (!live.application) return null;
  return {
    request: live,
    application: live.application,
    issues: providerGeographyIssues(live.application.details),
  };
}

function initialEdits(
  issues: GeographyIssue[],
  previous?: Record<string, Edit>,
  previousSignatures?: Record<string, string>,
) {
  return Object.fromEntries(
    issues.map((issue) => {
      const kept =
        previous?.[issue.key] &&
        previousSignatures?.[issue.key] === signature(issue.address);
      return [
        issue.key,
        kept
          ? previous![issue.key]
          : {
              country: issue.address.country ?? "",
              state: issue.address.state ?? "",
            },
      ];
    }),
  ) as Record<string, Edit>;
}

/**
 * Focused fix for request addresses that block provider matching. Cancel never
 * writes; Save writes the accepted application with only country and state
 * changed on the listed addresses, then hands control back to retry the match.
 */
export function ProviderGeographyDialog({
  open,
  onOpenChange,
  request,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Live request; used only to detect that the application moved on. */
  request: ProviderGeographyRequest;
  /** Runs after a successful save, or immediately if nothing needed fixing. */
  onSaved: () => void | Promise<void>;
}) {
  const saveApplication = useMutation(
    api.procurementRequests.updateApplication,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState<Base | null>(() => snapshot(request));
  const [edits, setEdits] = useState<Record<string, Edit>>(() =>
    base ? initialEdits(base.issues) : {},
  );
  const stale =
    !!base &&
    ((request.intakeRevision ?? 0) !== (base.request.intakeRevision ?? 0) ||
      request.updatedAt !== base.request.updatedAt);

  const rows = useMemo(
    () =>
      (base?.issues ?? []).map((issue) => {
        const edit = edits[issue.key];
        const address = { ...issue.address, ...edit };
        return {
          issue,
          edit,
          kind: regionKind(address.country),
          ok: matcherAccepts(address),
          assessment: assessAddress(address),
        };
      }),
    [base, edits],
  );
  const allOk = rows.every((row) => row.ok);

  function loadLatest() {
    const next = snapshot(request);
    setBase(next);
    setEdits(
      next
        ? initialEdits(
            next.issues,
            edits,
            Object.fromEntries(
              (base?.issues ?? []).map((issue) => [
                issue.key,
                signature(issue.address),
              ]),
            ),
          )
        : {},
    );
    setError(null);
  }

  function setCountry(key: string, country: string) {
    setEdits((current) => {
      const previous = current[key];
      const address = { country, state: previous.state };
      const keep =
        regionKind(country) === "other" || matcherAccepts(address)
          ? previous.state
          : "";
      return { ...current, [key]: { country, state: keep } };
    });
  }

  async function save() {
    if (!base || busy || stale || !allOk) return;
    setBusy(true);
    setError(null);
    try {
      if (base.issues.length) {
        const details = withAddresses(
          base.application.details,
          base.issues,
          (issue) => edits[issue.key],
        );
        // Never persist geography the matcher would still reject.
        procurementBrokerCriteria({ ...base.application, details });
        await saveApplication({
          requestId: base.request._id,
          expectedRevision: base.request.intakeRevision ?? 0,
          expectedUpdatedAt: base.request.updatedAt,
          title: base.request.title,
          targetEffectiveDate: base.request.targetEffectiveDate || null,
          status: base.request.status,
          replacingPolicyId: base.request.replacingPolicyId ?? null,
          resultingPolicyId: base.request.resultingPolicyId ?? null,
          clientVisible: base.request.clientVisible ?? true,
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

  const nothingToFix = !!base && !base.issues.length;
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent showCloseButton={!busy} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Set locations to match providers</DialogTitle>
          <DialogDescription>
            Provider matching needs a country for every address, and a state or
            province for US and Canadian ones. Set them here and providers are
            added right after saving. Nothing else in the application changes.
          </DialogDescription>
        </DialogHeader>
        {!base ? (
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            Save the request application before adding providers.
          </p>
        ) : (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
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
                  onClick={loadLatest}
                >
                  Load latest
                </PillButton>
              </div>
            ) : null}
            {nothingToFix ? (
              <p
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
                Every address now has the geography providers need.
              </p>
            ) : (
              <InlineFieldCard wideLabels>
                {rows.map(({ issue, edit, kind, ok, assessment }) => {
                  const regions = regionOptions(kind);
                  const address = addressText(issue.address);
                  const hints = [
                    problemText(
                      assessment?.country ?? null,
                      "Country",
                      edit.country,
                    ),
                    problemText(
                      assessment?.state ?? null,
                      kind === "CA" ? "Province" : "State",
                      edit.state,
                    ),
                  ].filter(Boolean);
                  return (
                    <InlineFieldRow
                      key={issue.key}
                      label={
                        <div className="min-w-0 space-y-0.5">
                          <p
                            className={`text-foreground ${typeStyle("body.medium")}`}
                          >
                            {issue.label}
                          </p>
                          <p
                            className={`break-words ${typeStyle("caption.default")}`}
                          >
                            {address || "No address entered"}
                          </p>
                          {!ok && hints.length ? (
                            <p
                              className={`text-destructive ${typeStyle("caption.default")}`}
                            >
                              {hints.join(" · ")}
                            </p>
                          ) : null}
                        </div>
                      }
                    >
                      <div className="grid min-w-0 gap-1 sm:grid-cols-2">
                        <SearchableSelect
                          ariaLabel={`${issue.label} country`}
                          placeholder="Select country"
                          value={
                            COUNTRY_SELECT_OPTIONS().some(
                              (option) => option.value === edit.country,
                            )
                              ? edit.country
                              : ""
                          }
                          options={COUNTRY_SELECT_OPTIONS()}
                          disabled={busy || stale}
                          onChange={(next) => setCountry(issue.key, next)}
                        />
                        {regions.length ? (
                          <SearchableSelect
                            ariaLabel={`${issue.label} ${kind === "CA" ? "province" : "state"}`}
                            placeholder={
                              kind === "CA" ? "Select province" : "Select state"
                            }
                            value={selectedRegion(regions, edit.state)}
                            options={regions}
                            disabled={busy || stale}
                            onChange={(next) =>
                              setEdits((current) => ({
                                ...current,
                                [issue.key]: {
                                  ...current[issue.key],
                                  state: next,
                                },
                              }))
                            }
                          />
                        ) : (
                          <p
                            className={`self-center px-3 text-muted-foreground ${typeStyle("caption.default")}`}
                          >
                            {kind === "other"
                              ? "No state needed"
                              : "Select a country first"}
                          </p>
                        )}
                      </div>
                    </InlineFieldRow>
                  );
                })}
              </InlineFieldCard>
            )}
            {error ? (
              <p
                role="alert"
                className={`text-destructive ${typeStyle("body.default")}`}
              >
                {error}
              </p>
            ) : null}
          </div>
        )}
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
            disabled={busy || !base || stale || !allOk}
            onClick={() => void save()}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {busy
              ? "Saving…"
              : nothingToFix
                ? "Add providers"
                : "Save and add providers"}
          </PillButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
