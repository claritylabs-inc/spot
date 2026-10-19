"use client";
import { RemoveButton } from "@/components/ui/remove-button";
import {
  InlineFieldsContext,
  InlineFieldCard,
  InlineFieldRow,
} from "@/components/ui/inline-fields";
import { Plus } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@claritylabs-inc/ui/components/dropdown-menu";
import { useEffect, useMemo, useState } from "react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@claritylabs-inc/ui/components/tabs";

import { Input } from "@claritylabs-inc/ui/components/input";
import { MapboxPlaceSelect } from "@/components/ui/mapbox-place-select";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import {
  INTAKE_FIELDS,
  type IntakeAnswers,
  type IntakeField,
} from "@/lib/insurance-intake";
import {
  coverageRequestLabel,
  COVERAGE_OPTIONS,
  newCoverage,
  type IntakeDetails,
} from "@/lib/insurance-intake-details";
import { typeStyle } from "@/lib/typography";
import {
  IntakeCoverageLimits,
  IntakeCoverageScope,
  IntakeRegistration,
  IntakeMailingAddress,
  IntakeLocations,
  IntakeRelatedEntities,
  IntakeRevenueFields,
} from "./details-fields";

const COUNTRY_CODES: Record<string, string> = {
  "United States": "us",
  Canada: "ca",
};

/** The operator edits the same typed fields used by the customer questionnaire. */
export function IntakeApplicationFields({
  companyOnly = false,
  companyGroup = false,
  activeSection,
  extraRows = [],
  onToolbarActions,
  answers,
  details,
  onAnswersChange,
  onDetailsChange,
}: {
  companyOnly?: boolean;
  companyGroup?: boolean;
  activeSection?: string;
  extraRows?: { label: string; value?: React.ReactNode }[];
  onToolbarActions?: (node: React.ReactNode) => void;
  answers: IntakeAnswers;
  details: IntakeDetails;
  onAnswersChange: (answers: IntakeAnswers) => void;
  onDetailsChange: (details: IntakeDetails) => void;
}) {
  const titles = [
    ...(!companyOnly
      ? ["Contact details", "Request details", "Coverage Requested"]
      : []),
    "Business details",
    "Addresses",
    "Related legal entities",
    "Revenue",
    "Locations",
    ...(!companyOnly ? ["Insurance history"] : []),
  ];
  const [selected, setSelected] = useState(titles[0]);
  const visible = activeSection ?? selected;
  const addCoverage = useMemo(
    () => (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<PillButton variant="secondary" size="default" />}
        >
          <Plus className="size-3.5" />
          Add coverage
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {COVERAGE_OPTIONS.filter(
            (option) =>
              !details.coverages.some((line) => line.coverage === option.id),
          ).map((option) => (
            <DropdownMenuItem
              key={option.id}
              onClick={() =>
                onDetailsChange({
                  ...details,
                  coverages:
                    option.id === "unknown"
                      ? [newCoverage("unknown")]
                      : [
                          ...details.coverages.filter(
                            (line) => line.coverage !== "unknown",
                          ),
                          newCoverage(option.id),
                        ],
                })
              }
            >
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    [details, onDetailsChange],
  );
  useEffect(() => {
    onToolbarActions?.(visible === "Coverage Requested" ? addCoverage : null);
    return () => onToolbarActions?.(null);
  }, [visible, addCoverage, onToolbarActions]);

  const formationParts = (answers.formation ?? "")
    .split(",")
    .map((part) => part.trim());
  const formationState =
    details.registrationState ??
    (formationParts.length > 1
      ? formationParts.slice(0, -1).join(", ")
      : (formationParts[0] ?? ""));
  const formationCountry =
    details.registrationCountry ??
    (formationParts.length > 1 ? formationParts.at(-1)! : "");
  const formationCountryCode =
    COUNTRY_CODES[formationCountry || "United States"];
  const formationRows = (
    <div
      key="formation"
      className="contents [&>*]:border-b [&>*]:border-border"
    >
      <InlineFieldRow label="Country of formation">
        <MapboxPlaceSelect
          kind="country"
          ariaLabel="Country of formation"
          value={formationCountry}
          onChange={(country) =>
            onDetailsChange({
              ...details,
              registrationState:
                country === formationCountry ? formationState : "",
              registrationCountry: country,
            })
          }
        />
      </InlineFieldRow>
      <InlineFieldRow label="State / province of formation">
        <MapboxPlaceSelect
          kind="region"
          ariaLabel="State / province of formation"
          countryCode={formationCountryCode}
          value={formationState}
          onChange={(state) =>
            onDetailsChange({
              ...details,
              registrationState: state,
              registrationCountry: formationCountry,
            })
          }
        />
      </InlineFieldRow>
    </div>
  );
  const text = (key: IntakeField, multiline = false) => (
    <InlineFieldRow key={key} label={INTAKE_FIELDS[key]}>
      {multiline ? (
        <Textarea
          rows={1}
          aria-label={INTAKE_FIELDS[key]}
          value={answers[key] ?? ""}
          onChange={(event) =>
            onAnswersChange({ ...answers, [key]: event.target.value })
          }
        />
      ) : (
        <Input
          aria-label={INTAKE_FIELDS[key]}
          type={key === "email" ? "email" : key === "phone" ? "tel" : "text"}
          value={answers[key] ?? ""}
          placeholder="Not provided"
          onChange={(event) =>
            onAnswersChange({ ...answers, [key]: event.target.value })
          }
        />
      )}
    </InlineFieldRow>
  );
  const section = (title: string, content: React.ReactNode) => {
    const grouped =
      companyGroup &&
      visible === "Business details" &&
      [
        "Business details",
        "Addresses",
        "Related legal entities",
        "Revenue",
        "Locations",
      ].includes(title);
    if (title !== visible && !grouped) return null;
    const fields = (
      <fieldset aria-label={title} className="min-w-0 space-y-3">
        {grouped && title !== "Business details" && (
          <legend className={typeStyle("heading.item")}>{title}</legend>
        )}
        {content}
      </fieldset>
    );
    return activeSection ? (
      <div className="space-y-3">{fields}</div>
    ) : (
      <TabsContent value={title}>{fields}</TabsContent>
    );
  };
  return (
    <InlineFieldsContext.Provider value={true}>
      <Tabs
        data-operator-inline-fields
        value={visible}
        onValueChange={(value) => setSelected(String(value))}
        className="gap-5 [&_input:not([type=checkbox])]:h-9 [&_[data-slot=select-trigger]]:h-9"
      >
        {!activeSection && (
          <TabsList
            variant="pill"
            aria-label="Application details"
            className="max-w-full flex-wrap"
          >
            {titles.map((title) => (
              <TabsTrigger key={title} value={title}>
                {title}
              </TabsTrigger>
            ))}
          </TabsList>
        )}
        {!companyOnly &&
          section(
            "Contact details",
            <InlineFieldCard>
              {(["name", "email", "phone"] as IntakeField[]).map((key) =>
                text(key),
              )}
            </InlineFieldCard>,
          )}
        {!companyOnly &&
          section(
            "Request details",
            <InlineFieldCard>
              {text("trigger")}
              {!extraRows.some(
                (row) => row.label === "Insurance requirements",
              ) && text("requirements", true)}
              {text("requestDetails", true)}
              {extraRows.map((row) => (
                <InlineFieldRow key={row.label} label={row.label}>
                  {row.value}
                </InlineFieldRow>
              ))}
            </InlineFieldCard>,
          )}
        {!companyOnly &&
          section(
            "Coverage Requested",
            <div className="space-y-5">
              {!onToolbarActions && (
                <div className="flex justify-end">{addCoverage}</div>
              )}
              {!details.coverages.length && (
                <InlineFieldCard>
                  <InlineFieldRow label="Coverage requested">
                    <div className="px-3 py-2 text-muted-foreground">
                      No coverage selected
                    </div>
                  </InlineFieldRow>
                </InlineFieldCard>
              )}
              {details.coverages.map((line, index) => {
                const one = { ...details, coverages: [line], coverageIndex: 0 };
                const change = (next: IntakeDetails) =>
                  onDetailsChange({
                    ...details,
                    coverages: details.coverages.map((current, i) =>
                      i === index ? next.coverages[0] : current,
                    ),
                  });
                return (
                  <InlineFieldCard
                    key={line.coverage}
                    title={coverageRequestLabel(line)}
                    actions={
                      <div className="flex items-center gap-2">
                        {line.coverage === "property" && (
                          <PillButton
                            variant="secondary"
                            size="default"
                            disabled={(line.properties?.length ?? 0) >= 30}
                            onClick={() =>
                              change({
                                ...one,
                                coverages: [
                                  {
                                    ...line,
                                    properties: [
                                      ...(line.properties ?? []),
                                      { address: {}, details: "" },
                                    ],
                                  },
                                ],
                              })
                            }
                          >
                            <Plus className="size-3.5" />
                            Add location
                          </PillButton>
                        )}
                        {line.coverage === "commercial_auto" && (
                          <PillButton
                            variant="secondary"
                            size="default"
                            disabled={(line.vehicles?.length ?? 0) >= 30}
                            onClick={() =>
                              change({
                                ...one,
                                coverages: [
                                  {
                                    ...line,
                                    vehicles: [
                                      ...(line.vehicles ?? []),
                                      {
                                        year: "",
                                        make: "",
                                        model: "",
                                        vin: "",
                                      },
                                    ],
                                  },
                                ],
                              })
                            }
                          >
                            <Plus className="size-3.5" />
                            Add vehicle
                          </PillButton>
                        )}
                        <RemoveButton
                          onClick={() =>
                            onDetailsChange({
                              ...details,
                              coverages: details.coverages.filter(
                                (_, i) => i !== index,
                              ),
                            })
                          }
                          label="Remove coverage"
                        />
                      </div>
                    }
                  >
                    <IntakeCoverageLimits details={one} onChange={change} />
                    <IntakeCoverageScope details={one} onChange={change} />
                    <InlineFieldRow label="Additional coverage requests">
                      <Textarea
                        rows={1}
                        aria-label={`${coverageRequestLabel(line)} additional coverage requests`}
                        placeholder="Not provided"
                        value={line.additionalCoverages ?? ""}
                        onChange={(event) =>
                          change({
                            ...one,
                            coverages: [
                              {
                                ...line,
                                additionalCoverages: event.target.value,
                              },
                            ],
                          })
                        }
                      />
                    </InlineFieldRow>
                  </InlineFieldCard>
                );
              })}
              {(["limitsNote", "scopeNote", "additionalNote"] as const).some(
                (key) => details[key]?.trim(),
              ) && (
                <InlineFieldCard title="Coverage notes">
                  {(["limitsNote", "scopeNote", "additionalNote"] as const).map(
                    (key, index) => (
                      <InlineFieldRow
                        key={key}
                        label={
                          [
                            "Other limits or deductibles",
                            "Scope notes",
                            "Additional coverage notes",
                          ][index]
                        }
                      >
                        <Textarea
                          aria-label={
                            [
                              "Other limits or deductibles",
                              "Scope notes",
                              "Additional coverage notes",
                            ][index]
                          }
                          rows={1}
                          value={details[key] || ""}
                          onChange={(event) =>
                            onDetailsChange({
                              ...details,
                              [key]: event.target.value,
                            })
                          }
                        />
                      </InlineFieldRow>
                    ),
                  )}
                </InlineFieldCard>
              )}
            </div>,
          )}
        {section(
          "Business details",
          <InlineFieldCard>
            {(
              [
                "legalName",
                "website",
                "dba",
                "entityType",
                "formation",
                ...(/^(?:united states(?: of america)?|u\.?s\.?a?\.?|us)$/i.test(
                  formationCountry.trim(),
                )
                  ? ["fein"]
                  : []),
                ...(/^(?:canada|ca)$/i.test(formationCountry.trim())
                  ? ["businessNumber"]
                  : []),
                "industry",
                "industryVertical",
                "yearStarted",
                "fullTime",
                "partTime",
                "contractors",
              ] as IntakeField[]
            ).map((key) => (key === "formation" ? formationRows : text(key)))}
            {text("description", true)}
          </InlineFieldCard>,
        )}
        {section(
          "Addresses",
          <InlineFieldCard>
            <InlineFieldRow label="Registered business address">
              <IntakeRegistration
                details={details}
                onChange={onDetailsChange}
              />
            </InlineFieldRow>
            <InlineFieldRow label="Mailing address">
              <IntakeMailingAddress
                details={{ ...details, mailingAddressStep: true }}
                onChange={onDetailsChange}
              />
            </InlineFieldRow>
          </InlineFieldCard>,
        )}
        {section(
          "Related legal entities",
          <IntakeRelatedEntities
            details={details}
            onChange={onDetailsChange}
          />,
        )}
        {section(
          "Revenue",
          <InlineFieldCard>
            <IntakeRevenueFields
              details={{ ...details, revenueStep: "annual" }}
              onChange={onDetailsChange}
            />
            <IntakeRevenueFields
              details={{ ...details, revenueStep: "projected" }}
              onChange={onDetailsChange}
            />
          </InlineFieldCard>,
        )}
        {section(
          "Locations",
          <IntakeLocations
            details={details}
            onChange={onDetailsChange}
            defaultActivities={answers.description}
          />,
        )}
        {!companyOnly &&
          section(
            "Insurance history",
            <InlineFieldCard>
              {text("currentInsurance")}
              {text("currentInsuranceDetails", true)}
              {text("claims", true)}
              {text("cancellations", true)}
              {text("changes", true)}
              {extraRows.map((row) => (
                <InlineFieldRow key={row.label} label={row.label}>
                  {row.value}
                </InlineFieldRow>
              ))}
            </InlineFieldCard>,
          )}
      </Tabs>
    </InlineFieldsContext.Provider>
  );
}
