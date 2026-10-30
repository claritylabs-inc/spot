"use client";
import { PhoneInput } from "@claritylabs-inc/ui/components/marketing/phone-input";
import { WebsiteInput } from "@claritylabs-inc/ui/components/website-input";
import type { IntakeFollowupAnswer } from "@/lib/intake-followups";
import {
  InlineFieldsContext,
  InlineFieldCard,
  InlineFieldRow,
} from "@/components/ui/inline-fields";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Tabs,
  TabsContent,
} from "@claritylabs-inc/ui/components/tabs";
import { cn } from "@/lib/utils";

import { SearchableSelect } from "@claritylabs-inc/ui/components/searchable-select";
import { INDUSTRIES } from "@/lib/insurance-intake-industries";
import { Input } from "@claritylabs-inc/ui/components/input";
import { MapboxPlaceSelect } from "@/components/ui/mapbox-place-select";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import {
  CURRENT_INSURANCE_CHOICES,
  ENTITY_TYPES,
  INTAKE_FIELDS,
  type IntakeAnswers,
  type IntakeField,
} from "@/lib/insurance-intake";
import { type IntakeDetails } from "@/lib/insurance-intake-details";
import { typeStyle } from "@/lib/typography";
import {
  IntakeRegistration,
  IntakeMailingAddress,
  IntakeLocations,
  IntakeRelatedEntities,
  IntakeRevenueFields,
} from "./details-fields";
import { IntakeFollowupRows } from "./application-quote-fields";
import {
  IntakeCoveragePanel,
  IntakeCoverageSection,
  type CoveragePanelTarget,
} from "./application-coverage-section";
import {
  coverageSectionKey,
  OTHER_COVERAGE_SECTION,
} from "./application-section-nav";
import {
  intakeFollowupAnswerRows,
  intakeQuoteSections,
} from "@/lib/intake-application";

const COUNTRY_CODES: Record<string, string> = {
  "United States": "us",
  Canada: "ca",
};

/** The operator edits the same typed fields used by the customer questionnaire. */
export function IntakeApplicationFields({
  companyOnly = false,
  companyGroup = false,
  activeSection,
  onRemoveCoverage,
  onRightPanel,
  requestCard,
  extraRows = [],
  answers,
  details,
  onAnswersChange,
  onDetailsChange,
}: {
  companyOnly?: boolean;
  companyGroup?: boolean;
  activeSection?: string;
  onRemoveCoverage?: (section: string) => void;
  onRightPanel?: (node: React.ReactNode) => void;
  requestCard?: React.ReactNode;
  extraRows?: { label: string; value?: React.ReactNode }[];
  answers: IntakeAnswers;
  details: IntakeDetails;
  onAnswersChange: (answers: IntakeAnswers) => void;
  onDetailsChange: (details: IntakeDetails) => void;
}) {
  const titles = [
    ...(!companyOnly ? ["Contact details", "Request details"] : []),
    "Business details",
    "Addresses",
    "Related legal entities",
    "Revenue",
    "Locations",
    ...(!companyOnly
      ? ["Insurance history", ...intakeQuoteSections(details, true)]
      : []),
  ];
  const visible = activeSection ?? titles[0];
  // Panels edit items of the visible coverage; leaving the section closes them.
  const [panelState, setPanelState] = useState<{
    section?: string;
    target: CoveragePanelTarget;
  } | null>(null);
  const panel =
    panelState && panelState.section === activeSection
      ? panelState.target
      : null;
  const openPanel = (target: CoveragePanelTarget) =>
    setPanelState({ section: activeSection, target });
  const panelShown = useRef(false);
  const panelMounts = useRef(0);
  const closePanel = useCallback(() => {
    setPanelState(null);
    panelShown.current = false;
    onRightPanel?.(null);
  }, [onRightPanel]);
  // The panel renders outside this tree; re-send it so it edits current details.
  useEffect(() => {
    if (!onRightPanel) return;
    if (!panel) {
      if (panelShown.current) onRightPanel(null);
      panelShown.current = false;
      return;
    }
    panelShown.current = true;
    onRightPanel(
      <PanelLifecycle
        onMount={() => {
          panelMounts.current += 1;
        }}
        onUnmount={() => {
          panelMounts.current -= 1;
          // The shell may remount the panel when its container appears; only
          // an unmount with no remaining mount means another panel replaced it.
          queueMicrotask(() => {
            if (panelMounts.current === 0) setPanelState(null);
          });
        }}
      >
        <IntakeCoveragePanel
          answers={answers}
          details={details}
          onDetailsChange={onDetailsChange}
          target={panel}
          onClose={closePanel}
        />
      </PanelLifecycle>,
    );
  }, [panel, answers, details, onDetailsChange, onRightPanel, closePanel]);

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
  const businessName = answers.dba || answers.legalName;
  const followupRows = (rows: IntakeFollowupAnswer[]) => (
    <IntakeFollowupRows
      rows={rows}
      details={details}
      businessName={businessName}
      industry={answers.industry}
      onChange={onDetailsChange}
    />
  );
  const enumChoices = (key: IntakeField): string[] | null => {
    if (key === "entityType") return [...ENTITY_TYPES];
    if (key === "currentInsurance") return [...CURRENT_INSURANCE_CHOICES];
    if (key === "industry")
      return [...INDUSTRIES.map((industry) => industry.label), "I'm not sure"];
    if (key === "industryVertical") {
      const verticals = INDUSTRIES.find(
        (industry) => industry.label === answers.industry,
      )?.verticals;
      return verticals?.length
        ? [...verticals.map((vertical) => vertical.label), "I'm not sure"]
        : null;
    }
    return null;
  };
  const text = (key: IntakeField, multiline = false) => (
    <InlineFieldRow key={key} label={INTAKE_FIELDS[key]}>
      {key === "website" ? (
        <WebsiteInput
          aria-label={INTAKE_FIELDS[key]}
          value={answers[key] ?? ""}
          onChange={(website) => onAnswersChange({ ...answers, website })}
        />
      ) : enumChoices(key) ? (
        <SearchableSelect
          ariaLabel={INTAKE_FIELDS[key]}
          value={answers[key] ?? ""}
          options={enumChoices(key)!.map((choice) => ({
            value: choice,
            label: choice,
          }))}
          placeholder="Not provided"
          onChange={(value) =>
            onAnswersChange({
              ...answers,
              [key]: value,
              ...(key === "industry" ? { industryVertical: "" } : {}),
            })
          }
        />
      ) : key === "phone" ? (
        <PhoneInput
          aria-label={INTAKE_FIELDS[key]}
          value={answers[key] || undefined}
          defaultCountry="US"
          autoComplete="tel"
          onChange={(phone) => onAnswersChange({ ...answers, phone: phone ?? "" })}
        />
      ) : multiline ? (
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
          type={key === "email" ? "email" : "text"}
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
      <fieldset
        aria-label={title === OTHER_COVERAGE_SECTION ? "Coverage notes" : title}
        className="min-w-0 space-y-5"
      >
        {grouped && title !== "Business details" && (
          <legend className={typeStyle("heading.item")}>{title}</legend>
        )}
        {content}
      </fieldset>
    );
    return activeSection ? (
      <div className="space-y-5">{fields}</div>
    ) : (
      <TabsContent value={title} className="pt-4">
        {fields}
      </TabsContent>
    );
  };
  const sections = (
    <InlineFieldsContext.Provider value={true}>
      <Tabs
        data-operator-inline-fields
        value={visible}
        className={cn(
          "[&_input:not([type=checkbox])]:h-9 [&_[data-slot=select-trigger]]:h-9",
          activeSection ? "gap-5" : "gap-0",
        )}
      >
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
            <>
              {requestCard}
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
              </InlineFieldCard>
            </>,
          )}
        {!companyOnly &&
          visible.startsWith("coverage:") &&
          visible !== OTHER_COVERAGE_SECTION &&
          (() => {
            const coverageIndex = details.coverages.findIndex(
              (line) => coverageSectionKey(line.coverage) === visible,
            );
            return coverageIndex < 0 ? null : (
              <IntakeCoverageSection
                answers={answers}
                details={details}
                onDetailsChange={onDetailsChange}
                coverageIndex={coverageIndex}
                onRemove={() => onRemoveCoverage?.(visible)}
                panel={panel}
                onOpenPanel={openPanel}
              />
            );
          })()}
        {!companyOnly &&
          section(
            OTHER_COVERAGE_SECTION,
            <div className="space-y-5">
              {(["limitsNote", "scopeNote", "additionalNote"] as const).some(
                (key) => details[key]?.trim(),
              ) && (
                <InlineFieldCard>
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
                "dba",
                "legalName",
                "website",
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
        {!companyOnly &&
          section(
            "Follow-up answers",
            <InlineFieldCard wideLabels>
              {followupRows(intakeFollowupAnswerRows(answers, details))}
            </InlineFieldCard>,
          )}
      </Tabs>
    </InlineFieldsContext.Provider>
  );
  return sections;
}

/** Reports mounts so the owner notices when another panel replaces this one. */
function PanelLifecycle({
  onMount,
  onUnmount,
  children,
}: {
  onMount: () => void;
  onUnmount: () => void;
  children: React.ReactNode;
}) {
  const callbacks = useRef({ onMount, onUnmount });
  useEffect(() => {
    callbacks.current = { onMount, onUnmount };
  });
  useEffect(() => {
    const current = callbacks.current;
    current.onMount();
    return () => current.onUnmount();
  }, []);
  return children;
}
