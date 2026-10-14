"use client";
import dayjs from "dayjs";
import { hasIntakeRequirements } from "@/lib/insurance-intake";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Card } from "@claritylabs-inc/ui/components/card";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import { Button } from "@claritylabs-inc/ui/components/button";
import Link from "next/link";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
} from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { IntakeFrame } from "./frame";
import { typeStyle } from "@/lib/typography";
import {
  coverageOption,
  validCoverageLimit,
  validCoverageScope,
} from "@/lib/insurance-intake-details";
import { ChevronRight } from "lucide-react";

const sections = [
  { title: "Your request", step: 1 },
  { title: "Coverage", step: 6 },
  { title: "Your business", step: 10 },
  { title: "Insurance history", step: 20 },
  { title: "Supporting documents", step: 21 },
];
export function IntakeTracking({
  data,
}: {
  data: FunctionReturnType<typeof api.requestIntake.get>;
}) {
  const drafts = useQuery(api.requestIntake.drafts, {});
  const submitted = useQuery(api.requestIntake.submitted, {});
  const multipleRequests =
    new Set([
      ...(drafts ?? []).map((request) => request.id),
      ...(submitted ?? []).map((request) => request.id),
    ]).size > 1;
  const a = data.answers;
  const has = (...keys: (keyof typeof a)[]) =>
    keys.every((key) => !!a[key]?.trim());
  const file = (category: string) =>
    data.files.some((item) => item.category === category);
  const skipped = (steps: number[]) =>
    data.skippedSteps.some((step) => steps.includes(step));
  const hasRequirements = hasIntakeRequirements(a);
  const hasClaims =
    !!a.claims && !/^(none|no|0|not sure|I'm not sure)$/i.test(a.claims.trim());
  const complete = [
    has("trigger", "effectiveDate", "requestDetails") &&
      (!hasRequirements || file("requirements") || !!a.requirements?.trim()) &&
      !skipped([4, 5]),
    has("coverage") &&
      data.details.coverages.every((line) =>
        validCoverageScope(line, data.details.scopeNote),
      ) &&
      data.details.coverages.every(
        (line) => !!line.additionalCoverages?.trim(),
      ) &&
      data.details.coverages.length > 0 &&
      data.details.coverages.every((line) =>
        coverageOption(line.coverage).limits.every((limit) =>
          validCoverageLimit(limit.key, line.limits[limit.key]),
        ),
      ) &&
      !skipped([8]),
    has(
      "legalName",
      "website",
      "dba",
      "entityType",
      "formation",
      "mailingAddress",
      "description",
      "yearStarted",
      "fullTime",
      "partTime",
      "contractors",
      "trailingRevenue",
      "projectedRevenue",
      "locations",
      "industry",
    ) &&
      ((data.details.registrationCountry || "United States") === "United States"
        ? !!a.fein
        : data.details.registrationCountry === "Canada"
          ? !!a.businessNumber
          : true) &&
      !!a.relatedEntities &&
      a.companyConfirmed === "yes" &&
      !skipped([11, 13, 14, 15, 17, 18]),
    has("currentInsurance", "claims", "cancellations", "changes") &&
      (a.currentInsurance !== "Yes" ||
        (has("currentInsuranceDetails") && file("policy"))) &&
      (!hasClaims || file("loss_runs")) &&
      !skipped([21, 22, 23, 24, 25, 26]),
    data.files.length > 0 &&
      (!hasRequirements || file("requirements") || !!a.requirements?.trim()) &&
      (a.currentInsurance !== "Yes" || file("policy")) &&
      (!hasClaims || file("loss_runs")) &&
      !skipped([4, 21, 24]),
  ];
  return (
    <IntakeFrame
      section={4}
      footer={
        <>
          {multipleRequests ? (
            <PillButton variant="ghost" href="/signup">
              View all requests
            </PillButton>
          ) : (
            <span />
          )}
          <PillButton size="large" disabled>
            Submit
          </PillButton>
        </>
      }
    >
      <h1 className={`text-wrap-pretty ${typeStyle("heading.display")}`}>
        Your insurance application
      </h1>
      <div className="mt-8 space-y-5">
        <>
          <OperationalLabelValueList className="[&>dl>div]:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] [&>dl>div]:gap-4 [&_dd]:text-right">
            <OperationalLabelValueRow
              align="right"
              label={<span className={typeStyle("body.root")}>Business</span>}
              value={
                <span className={typeStyle("body.root")}>
                  {data.answers.legalName}
                </span>
              }
            />
            <OperationalLabelValueRow
              align="right"
              label={<span className={typeStyle("body.root")}>Coverage</span>}
              value={
                <span className={typeStyle("body.root")}>
                  {data.answers.coverage}
                </span>
              }
            />
            <OperationalLabelValueRow
              align="right"
              label={
                <span className={typeStyle("body.root")}>Effective date</span>
              }
              value={
                <span className={typeStyle("body.root")}>
                  {data.answers.effectiveDate
                    ? dayjs(data.answers.effectiveDate).format("MMMM D, YYYY")
                    : "To be confirmed"}
                </span>
              }
            />
            <OperationalLabelValueRow
              align="right"
              label={<span className={typeStyle("body.root")}>Submitted</span>}
              value={
                <span className={typeStyle("body.root")}>
                  {dayjs(data.submittedAt).format("MMMM D, YYYY")}
                </span>
              }
            />
          </OperationalLabelValueList>
          {sections.map((item, index) => (
            <Card key={item.title} className="py-0">
              <Button
                variant="ghost"
                className="h-auto w-full justify-between gap-4 px-5 py-5 text-left"
                render={
                  <Link
                    href={`/intake?request=${data.requestId}&step=${item.step}&section=${item.step}`}
                  />
                }
              >
                <span className={typeStyle("body.root")}>{item.title}</span>
                <span className="flex items-center gap-3">
                  <StatusTag tone={complete[index] ? "success" : "neutral"}>
                    {complete[index]
                      ? "Complete"
                      : data.files.length && index === 4
                        ? `${data.files.length} document${data.files.length === 1 ? "" : "s"}`
                        : "Needs details"}
                  </StatusTag>
                  <ChevronRight className="size-4" />
                </span>
              </Button>
            </Card>
          ))}
        </>
      </div>
    </IntakeFrame>
  );
}
