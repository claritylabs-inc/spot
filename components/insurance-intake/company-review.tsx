"use client";
import { EmptyStateCard } from "@claritylabs-inc/ui/components/empty-state-card";

import { createContext, useContext, type ReactNode } from "react";
export const IntakeReviewCompact = createContext(false);
import dayjs from "dayjs";
import { vehicleMakeLabel } from "@/lib/vehicle-display";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
} from "@claritylabs-inc/ui/components/operational-panel";
import {
  INTAKE_FIELDS,
  type IntakeAnswers,
  type IntakeField,
} from "@/lib/insurance-intake";
import {
  coverageOption,
  coverageRequestLabel,
} from "@/lib/insurance-intake-details";
import type {
  IntakeAddress,
  IntakeDetails,
} from "@/lib/insurance-intake-details";
import { typeStyle } from "@/lib/typography";

export function IntakeReviewRows({
  rows,
  emptyTitle = "No details added yet",
  layout = "responsive",
}: {
  rows: { label: string; value?: ReactNode }[];
  emptyTitle?: string;
  layout?: "responsive" | "stacked";
}) {
  const compact = useContext(IntakeReviewCompact);
  const bodyRole = compact ? "body.default" : "body.root";
  if (!rows.length)
    return (
      <EmptyStateCard
        title={emptyTitle}
        description="Use Edit to add what you know. You can come back later."
      />
    );
  return (
    <OperationalLabelValueList
      className={layout === "responsive" ? `[&>dl>div]:grid-cols-1 [&>dl>div]:gap-2 sm:[&>dl>div]:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] sm:[&>dl>div]:gap-4 [&_dd]:min-w-0 [&_dd]:text-left sm:[&_dd]:text-right [&>dl>div:has([data-review-prose])]:grid-cols-1 [&>dl>div:has([data-review-prose])]:gap-y-1 [&>dl>div:has([data-review-prose])_dd]:text-left` : undefined}
    >
      {rows.map(({ label, value }) => (
        <OperationalLabelValueRow
          key={label}
          layout={layout}
          label={<span className={typeStyle(bodyRole)}>{label}</span>}
          value={
            <div
              className={`min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${typeStyle(bodyRole)}`}
            >
              {typeof value === "string" && value.length > 160 ? (
                <p data-review-prose className="text-left text-wrap-pretty">
                  {value}
                </p>
              ) : (
                value || "Not provided"
              )}
            </div>
          }
        />
      ))}
    </OperationalLabelValueList>
  );
}
function Group({
  title,
  rows,
  hideHeading = false,
}: {
  title: string;
  hideHeading?: boolean;
  rows: { label: string; value?: ReactNode }[];
}) {
  return (
    <section className="space-y-3" aria-label={title}>
      {!hideHeading && <h3 className={typeStyle("heading.item")}>{title}</h3>}
      <IntakeReviewRows rows={rows} emptyTitle={`No ${title.toLowerCase()} added yet`} />
    </section>
  );
}
function Address({
  address,
  fallback,
}: {
  address?: IntakeAddress;
  fallback?: string;
}) {
  const structured =
    address &&
    (address.city || address.state || address.zip || address.country);
  const lines = structured
    ? [
        address.street1,
        address.street2,
        [address.city, [address.state, address.zip].filter(Boolean).join(" ")]
          .filter(Boolean)
          .join(", "),
        address.country,
      ]
    : (address?.formatted || address?.street1 || fallback || "").split(/,\s*/);
  const nonempty = lines.filter((line): line is string => !!line?.trim());
  return nonempty.length ? (
    <address className={typeStyle("body.default")}>
      {nonempty.map((line, index) => (
        <div key={index}>{line}</div>
      ))}
    </address>
  ) : (
    <>Not provided</>
  );
}
function revenueRow(
  label: string,
  amount: string | undefined,
  period: string | undefined,
  legacy: string | undefined,
) {
  const raw = amount || legacy?.match(/^\s*\$?([\d,]+(?:\.\d{1,2})?)/)?.[1];
  if (!raw) return { label, value: legacy || "Not provided" };
  const number = Number(raw.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(number))
    return { label, value: legacy || "Not provided" };
  const context = period || legacy || "";
  const year =
    context.match(/\b(?:19|20)\d{2}\b/)?.[0] ||
    (/Last fiscal year/i.test(context)
      ? String(dayjs().year() - 1)
      : /This fiscal year/i.test(context)
        ? String(dayjs().year())
        : "");
  const suffix =
    year ||
    (/trailing 12 months/i.test(context)
      ? "Trailing 12 months"
      : /next 12 months/i.test(context)
        ? "Next 12 months"
        : "");
  return {
    label: `${label}${suffix ? ` (${suffix})` : ""}`,
    value: `$${number.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
  };
}
export function IntakeCompanyReview({
  answers,
  details,
  hideHeading = false,
  section,
}: {
  answers: IntakeAnswers;
  details: IntakeDetails;
  hideHeading?: boolean;
  section?: string;
}) {
  const fields = (keys: IntakeField[]) =>
    keys.map((key) => ({ label: INTAKE_FIELDS[key], value: answers[key] }));
  const entities =
    details.hasRelatedEntities === "no"
      ? "No related legal entities"
      : details.relatedEntities
          .filter((entity) => entity.legalName.trim())
          .map(
            (entity) =>
              `${entity.legalName}${entity.relationship ? ` (${entity.relationship})` : ""}`,
          )
          .join("\n") ||
        answers.relatedEntities
          ?.split("\n")
          .map((line) =>
            line
              .replace(/;\s*(include|exclude|unsure)\s*$/i, "")
              .replace(/\s+—\s+(.+)$/, " ($1)"),
          )
          .join("\n");
  const country = details.registrationCountry || "United States";
  return (
    <div data-review-content className="space-y-6">
      {(!section || section === "Business details") && (
        <Group
          title="Business details"
          hideHeading={hideHeading}
          rows={fields([
            "legalName",
            "website",
            "dba",
            "entityType",
            "formation",
            ...(country === "United States"
              ? ["fein" as const]
              : country === "Canada"
                ? ["businessNumber" as const]
                : []),
          ])}
        />
      )}
      {(!section || section === "Addresses") && (
        <Group
          title="Addresses"
          rows={[
            {
              label: "Registered business address",
              value: (
                <Address
                  address={details.registrationAddress}
                  fallback={answers.registeredAddress}
                />
              ),
            },
            {
              label: "Mailing address",
              value: (
                <Address
                  address={details.mailingAddress}
                  fallback={answers.mailingAddress}
                />
              ),
            },
          ]}
        />
      )}
      {(!section || section === "Business details") && (
        <Group
          title="Business activities"
          rows={fields([
            "description",
            "yearStarted",
            "industry",
            "industryVertical",
          ])}
        />
      )}
      {(!section || section === "Related legal entities") && (
        <section className="space-y-3" aria-label="Related legal entities">
          <h3 className={`${typeStyle("body.default")} text-muted-foreground`}>
            Related legal entities
          </h3>
          {details.hasRelatedEntities !== "no" &&
          details.relatedEntities.some((entity) => entity.legalName.trim()) ? (
            details.relatedEntities
              .filter((entity) => entity.legalName.trim())
              .map((entity, index) => (
                <IntakeReviewRows
                  key={index}
                  rows={[
                    { label: "Name", value: entity.legalName },
                    { label: "Relationship", value: entity.relationship },
                    {
                      label: "Included in insurance",
                      value:
                        entity.insured === "include"
                          ? "Yes"
                          : entity.insured === "exclude"
                            ? "No"
                            : entity.insured === "unsure"
                              ? "Not sure"
                              : "Not specified",
                    },
                  ]}
                />
              ))
          ) : (
            <p className={typeStyle("body.root")}>
              {entities || "Not provided"}
            </p>
          )}
        </section>
      )}
      {(!section || section === "Business details") && (
        <Group
          title="Staff"
          rows={fields(["fullTime", "partTime", "contractors"])}
        />
      )}
      {(!section || section === "Revenue") && (
        <Group
          title="Revenue"
          rows={[
            revenueRow(
              "Annual revenue",
              details.revenue?.annualAmount,
              details.revenue?.annualPeriod,
              answers.trailingRevenue,
            ),
            revenueRow(
              "Projected revenue",
              details.revenue?.projectedAmount,
              details.revenue?.projectedPeriod,
              answers.projectedRevenue,
            ),
          ]}
        />
      )}
      {(!section || section === "Locations") && (
        <section className="space-y-4" aria-label="Business locations">
          <h2 className={typeStyle("heading.item")}>Locations</h2>
          {details.locations.length ? (
            details.locations.map((location, index) => (
              <section key={index} className="space-y-3">
                <IntakeReviewRows
                  rows={[
                    {
                      label: "Name",
                      value: location.name?.trim() || `Location ${index + 1}`,
                    },
                    {
                      label: "Address",
                      value: <Address address={location.address} />,
                    },
                    { label: "Activities", value: location.details },
                    {
                      label: "Owned or leased",
                      value:
                        location.ownership === "owned"
                          ? "Owned"
                          : location.ownership === "leased"
                            ? "Leased"
                            : "Not provided",
                    },
                    { label: "Staff", value: location.staff || "Not provided" },
                  ]}
                />
              </section>
            ))
          ) : (
            <IntakeReviewRows rows={[{ label: "Locations", value: answers.locations }]} />
          )}
        </section>
      )}
    </div>
  );
}

export function IntakeRequestReview({
  answers,
  details,
  section,
  hideHeading = false,
  extraRows = [],
}: {
  answers: IntakeAnswers;
  details: IntakeDetails;
  hideHeading?: boolean;
  extraRows?: { label: string; value?: ReactNode }[];
  section?: "request" | "coverage" | "history" | "contact";
}) {
  const rows = (keys: IntakeField[]) =>
    keys
      .filter((key) => answers[key]?.trim())
      .map((key) => ({
        label:
          key === "currentInsurance" ? "Current insurance" : INTAKE_FIELDS[key],
        value:
          key === "effectiveDate" && dayjs(answers[key]).isValid()
            ? dayjs(answers[key]).format("MMMM D, YYYY")
            : answers[key],
      }));
  const money = (value: string) =>
    /^\$?[\d,]+(?:\.\d{1,2})?$/.test(value.trim())
      ? `$${Number(value.replace(/[$,]/g, "")).toLocaleString("en-US", { maximumFractionDigits: 2 })}`
      : value;
  return (
    <div className="space-y-6">
      {(!section || section === "request") && (
        <Group
          title="Request details"
          hideHeading={hideHeading}
          rows={[
            ...rows([
              "trigger",
              "effectiveDate",
              "timingUnknown",
              "requirements",
              "requestDetails",
            ]).filter(
              (row) => !extraRows.some((extra) => extra.label === row.label),
            ),
            ...extraRows,
          ]}
        />
      )}
      {(!section || section === "coverage") && (
        <section className="space-y-3" aria-label="Requested coverages">
          {!hideHeading && (
            <h3 className={typeStyle("heading.item")}>Requested coverages</h3>
          )}
          {details.coverages.length ? (
            details.coverages.map((line, index) => {
              const option = coverageOption(line.coverage);
              return (
                <IntakeReviewRows
                  key={index}
                  rows={[
                    {
                      label: "Coverage Requested",
                      value: coverageRequestLabel(line),
                    },
                    ...option.limits
                      .filter((limit) => limit.key !== "coverage_description")
                      .map((limit) => ({
                        label: limit.label,
                        value: line.limits[limit.key]
                          ? money(line.limits[limit.key])
                          : "Not provided",
                      })),
                    ...(line.additionalCoverages
                      ? [
                          {
                            label: "Additional coverages",
                            value: line.additionalCoverages,
                          },
                        ]
                      : []),
                    ...(line.scopeDescription
                      ? [
                          {
                            label: "What to insure",
                            value: line.scopeDescription,
                          },
                        ]
                      : []),
                    ...(line.properties || []).map((location, i) => ({
                      label: location.name?.trim() || `Property ${i + 1}`,
                      value: (
                        <div className="space-y-3 pt-1">
                          <Address address={location.address} />
                          {location.details?.trim() && (
                            <p
                              className="line-clamp-2 whitespace-normal"
                              title={location.details}
                            >
                              {location.details}
                            </p>
                          )}
                        </div>
                      ),
                    })),
                    ...(line.vehicles || []).map((vehicle, i) => ({
                      label: `Vehicle ${i + 1}`,
                      value: (
                        <>
                          <div>
                            {[
                              vehicle.year,
                              vehicleMakeLabel(vehicle.make),
                              vehicle.model,
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          </div>
                          {vehicle.vin && <div>VIN # {vehicle.vin}</div>}
                        </>
                      ),
                    })),
                  ]}
                />
              );
            })
          ) : (
            <IntakeReviewRows rows={rows(["coverage", "limits"])} />
          )}
          {(details.limitsNote ||
            details.additionalNote ||
            details.scopeNote ||
            answers.separateQuotes) && (
            <IntakeReviewRows
              rows={[
                {
                  label: "Other limits or deductibles",
                  value: details.limitsNote,
                },
                {
                  label: "Additional requests",
                  value: details.additionalNote || answers.separateQuotes,
                },
                { label: "Scope notes", value: details.scopeNote },
              ].filter((row) => !!row.value)}
            />
          )}
        </section>
      )}
      {(!section || section === "history") && (
        <Group
          title="Insurance history"
          hideHeading={hideHeading}
          rows={[
            ...rows(["currentInsurance", "claims", "cancellations"]),
            ...extraRows,
          ]}
        />
      )}
      {(!section || section === "contact") && (
        <Group
          title="Contact details"
          hideHeading={hideHeading}
          rows={rows(["name", "email", "phone"])}
        />
      )}
    </div>
  );
}

export function IntakeSavedBusinessSummary({
  answers,
  details,
}: {
  answers: IntakeAnswers;
  details: IntakeDetails;
}) {
  return (
    <IntakeReviewRows
      rows={[
        { label: "Company legal name", value: answers.legalName },
        ...(answers.website
          ? [{ label: "Website", value: answers.website }]
          : []),
        ...(answers.entityType
          ? [{ label: "Entity type", value: answers.entityType }]
          : []),
        ...(answers.industry
          ? [{ label: "Industry", value: answers.industry }]
          : []),
        {
          label: "Mailing address",
          value: (
            <Address
              address={details.mailingAddress}
              fallback={answers.mailingAddress}
            />
          ),
        },
      ]}
    />
  );
}
