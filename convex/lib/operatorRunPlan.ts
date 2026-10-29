import { v, type Infer } from "convex/values";
import { z } from "zod";

const probability = v.union(v.number(), v.null());
export const operatorPlanningLevelValidator = v.union(
  v.literal("none"),
  v.literal("checklist"),
  v.literal("full"),
);
export type OperatorPlanningLevel = Infer<
  typeof operatorPlanningLevelValidator
>;

/**
 * `level` is the graded decision. Runs assessed before levels existed store
 * only `required` and the four legacy probabilities; read both through
 * `operatorPlanningLevel`.
 */
export const operatorPlanningAssessmentValidator = v.object({
  level: v.optional(operatorPlanningLevelValidator),
  required: v.optional(v.boolean()),
  source: v.union(
    v.literal("jev"),
    v.literal("uncertain"),
    v.literal("operator"),
  ),
  probabilities: v.object({
    changesRecords: v.optional(probability),
    changesMultipleRecords: v.optional(probability),
    dependentChange: v.optional(probability),
    sendsExternally: v.optional(probability),
    targetNeedsSearch: v.optional(probability),
    multipleToolCalls: v.optional(probability),
    sequentialActions: v.optional(probability),
    multipleEntities: v.optional(probability),
    multipleEntityEdits: v.optional(probability),
  }),
  /** Expected level index of the target-count Score (0 one, 1 two to four, 2 five or more). */
  targetCount: v.optional(
    v.union(v.object({ score: v.number(), confidence: v.number() }), v.null()),
  ),
  requestId: v.optional(v.string()),
  /** The full planner failed, so the run continued at `checklist`. */
  plannerFallback: v.optional(v.boolean()),
});
export type OperatorPlanningAssessment = Infer<
  typeof operatorPlanningAssessmentValidator
>;

export function operatorPlanningLevel(
  assessment: Pick<OperatorPlanningAssessment, "level" | "required">,
): OperatorPlanningLevel {
  return assessment.level ?? (assessment.required ? "full" : "none");
}

export const operatorExecutionPlanValidator = v.object({
  summary: v.string(),
  targets: v.array(v.string()),
  steps: v.array(
    v.object({
      title: v.string(),
      detail: v.string(),
      completionCriteria: v.string(),
    }),
  ),
});
export const operatorExecutionPlanSchema = z.object({
  summary: z.string().trim().min(1).max(1200),
  targets: z.array(z.string().trim().min(1).max(200)).max(50),
  steps: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        detail: z.string().trim().min(1).max(1600),
        completionCriteria: z.string().trim().min(1).max(800),
      }),
    )
    .min(1)
    .max(12),
});
export type OperatorExecutionPlan = Infer<
  typeof operatorExecutionPlanValidator
>;
