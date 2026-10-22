"use client";
import { ChevronRight, Plus } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { Input } from "@claritylabs-inc/ui/components/input";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
} from "@claritylabs-inc/ui/components/input-group";
import {
  InlineFieldCard,
  InlineFieldList,
  InlineFieldRow,
  InlineFieldsContext,
} from "@/components/ui/inline-fields";
import { PillButton } from "@/components/ui/pill-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import type { IntakeAnswers } from "@/lib/insurance-intake";
import {
  addressText,
  coverageRequestLabel,
  type IntakeDetails,
} from "@/lib/insurance-intake-details";
import { intakeCoverageAnswerRows } from "@/lib/intake-application";
import { intakeCatalogCoverage } from "@/lib/intake-acord-questions";
import { intakeLocationHeading } from "@/lib/intake-applicant-wording";
import {
  estimatedVehicleValueError,
  vehicleQuoteLabel,
} from "@/lib/intake-auto-quote";
import { newIntakeDriver } from "@/lib/intake-drivers";
import {
  formatIntakeFollowupAnswer,
  intakeVehicleQuestionSubject,
  withIntakeFollowupAnswer,
  type IntakeFollowupAnswer,
} from "@/lib/intake-followups";
import { intakeApplicantQuestion } from "@/lib/intake-applicant-wording";
import { vehicleUnderwritingValues } from "@/lib/intake-vehicle-underwriting";
import { vehicleMakeLabel } from "@/lib/vehicle-display";
import { typeStyle } from "@/lib/typography";
import { IntakeDriverRows, IntakeFollowupRows } from "./application-quote-fields";
import {
  IntakeCoverageLimits,
  IntakeCoverageScope,
  IntakePropertyLocationRows,
  IntakeValueInput,
} from "./details-fields";
import { IntakeFollowups } from "./followups";
import { IntakeVehicleFields } from "./vehicle-fields";
import { IntakeVehicleUnderwritingFields } from "./vehicle-underwriting-fields";

/** Collection items and multi-value answers edited in the right panel. */
export type CoveragePanelTarget =
  | { kind: "vehicle" | "location"; coverageIndex: number; index: number }
  | { kind: "driver"; index: number }
  | { kind: "routes"; questionId: string };

type Props = {
  answers: IntakeAnswers;
  details: IntakeDetails;
  onDetailsChange: (details: IntakeDetails) => void;
};

const normalize = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase();

/** Catalog answers about one vehicle or location belong in that item's panel. */
function answerSubject(
  row: IntakeFollowupAnswer,
  details: IntakeDetails,
  coverageIndex: number,
): { kind: "vehicle" | "location"; index: number } | undefined {
  const vehicle = intakeVehicleQuestionSubject(row)?.match(/^Vehicle (\d+)/);
  if (vehicle) return { kind: "vehicle", index: Number(vehicle[1]) - 1 };
  const location = intakeLocationHeading(row, details);
  if (!location) return;
  const index = (details.coverages[coverageIndex].properties ?? []).findIndex(
    (property) =>
      normalize(addressText(property.address)) === normalize(location.address),
  );
  return index < 0 ? undefined : { kind: "location", index };
}

function coverageAnswers(
  answers: IntakeAnswers,
  details: IntakeDetails,
  coverageIndex: number,
) {
  const coverageIds = details.coverages.map((line) => line.coverage);
  const coverage = details.coverages[coverageIndex].coverage;
  return intakeCoverageAnswerRows(answers, details).filter(
    (row) => intakeCatalogCoverage(row, coverageIds) === coverage,
  );
}

function rowKeyboard(event: KeyboardEvent, open: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  open();
}

function ItemTable({
  title,
  empty,
  columns,
  rows,
}: {
  title: string;
  empty: string;
  columns: string[];
  rows: {
    key: string;
    label: string;
    cells: ReactNode[];
    selected: boolean;
    open: () => void;
  }[];
}) {
  return (
    <InlineFieldCard
      title={title}
      actions={
        rows.length ? (
          <span className="text-muted-foreground">{rows.length}</span>
        ) : undefined
      }
    >
      {rows.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column}>{column}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.key}
                tabIndex={0}
                aria-label={`Edit ${row.label}`}
                aria-selected={row.selected}
                onClick={row.open}
                onKeyDown={(event) => rowKeyboard(event, row.open)}
                className={`cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${row.selected ? "bg-muted" : ""}`}
              >
                {row.cells.map((cell, index) => (
                  <TableCell
                    key={index}
                    className={`whitespace-normal ${index === row.cells.length - 1 ? "pr-3" : ""}`}
                  >
                    {index === row.cells.length - 1 ? (
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0">{cell}</span>
                        <ChevronRight
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted-foreground/60"
                        />
                      </span>
                    ) : (
                      cell
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className={`px-4 py-2.5 text-muted-foreground ${typeStyle("body.default")}`}>
          {empty}
        </p>
      )}
    </InlineFieldCard>
  );
}

const missing = (value?: string) =>
  value?.trim() ? value : <span className="text-muted-foreground">Not provided</span>;

/** One requested coverage: terms in a card, collections as tables opening panels. */
export function IntakeCoverageSection({
  answers,
  details,
  onDetailsChange,
  coverageIndex,
  onRemove,
  panel,
  onOpenPanel,
}: Props & {
  coverageIndex: number;
  onRemove: () => void;
  panel: CoveragePanelTarget | null;
  onOpenPanel: (target: CoveragePanelTarget) => void;
}) {
  const line = details.coverages[coverageIndex];
  const one = { ...details, coverages: [line], coverageIndex: 0 };
  const change = (next: IntakeDetails) =>
    onDetailsChange({
      ...details,
      coverages: details.coverages.map((current, i) =>
        i === coverageIndex ? next.coverages[0] : current,
      ),
    });
  const updateLine = (patch: Partial<typeof line>) =>
    change({ ...one, coverages: [{ ...line, ...patch }] });
  const rows = coverageAnswers(answers, details, coverageIndex).filter(
    (row) => !answerSubject(row, details, coverageIndex),
  );
  const routes = rows.filter((row) => row.kind === "routes");
  const vehicles = line.vehicles ?? [];
  const properties = line.properties ?? [];
  const drivers = details.drivers ?? [];
  const auto = line.coverage === "commercial_auto";
  const selected = (target: CoveragePanelTarget) =>
    JSON.stringify(panel) === JSON.stringify(target);
  return (
    <section
      aria-label={coverageRequestLabel(line)}
      className="space-y-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={typeStyle("heading.item")}>
          {coverageRequestLabel(line)}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {auto && (
            <PillButton
              variant="secondary"
              size="default"
              disabled={vehicles.length >= 30}
              onClick={() => {
                updateLine({
                  vehicles: [
                    ...vehicles,
                    { year: "", make: "", model: "", vin: "" },
                  ],
                });
                onOpenPanel({
                  kind: "vehicle",
                  coverageIndex,
                  index: vehicles.length,
                });
              }}
            >
              <Plus className="size-3.5" />
              Add vehicle
            </PillButton>
          )}
          {auto && (
            <PillButton
              variant="secondary"
              size="default"
              disabled={drivers.length >= 30}
              onClick={() => {
                onDetailsChange({
                  ...details,
                  drivers: [...drivers, newIntakeDriver()],
                });
                onOpenPanel({ kind: "driver", index: drivers.length });
              }}
            >
              <Plus className="size-3.5" />
              Add driver
            </PillButton>
          )}
          {line.coverage === "property" && (
            <PillButton
              variant="secondary"
              size="default"
              disabled={properties.length >= 30}
              onClick={() => {
                updateLine({
                  properties: [...properties, { address: {}, details: "" }],
                });
                onOpenPanel({
                  kind: "location",
                  coverageIndex,
                  index: properties.length,
                });
              }}
            >
              <Plus className="size-3.5" />
              Add location
            </PillButton>
          )}
          {/* Desktop removes coverage from the section menu row. */}
          <PillButton
            variant="destructive"
            size="default"
            className="lg:hidden"
            onClick={onRemove}
          >
            Remove coverage
          </PillButton>
        </div>
      </div>
      <InlineFieldCard title="Limits and terms" wideLabels={rows.length > 0}>
        <IntakeCoverageLimits details={one} onChange={change} />
        <IntakeCoverageScope details={one} onChange={change} />
        <InlineFieldRow label="Additional coverage requests">
          <Textarea
            rows={1}
            aria-label={`${coverageRequestLabel(line)} additional coverage requests`}
            placeholder="Not provided"
            value={line.additionalCoverages ?? ""}
            onChange={(event) =>
              updateLine({ additionalCoverages: event.target.value })
            }
          />
        </InlineFieldRow>
        {line.coverage === "cyber" &&
          (
            [
              ["privacyPolicyUrl", "Privacy policy"],
              ["termsUrl", "Terms of service"],
            ] as const
          ).map(([key, label]) => (
            <InlineFieldRow key={key} label={label}>
              <Input
                aria-label={label}
                type="url"
                placeholder="Not provided"
                maxLength={2000}
                value={details.cyberDocuments?.[key] ?? ""}
                onChange={(event) =>
                  onDetailsChange({
                    ...details,
                    cyberDocuments: {
                      ...details.cyberDocuments,
                      [key]: event.target.value,
                    },
                  })
                }
              />
            </InlineFieldRow>
          ))}
        {auto && (
          <InlineFieldRow label="Freight hauled">
            <Textarea
              rows={1}
              aria-label="Freight hauled"
              placeholder="Not provided"
              maxLength={2000}
              value={details.freightHauled ?? ""}
              onChange={(event) =>
                onDetailsChange({
                  ...details,
                  freightHauled: event.target.value,
                })
              }
            />
          </InlineFieldRow>
        )}
        <IntakeFollowupRows
          rows={rows.filter((row) => row.kind !== "routes")}
          details={details}
          businessName={answers.legalName || answers.dba}
          industry={answers.industry}
          onChange={onDetailsChange}
        />
        {routes.map((row) => (
          <InlineFieldRow
            key={row.id}
            label={intakeApplicantQuestion(row, answers.industry, details.followups).title}
          >
            <button
              type="button"
              onClick={() => onOpenPanel({ kind: "routes", questionId: row.id })}
              aria-label={`Edit routes: ${formatIntakeFollowupAnswer(row) || "Not provided"}`}
              className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none ${selected({ kind: "routes", questionId: row.id }) ? "bg-muted" : ""}`}
            >
              <span
                className={`min-w-0 whitespace-pre-line ${row.answer ? "" : "text-muted-foreground"}`}
              >
                {formatIntakeFollowupAnswer(row) || "Not provided"}
              </span>
              <ChevronRight
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground/60"
              />
            </button>
          </InlineFieldRow>
        ))}
      </InlineFieldCard>
      {auto && (
        <ItemTable
          title="Vehicles"
          empty="No vehicles added"
          columns={["Vehicle", "VIN", "Use", "Approximate value"]}
          rows={vehicles.map((vehicle, index) => {
            const target = { kind: "vehicle" as const, coverageIndex, index };
            const label = vehicleName(vehicle, index);
            return {
              key: String(index),
              label,
              selected: selected(target),
              open: () => onOpenPanel(target),
              cells: [
                label,
                missing(vehicle.vin),
                missing(
                  vehicleUnderwritingValues(vehicle, index, details.followups)
                    .use,
                ),
                missing(vehicle.estimatedValue && `$${vehicle.estimatedValue}`),
              ],
            };
          })}
        />
      )}
      {auto && (
        <ItemTable
          title="Drivers"
          empty="No drivers added"
          columns={["Driver", "License", "Experience", "History"]}
          rows={drivers.map((driver, index) => {
            const target = { kind: "driver" as const, index };
            const label = driver.name.trim() || `Driver ${index + 1}`;
            const history = [
              driver.accidents === "yes" ? "Accidents" : "",
              driver.violations === "yes" ? "Violations" : "",
            ].filter(Boolean);
            return {
              key: driver.id,
              label,
              selected: selected(target),
              open: () => onOpenPanel(target),
              cells: [
                <span key="name" className="ph-no-capture">
                  {label}
                </span>,
                missing(
                  [driver.licenseJurisdiction, driver.licenseClass]
                    .filter(Boolean)
                    .join(" · "),
                ),
                missing(
                  driver.yearsExperience &&
                    `${driver.yearsExperience} ${Number(driver.yearsExperience) === 1 ? "year" : "years"}`,
                ),
                driver.accidents === "no" && driver.violations === "no"
                  ? "None reported"
                  : missing(history.join(", ")),
              ],
            };
          })}
        />
      )}
      {line.coverage === "property" && (
        <ItemTable
          title="Locations"
          empty="No locations added"
          columns={["Location", "Address", "Owned or leased", "Staff"]}
          rows={properties.map((property, index) => {
            const target = { kind: "location" as const, coverageIndex, index };
            const label = property.name?.trim() || `Location ${index + 1}`;
            return {
              key: String(index),
              label,
              selected: selected(target),
              open: () => onOpenPanel(target),
              cells: [
                label,
                missing(addressText(property.address)),
                missing(
                  property.ownership === "owned"
                    ? "Owned"
                    : property.ownership === "leased"
                      ? "Leased"
                      : property.ownership === "unknown"
                        ? "I'm not sure"
                        : undefined,
                ),
                missing(property.staff),
              ],
            };
          })}
        />
      )}
    </section>
  );
}

function vehicleName(
  vehicle: { year: string; make: string; model: string },
  index: number,
) {
  return (
    [vehicle.year, vehicleMakeLabel(vehicle.make), vehicle.model]
      .filter(Boolean)
      .join(" ") || `Vehicle ${index + 1}`
  );
}

function PanelBlock({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className="-mx-4 space-y-1">
      {title && (
        <h3
          className={`px-4 pt-2 text-muted-foreground ${typeStyle("caption.default")}`}
        >
          {title}
        </h3>
      )}
      <InlineFieldList>{children}</InlineFieldList>
    </section>
  );
}

/** Right-panel editor for a vehicle, driver, location or route answer. */
export function IntakeCoveragePanel({
  answers,
  details,
  onDetailsChange,
  target,
  onClose,
}: Props & {
  target: CoveragePanelTarget;
  onClose: () => void;
}) {
  const followupRows = (rows: IntakeFollowupAnswer[]) =>
    rows.length ? (
      <PanelBlock title="Coverage questions">
        <IntakeFollowupRows
          rows={rows}
          details={details}
          businessName={answers.legalName || answers.dba}
          industry={answers.industry}
          onChange={onDetailsChange}
        />
      </PanelBlock>
    ) : null;
  const drawer = (
    title: ReactNode,
    body: ReactNode,
    footer?: ReactNode,
  ) => (
    <SettingsDrawer
      open
      title={title}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      footer={footer}
    >
      <InlineFieldsContext.Provider value={true}>
        <div data-operator-inline-fields className="space-y-5">
          {body}
        </div>
      </InlineFieldsContext.Provider>
    </SettingsDrawer>
  );
  if (target.kind === "routes") {
    const row = (details.followups ?? []).find(
      (answer) => answer.id === target.questionId,
    ) ??
      intakeCoverageAnswerRows(answers, details).find(
        (answer) => answer.id === target.questionId,
      );
    if (!row) return null;
    return drawer(
      intakeApplicantQuestion(row, answers.industry, details.followups).title,
      <IntakeFollowups
        status="ready"
        question={row}
        answers={details.followups}
        answer={row.answer}
        defaultCountry={details.registrationCountry}
        businessName={answers.legalName || answers.dba}
        industry={answers.industry}
        onChange={(question, answer) =>
          onDetailsChange({
            ...details,
            followups: withIntakeFollowupAnswer(
              details.followups ?? [],
              question,
              answer,
            ),
          })
        }
      />,
    );
  }
  if (target.kind === "driver") {
    const drivers = details.drivers ?? [];
    const driver = drivers[target.index];
    if (!driver) return null;
    return drawer(
      <span className="ph-no-capture">
        {driver.name.trim() || `Driver ${target.index + 1}`}
      </span>,
      <div className="ph-no-capture">
        <PanelBlock>
          <IntakeDriverRows
            driver={driver}
            index={target.index}
            defaultCountry={details.registrationCountry}
            onChange={(patch) =>
              onDetailsChange({
                ...details,
                drivers: drivers.map((row, i) =>
                  i === target.index ? { ...row, ...patch } : row,
                ),
              })
            }
          />
        </PanelBlock>
      </div>,
      <PillButton
        variant="destructive"
        onClick={() => {
          onDetailsChange({
            ...details,
            drivers: drivers.filter((_, i) => i !== target.index),
            driverIndex: 0,
          });
          onClose();
        }}
      >
        Remove driver
      </PillButton>,
    );
  }
  const line = details.coverages[target.coverageIndex];
  const scoped = line
    ? coverageAnswers(answers, details, target.coverageIndex).filter((row) => {
        const subject = answerSubject(row, details, target.coverageIndex);
        return subject?.kind === target.kind && subject.index === target.index;
      })
    : [];
  const updateLine = (patch: Partial<NonNullable<typeof line>>) =>
    onDetailsChange({
      ...details,
      coverages: details.coverages.map((current, i) =>
        i === target.coverageIndex ? { ...current, ...patch } : current,
      ),
    });
  if (target.kind === "location") {
    const properties = line?.properties ?? [];
    const property = properties[target.index];
    if (!property) return null;
    return drawer(
      property.name?.trim() || `Location ${target.index + 1}`,
      <>
        <PanelBlock>
          <IntakePropertyLocationRows
            property={property}
            index={target.index}
            onChange={(patch) =>
              updateLine({
                properties: properties.map((row, i) =>
                  i === target.index ? { ...row, ...patch } : row,
                ),
              })
            }
          />
        </PanelBlock>
        {followupRows(scoped)}
      </>,
      <PillButton
        variant="destructive"
        onClick={() => {
          updateLine({
            properties: properties.filter((_, i) => i !== target.index),
          });
          onClose();
        }}
      >
        Remove location
      </PillButton>,
    );
  }
  const vehicles = line?.vehicles ?? [];
  const vehicle = vehicles[target.index];
  if (!vehicle) return null;
  const updateVehicle = (patch: Partial<typeof vehicle>) =>
    updateLine({
      vehicles: vehicles.map((row, i) =>
        i === target.index ? { ...row, ...patch } : row,
      ),
    });
  const valueError = estimatedVehicleValueError(vehicle.estimatedValue);
  return drawer(
    vehicleQuoteLabel(
      { ...vehicle, make: vehicleMakeLabel(vehicle.make) },
      target.index,
    ),
    <>
      <PanelBlock title="Vehicle">
        <IntakeVehicleFields
          country={details.registrationCountry}
          id={`panel-vehicle-${target.index}`}
          vehicle={vehicle}
          onChange={(next) => updateVehicle(next)}
        />
      </PanelBlock>
      <PanelBlock title="Use, specifications and value">
        <IntakeVehicleUnderwritingFields
          id={`panel-vehicle-details-${target.index}`}
          values={vehicleUnderwritingValues(
            vehicle,
            target.index,
            details.followups,
          )}
          onChange={(underwriting) => updateVehicle({ underwriting })}
        />
        <InlineFieldRow label="Approximate value">
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>$</InputGroupText>
            </InputGroupAddon>
            <IntakeValueInput
              id={`panel-vehicle-${target.index}-value`}
              label={`Vehicle ${target.index + 1} approximate value`}
              value={vehicle.estimatedValue ?? ""}
              placeholder="Not provided"
              onValueChange={(estimatedValue) =>
                updateVehicle({ estimatedValue, estimatedValueSkipped: false })
              }
            />
          </InputGroup>
          {valueError && (
            <p role="alert" className="px-3 py-1 text-destructive">
              {valueError}
            </p>
          )}
        </InlineFieldRow>
      </PanelBlock>
      {followupRows(scoped)}
    </>,
    <PillButton
      variant="destructive"
      onClick={() => {
        updateLine({
          vehicles: vehicles.filter((_, i) => i !== target.index),
        });
        onClose();
      }}
    >
      Remove vehicle
    </PillButton>,
  );
}
