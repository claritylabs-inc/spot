"use client";

import { useAction, useQuery } from "convex/react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Input } from "@claritylabs-inc/ui/components/input";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import { typeStyle } from "@/lib/typography";

type ExtractionReviewTarget =
  | "policy_extraction"
  | "requirement_extraction";

export type ExtractionReviewModelStep = {
  requestId: string;
  label: string;
};

type NegativeCategory =
  | "incorrect"
  | "missing"
  | "ungrounded"
  | "unsafe"
  | "other";

const CATEGORY_LABELS: Record<NegativeCategory, string> = {
  incorrect: "Incorrect value",
  missing: "Missing value",
  ungrounded: "Not grounded in source",
  unsafe: "Unsafe output",
  other: "Other",
};

export function ExtractionReviewPanel({
  targetKind,
  targetId,
  modelSteps = [],
}: {
  targetKind: ExtractionReviewTarget;
  targetId: string;
  modelSteps?: ExtractionReviewModelStep[];
}) {
  const existing = useQuery(
    api.extractionReviews.getForTarget,
    { targetKind, targetId },
  ) as
    | {
        rating: "positive" | "negative";
        category?: NegativeCategory;
        fieldPath?: string;
        comment?: string;
        routerRequestId?: string;
        routerSignalStatus: "not_applicable" | "pending" | "submitted" | "error";
      }
    | null
    | undefined;
  const submitReview = useAction(api.actions.extractionReviews.submit);
  const [rating, setRating] = useState<"positive" | "negative" | null>(null);
  const [category, setCategory] = useState<NegativeCategory>("incorrect");
  const [fieldPath, setFieldPath] = useState("");
  const [expectedValue, setExpectedValue] = useState("");
  const [comment, setComment] = useState("");
  const [routerRequestId, setRouterRequestId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(selectedRating: "positive" | "negative") {
    setSubmitting(true);
    try {
      await submitReview({
        targetKind,
        targetId,
        rating: selectedRating,
        ...(selectedRating === "negative"
          ? { category, fieldPath, expectedValue, comment }
          : {}),
        ...(routerRequestId ? { routerRequestId } : {}),
      });
      toast.success("Extraction review recorded");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not record review",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (existing === undefined) return null;

  if (existing) {
    return (
      <OperationalPanel>
        <OperationalPanelHeader
          title="Operator quality review"
          description="This review is immutable and tied to this extraction run."
        />
        <OperationalPanelBody className="space-y-3">
          <div className="flex items-center gap-2">
            {existing.rating === "positive" ? (
              <ThumbsUp className="size-4 text-success" />
            ) : (
              <ThumbsDown className="size-4 text-destructive" />
            )}
            <Badge variant="outline">
              {existing.rating === "positive" ? "Helpful" : "Needs work"}
            </Badge>
            {existing.routerRequestId ? (
              <span className={`text-muted-foreground ${typeStyle("caption.default")}`}>
                Router signal: {existing.routerSignalStatus.replace("_", " ")}
              </span>
            ) : (
              <span className={`text-muted-foreground ${typeStyle("caption.default")}`}>
                Stored for investigation; no model step was targeted.
              </span>
            )}
          </div>
          {existing.category ? (
            <p className={typeStyle("body.default")}>
              {CATEGORY_LABELS[existing.category]}
              {existing.fieldPath ? ` · ${existing.fieldPath}` : ""}
            </p>
          ) : null}
          {existing.comment ? (
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              {existing.comment}
            </p>
          ) : null}
          {existing.routerSignalStatus === "error" ? (
            <PillButton
              variant="secondary"
              size="compact"
              disabled={submitting}
              onClick={() => void submit(existing.rating)}
            >
              Retry routing signal
            </PillButton>
          ) : null}
        </OperationalPanelBody>
      </OperationalPanel>
    );
  }

  return (
    <OperationalPanel>
      <OperationalPanelHeader
        title="Operator quality review"
        description="Rate the extraction. Specific corrections stay in Spot; only a verified up/down signal is sent to routing."
      />
      <OperationalPanelBody className="space-y-4">
        {modelSteps.length > 0 ? (
          <label className={`block space-y-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
            Model step for routing (optional)
            <Select
              value={routerRequestId || "none"}
              items={[
                { value: "none", label: "No routing signal" },
                ...modelSteps.map((step) => ({
                  value: step.requestId,
                  label: step.label,
                })),
              ]}
              onValueChange={(value) =>
                setRouterRequestId(value === "none" ? "" : String(value))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No routing signal</SelectItem>
                {modelSteps.map((step) => (
                  <SelectItem key={step.requestId} value={step.requestId}>
                    {step.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        ) : null}

        <div className="flex items-center gap-2">
          <PillButton
            variant={rating === "positive" ? "primary" : "secondary"}
            size="compact"
            disabled={submitting}
            onClick={() => {
              setRating("positive");
              void submit("positive");
            }}
          >
            <ThumbsUp className="size-3.5" />
            Helpful
          </PillButton>
          <PillButton
            variant={rating === "negative" ? "destructive" : "secondary"}
            size="compact"
            disabled={submitting}
            onClick={() => setRating("negative")}
          >
            <ThumbsDown className="size-3.5" />
            Needs work
          </PillButton>
        </div>

        {rating === "negative" ? (
          <div className="space-y-3 border-t border-border pt-4">
            <label className={`block space-y-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
              Issue
              <Select
                value={category}
                items={CATEGORY_LABELS}
                onValueChange={(value) => setCategory(value as NegativeCategory)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className={`block space-y-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
              Field or section
              <Input
                value={fieldPath}
                onChange={(event) => setFieldPath(event.target.value)}
                placeholder="e.g. coverages.generalLiability.eachOccurrence"
              />
            </label>
            <label className={`block space-y-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
              Expected value
              <Textarea
                rows={2}
                value={expectedValue}
                onChange={(event) => setExpectedValue(event.target.value)}
              />
            </label>
            <label className={`block space-y-1.5 text-muted-foreground ${typeStyle("label.field")}`}>
              Notes
              <Textarea
                rows={3}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
            </label>
            <PillButton
              variant="destructive"
              size="compact"
              disabled={submitting}
              onClick={() => void submit("negative")}
            >
              Submit review
            </PillButton>
          </div>
        ) : null}
      </OperationalPanelBody>
    </OperationalPanel>
  );
}
