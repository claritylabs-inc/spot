"use client";
import { IntakeAutoQuoteReview } from "./auto-quote-fields";
import { IntakeDriverReview } from "./driver-fields";
import { hasCommercialAuto } from "@/lib/intake-drivers";
import { followupQuestionVisible } from "@/lib/intake-followups";
import { IntakeFollowupReview } from "./followup-review";
import { IntakePremiumEstimate } from "./premium-estimate";
import { ReviewSection } from "./review-section";
import { ChevronDown } from "lucide-react";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
} from "@claritylabs-inc/ui/components/operational-panel";
import { IntakeReviewChanges } from "./review-changes";
import { useEffect, type ReactNode, type MouseEvent } from "react";
import { IntakeCompanyReview, IntakeRequestReview } from "./company-review";
import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import { PillButton } from "@/components/ui/pill-button";
import { IntakeFrame } from "./frame";
import { useSearchParams } from "next/navigation";
import { withQuoteProvider } from "@/lib/quote-provider";
import { typeStyle } from "@/lib/typography";
import {
  type IntakeDetails,
  coverageOption,
  validCoverageLimit,
  validCoverageScope,
} from "@/lib/insurance-intake-details";

const sections = [
  { title: "Your request", step: 1, index: 0 },
  { title: "Your business", step: 10, index: 2 },
  { title: "Coverage", step: 6, index: 1 },
  { title: "Insurance history", step: 20, index: 3 },
];
export function IntakeTracking({
  data,
  banner,
  footer,
  onEdit,
  confirmation,
}: {
  data: Omit<FunctionReturnType<typeof api.requestIntake.get>, "details"> & {
    details: IntakeDetails;
  };
  confirmation?: ReactNode;
  banner?: ReactNode;
  footer?: ReactNode;
  onEdit?: (step: number) => void;
}) {
  const params = useSearchParams();
  useEffect(() => {
    if (!data.submitted) return;
    const key = `spot:intake-submitted-scroll:${data.requestId}`;
    try {
      if (sessionStorage.getItem(key) !== "top") return;
    } catch {
      return;
    }
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "instant" });
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Scroll already completed. */
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [data.submitted, data.requestId]);
  const drafts = useQuery(api.requestIntake.drafts, {});
  const submitted = useQuery(api.requestIntake.submitted, {});
  const multipleRequests =
    new Set([
      ...(drafts ?? []).map((request) => request.id),
      ...(submitted ?? []).map((request) => request.id),
    ]).size > 1;
  const a = data.answers;
  const isSavings = a.intakeGoal === "savings";
  const preparePremiumEstimate = useMutation(api.requestIntake.preparePremiumEstimate);
  useEffect(() => {
    const preferDraft=!data.submitted || data.hasUnsubmittedChanges;
    if (!isSavings && (!data.premiumEstimate || (preferDraft && data.premiumEstimate.contentHash!==data.premiumDraftContentHash)))
      void preparePremiumEstimate({requestId:data.requestId,preferDraft}).catch(() => undefined);
  }, [data.submitted, data.hasUnsubmittedChanges, data.requestId, data.premiumEstimate, data.premiumDraftContentHash, isSavings, preparePremiumEstimate]);
  const has = (...keys: (keyof typeof a)[]) =>
    keys.every((key) => !!a[key]?.trim());
  const complete = [
    isSavings ? has("trigger") : has("trigger", "effectiveDate"),
    has("coverage") &&
      data.details.coverages.length > 0 &&
      data.details.coverages.every(
        (line) =>
          validCoverageScope(line, data.details.scopeNote) &&
          coverageOption(line.coverage).limits.every((limit) =>
            validCoverageLimit(limit.key, line.limits[limit.key]),
          ),
      ),
    has(
      "legalName",
      "entityType",
      "mailingAddress",
      "description",
      "industry",
    ),
    has("currentInsurance"),
  ];
  const documentRow = (
    category: "requirements" | "policy" | "loss_runs" | "supporting",
    label: string,
  ) => ({
    label,
    value: (
      <div className="space-y-2">
        {category === "requirements" && a.requirements?.trim() && (
          <p>{a.requirements}</p>
        )}
        {data.files
          .filter((file) => file.category === category)
          .map((file) => (
            <a
              key={file.id}
              href={file.url ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="block underline"
            >
              {file.name}
            </a>
          ))}
        {!data.files.some((file) => file.category === category) &&
          !(category === "requirements" && a.requirements?.trim()) &&
          "Not added"}
      </div>
    ),
  });
  return (
    <IntakeFrame
      showSteps={!isSavings}
      section={6}
      footer={
        footer ?? (
          <>
            {multipleRequests ? (
              <PillButton variant="ghost" href="/signup">
                View all requests
              </PillButton>
            ) : (
              <span />
            )}
            <PillButton size="large" disabled>
              Resubmit
            </PillButton>
          </>
        )
      }
    >
      <h1
        className={`text-wrap-pretty ${typeStyle("heading.display")}`}
        style={{ textWrap: "pretty" }}
      >
        {isSavings
          ? data.submitted
            ? "We have your policies"
            : "Review your policies and business details"
          : data.submitted
            ? "Your insurance application has been submitted"
            : "Review your insurance application before submitting"}
      </h1>
      {data.submitted && (
        <p className={`mt-3 text-muted-foreground ${typeStyle("body.root")}`}>
          {isSavings
            ? "We’ll review your current coverage and get back to you with potentially better quotes."
            : "We’ll have quotes ready for you within 24 hours"}
        </p>
      )}
      {data.submitted && !isSavings && !data.premiumEstimate?.provisional && <IntakePremiumEstimate estimate={data.premiumEstimate}/>}
      <div className="mt-8 space-y-2">
        {banner}
        <>
          {[
            { title: "Contact details", step: 0, index: -1 },
            ...(isSavings
              ? [
                  { title: "Your request", step: 1, index: 0 },
                  { title: "Current policies", step: 21, index: 4 },
                  { title: "Your business", step: 10, index: 2 },
                ]
              : sections),
          ].map(({ index, ...item }) => {
            const isComplete =
              index === -1
                ? has("name", "email")
                : index === 4
                  ? data.files.some((file) => file.category === "policy")
                  : complete[index];
            return (
              <details
                key={item.title}
                open={!isComplete && !(isSavings && data.submitted)}
                className="group"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  <h2 className={typeStyle("heading.item")}>{item.title}</h2>
                  <div className="flex items-center gap-3">
                    <StatusTag
                      className={typeStyle("body.large")}
                      tone={
                        isComplete || (isSavings && data.submitted)
                          ? "success"
                          : "neutral"
                      }
                      indicator={
                        isComplete || (isSavings && data.submitted)
                          ? "complete"
                          : "progress"
                      }
                    >
                      {isSavings && data.submitted
                        ? "Received"
                        : isComplete
                          ? "Complete"
                          : "In Progress"}
                    </StatusTag>
                    {isSavings && data.submitted ? null : onEdit ? (
                      <PillButton
                        variant="ghost"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onEdit(item.step);
                        }}
                      >
                        Edit
                      </PillButton>
                    ) : (
                      <PillButton
                        variant="ghost"
                        href={withQuoteProvider(
                          `/intake?request=${data.requestId}&step=${item.step}&section=${item.step}`,
                          params.get("provider"),
                        )}
                        onClick={(event: MouseEvent<HTMLAnchorElement>) =>
                          event.stopPropagation()
                        }
                      >
                        Edit
                      </PillButton>
                    )}
                    <ChevronDown
                      aria-hidden="true"
                      className="size-4 transition-transform group-open:rotate-180"
                    />
                  </div>
                </summary>
                <div className="space-y-4 pb-3 pt-1">
                  {index === 4 && (
                    <OperationalLabelValueList>
                      <OperationalLabelValueRow
                        {...documentRow("policy", "Current policies")}
                      />
                    </OperationalLabelValueList>
                  )}
                  {index === -1 && (
                    <IntakeRequestReview
                      answers={a}
                      details={data.details}
                      section="contact"
                      hideHeading
                    />
                  )}
                  {index === 0 && (
                    <IntakeRequestReview
                      answers={a}
                      details={data.details}
                      section="request"
                      extraRows={[
                        documentRow("requirements", "Insurance requirements"),
                        ...(data.files.some(
                          (file) => file.category === "supporting",
                        )
                          ? [documentRow("supporting", "Other documents")]
                          : []),
                      ]}
                      hideHeading
                    />
                  )}
                  {index === 1 && (
                    <IntakeRequestReview
                      answers={a}
                      details={data.details}
                      section="coverage"
                      hideHeading
                    />
                  )}
                  {index === 1 &&
                    !isSavings &&
                    hasCommercialAuto(data.details) && (
                      <div data-review-content className="space-y-5">
                        <section className="space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <h2 className={typeStyle("heading.item")}>
                              Commercial auto details
                            </h2>
                            {onEdit && (
                              <PillButton
                                variant="ghost"
                                onClick={() => onEdit(41)}
                              >
                                Edit
                              </PillButton>
                            )}
                          </div>
                          <IntakeAutoQuoteReview
                            details={data.details}
                            hideHeading
                          />
                        </section>
                        <section className="space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <h2 className={typeStyle("heading.item")}>
                              Driver schedule
                            </h2>
                            {onEdit && (
                              <PillButton
                                variant="ghost"
                                onClick={() => onEdit(31)}
                              >
                                Edit
                              </PillButton>
                            )}
                          </div>
                          <IntakeDriverReview details={data.details} />
                        </section>
                      </div>
                    )}
                  {index === 2 && (
                    <IntakeCompanyReview
                      answers={a}
                      details={data.details}
                      hideHeading
                    />
                  )}
                  {index === 3 && (
                    <IntakeRequestReview
                      answers={a}
                      details={data.details}
                      section="history"
                      extraRows={[
                        ...(a.currentInsurance !== "No" ||
                        data.files.some((file) => file.category === "policy")
                          ? [documentRow("policy", "Current policies")]
                          : []),
                        ...(data.details.hasClaims === "yes" ||
                        data.files.some((file) => file.category === "loss_runs")
                          ? [
                              documentRow(
                                "loss_runs",
                                "Loss runs / claims history",
                              ),
                            ]
                          : []),
                      ]}
                      hideHeading
                    />
                  )}
                </div>
              </details>
            );
          })}
        </>
        {data.submitted &&
          data.hasUnsubmittedChanges &&
          data.submissionBaseline && (
            <IntakeReviewChanges
              previous={data.submissionBaseline}
              current={{
                answers: a,
                details: data.details,
                files: data.files.map((file) => ({
                  id: String(file.id),
                  name: file.name,
                })),
              }}
            />
          )}
        {!isSavings &&
          (["additional"] as const).map((section) => {
            const rows =
              data.details.followups?.filter(
                (row) =>
                  row.section === section &&
                  followupQuestionVisible(row, data.details.followups),
              ) ?? [];
            if (!rows.length) return null;
            return (
              <ReviewSection
                key={section}
                title={"Additional details"}
                complete={rows.every(row => !!row.answer.trim() || !!row.skipped) &&
                  ((data.submitted && !data.hasUnsubmittedChanges) ||
                    ((data.followupBatches?.additional?.status === "failed" ||
                      (data.followupBatches?.additional?.status === "ready" && data.followupBatches.additional.current && !data.followupBatches.additional.enriching)) &&
                      (data.followupBatches?.additional?.questions ?? [])
                        .filter(question => followupQuestionVisible(question, data.details.followups))
                        .every(question => rows.some(row => row.id === question.id && (!!row.answer.trim() || !!row.skipped)))))}
                step={30}
                onEdit={onEdit}
              >
                <IntakeFollowupReview
                  details={data.details}
                  businessName={a.dba || a.legalName}
                  answers={rows}
                />
              </ReviewSection>
            );
          })}
        {confirmation}
      </div>
    </IntakeFrame>
  );
}
