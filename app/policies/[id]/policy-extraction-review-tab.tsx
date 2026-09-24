"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

import { PillButton } from "@/components/ui/pill-button";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { pendingExtractionReviewQuestions } from "@/lib/extraction-state";
import { typeStyle } from "@/lib/typography";

type CoverageReviewOption = {
  id?: string;
  value?: string;
  label?: string;
  detail?: string;
  limitType?: string;
  pageNumber?: number;
  sourceLabel?: string;
  reason?: string;
  coverage?: Record<string, unknown>;
};

type CoverageReviewQuestion = {
  id?: string;
  status?: "open" | "confirmed" | "broker_help_requested" | "dismissed";
  coverageName?: string;
  currentValue?: string;
  recommendedOptionId?: string;
  recommendation?: string;
  question?: string;
  reason?: string;
  options?: CoverageReviewOption[];
};

export function extractionReviewQuestions(
  policy: Record<string, unknown>,
): CoverageReviewQuestion[] {
  return pendingExtractionReviewQuestions<CoverageReviewQuestion>(policy);
}

function reviewString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function formatReviewLimitType(value: unknown) {
  const raw = reviewString(value).replace(/_/g, " ");
  if (!raw || raw === "limit") return "";
  if (raw === "per claim") return "per occurrence";
  return raw;
}

function normalizedReviewText(value: unknown) {
  return reviewString(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function optionTermKind(option: CoverageReviewOption) {
  const coverage = option.coverage ?? {};
  const text = normalizedReviewText(
    [
      option.label,
      option.value,
      option.detail,
      coverage.name,
      coverage.limit,
      coverage.deductible,
      coverage.originalContent,
      coverage.resolvedOriginalContent,
      coverage.sectionRef,
    ]
      .filter(Boolean)
      .join(" "),
  );
  if (text.includes("retroactive")) return "retroactive date";
  if (text.includes("deductible") || text.includes("retention"))
    return "deductible";
  return "limit";
}

function optionDetailParts(option: CoverageReviewOption) {
  const coverage = option.coverage ?? {};
  const source =
    reviewString(option.sourceLabel) ||
    [
      reviewString(coverage.sectionRef) || reviewString(coverage.formNumber),
      typeof option.pageNumber === "number"
        ? `page ${option.pageNumber}`
        : typeof coverage.pageNumber === "number"
          ? `page ${coverage.pageNumber}`
          : "",
    ]
      .filter(Boolean)
      .join(", ");
  const type = formatReviewLimitType(option.limitType ?? coverage.limitType);
  const name = reviewString(coverage.name);
  const text = reviewString(coverage.originalContent);
  return {
    source,
    type,
    name,
    text,
    detail: reviewString(option.detail),
    reason: reviewString(option.reason),
  };
}

function optionDisplayLabel(option: CoverageReviewOption) {
  const value = reviewString(option.value ?? option.label) || "As stated";
  const label = reviewString(option.label);
  if (label && label !== value) return label;
  const type = formatReviewLimitType(
    option.limitType ?? option.coverage?.limitType,
  );
  if (
    type &&
    !normalizedReviewText(value).includes(normalizedReviewText(type))
  ) {
    return `${value} ${type}`;
  }
  return value;
}

function optionValue(option: CoverageReviewOption) {
  return reviewString(option.value ?? option.label) || "As stated";
}

function optionKey(option: CoverageReviewOption, index: number) {
  return option.id ?? `${optionValue(option)}:${index}`;
}

function optionEvidenceScore(option: CoverageReviewOption) {
  const coverage = option.coverage ?? {};
  const text = normalizedReviewText(
    [
      option.sourceLabel,
      option.reason,
      option.detail,
      coverage.sectionRef,
      coverage.formNumber,
      coverage.originalContent,
      coverage.resolvedOriginalContent,
    ]
      .filter(Boolean)
      .join(" "),
  );
  let score = 0;
  if (optionTermKind(option) === "limit") score += 8;
  if (text.includes("item 6") || text.includes("declarations")) score += 5;
  if (text.includes("schedule")) score += 3;
  if (text.includes("source span") || text.includes("evidence")) score += 1;
  if (text.includes("deductible") || text.includes("retroactive")) score -= 10;
  return score;
}

function recommendedOption(
  question: CoverageReviewQuestion,
  options: CoverageReviewOption[],
) {
  if (question.recommendedOptionId) {
    const explicit = options.find(
      (option) => option.id === question.recommendedOptionId,
    );
    if (explicit) return explicit;
  }
  const current = options
    .filter((option) => option.value === question.currentValue)
    .sort((a, b) => optionEvidenceScore(b) - optionEvidenceScore(a))[0];
  if (current) return current;
  return [...options].sort(
    (a, b) => optionEvidenceScore(b) - optionEvidenceScore(a),
  )[0];
}

function recommendationText(
  question: CoverageReviewQuestion,
  option?: CoverageReviewOption,
) {
  if (question.recommendation) return question.recommendation;
  if (!option) return "";
  const details = optionDetailParts(option);
  if (details.source) return `Recommended from ${details.source}.`;
  if (details.reason) return `Recommended because ${details.reason}.`;
  return "Recommended by source evidence.";
}

function displayReviewQuestion(question: CoverageReviewQuestion) {
  const text = reviewString(question.question);
  if (
    text &&
    !/limit\s+limit/i.test(text) &&
    !/applies to this policy/i.test(text)
  ) {
    return text;
  }
  const coverageName = reviewString(question.coverageName)
    .replace(/\s+[-—]\s+.*?(?:limit|deductible|retroactive\s+date)$/i, "")
    .replace(
      /\s+(each\s+claim|per\s+claim|each\s+occurrence|per\s+occurrence|each\s+loss|aggregate|policy\s+aggregate)(?:\s+limit)?$/i,
      "",
    )
    .trim();
  const type = formatReviewLimitType(question.options?.[0]?.limitType);
  if (coverageName && type)
    return `Review the ${type} limit for ${coverageName}`;
  if (coverageName) return `Review the extracted value for ${coverageName}`;
  return "Review this extracted value";
}

function displayReviewReason(question: CoverageReviewQuestion) {
  const reason = reviewString(question.reason);
  if (!reason || /selected policy limit needs confirmation/i.test(reason)) {
    return "Spot found more than one extracted entry. Confirm the value that should be used in the policy summary.";
  }
  return reason;
}

export function PolicyExtractionReview({
  policy,
  readOnly,
}: {
  policy: Record<string, unknown> & { _id: Id<"policies"> };
  readOnly: boolean;
}) {
  const questions = extractionReviewQuestions(policy);
  const answerQuestion = useMutation(api.policies.answerCoverageReviewQuestion);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<
    Record<string, string>
  >({});

  if (questions.length === 0) return null;

  const confirmAnswer = async (
    questionId: string,
    selectedValue: string,
    selectedOptionId?: string,
  ) => {
    setPendingId(`${questionId}:confirm`);
    try {
      await answerQuestion({
        id: policy._id,
        questionId,
        selectedValue,
        selectedOptionId,
      });
      setSelectedOptions((current) => {
        const next = { ...current };
        delete next[questionId];
        return next;
      });
      toast.success("Coverage confirmed");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not confirm coverage"),
      );
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section className="mb-6">
      <div className="space-y-3">
        {questions.map((question) => {
          const questionId = question.id!;
          const brokerRequested = question.status === "broker_help_requested";
          const options = Array.isArray(question.options)
            ? question.options
            : [];
          const recommended = recommendedOption(question, options);
          const optionEntries = options
            .map((option, index) => ({ option, key: optionKey(option, index) }))
            .filter(({ option }) => optionValue(option));
          const recommendedEntry = recommended
            ? optionEntries.find(({ option }) => option === recommended)
            : undefined;
          const alternativeEntries = optionEntries.filter(
            ({ option }) => option !== recommended,
          );
          const selectedKey =
            selectedOptions[questionId] ?? recommendedEntry?.key;
          const selectedEntry = optionEntries.find(
            ({ key }) => key === selectedKey,
          );
          const isConfirming = pendingId === `${questionId}:confirm`;
          const optionCards = [
            ...(recommendedEntry
              ? [{ ...recommendedEntry, heading: "Recommended" }]
              : []),
            ...alternativeEntries.map((entry) => ({
              ...entry,
              heading: "Other value found",
            })),
          ];
          return (
            <div
              key={questionId}
              className="rounded-lg border border-border-emphasized bg-background p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className={`text-foreground ${typeStyle("body.medium")}`}>
                    {displayReviewQuestion(question)}
                  </p>
                  <p
                    className={`mt-1 max-w-4xl text-muted-foreground ${typeStyle("caption.default")}`}
                  >
                    {displayReviewReason(question)}
                  </p>
                </div>
                {brokerRequested ? (
                  <StatusTag tone="warning">Broker requested</StatusTag>
                ) : null}
              </div>

              <div className="mt-3 divide-y divide-border border-y border-border">
                {optionCards.map(({ option, key, heading }) => {
                  const details = optionDetailParts(option);
                  const selected = selectedKey === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={readOnly || pendingId !== null}
                      onClick={() =>
                        setSelectedOptions((current) => ({
                          ...current,
                          [questionId]: key,
                        }))
                      }
                      aria-pressed={selected}
                      className={`flex w-full min-w-0 flex-wrap items-start justify-between gap-3 px-0 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        selected
                          ? "bg-foreground/[0.025]"
                          : "hover:bg-foreground/[0.015]"
                      }`}
                    >
                      <div className="min-w-0">
                        <p
                          className={`text-muted-foreground ${typeStyle("label.eyebrow")}`}
                        >
                          {heading}
                        </p>
                        <p
                          className={`mt-1 text-foreground ${typeStyle("body.medium")}`}
                        >
                          {optionDisplayLabel(option)}
                        </p>
                        {details.source || details.type ? (
                          <p
                            className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
                          >
                            {[details.type, details.source]
                              .filter(Boolean)
                              .join(" from ")}
                          </p>
                        ) : null}
                        {key === recommendedEntry?.key ? (
                          <p
                            className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
                          >
                            {recommendationText(question, option)}
                          </p>
                        ) : details.name ? (
                          <p
                            className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
                          >
                            {details.name}
                          </p>
                        ) : null}
                        {details.text ? (
                          <p
                            className={`mt-1 line-clamp-2 text-muted-foreground ${typeStyle("caption.default")}`}
                          >
                            {details.text}
                          </p>
                        ) : null}
                      </div>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border border-border-emphasized px-3 py-1 text-muted-foreground ${typeStyle("label.tag")}`}
                      >
                        {selected ? (
                          <CheckCircle2 className="size-3.5" />
                        ) : null}
                        {selected ? "Selected" : "Select"}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <PillButton
                  variant="primary"
                  size="compact"
                  disabled={readOnly || pendingId !== null || !selectedEntry}
                  onClick={() =>
                    selectedEntry
                      ? confirmAnswer(
                          questionId,
                          optionValue(selectedEntry.option),
                          selectedEntry.option.id,
                        )
                      : undefined
                  }
                >
                  {isConfirming ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-3.5" />
                  )}
                  Confirm Selection
                </PillButton>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
