import { v, type Infer } from "convex/values";
import { z } from "zod";

const probability = v.union(v.number(), v.null());
export const operatorPlanningAssessmentValidator = v.object({
  required: v.boolean(),
  source: v.union(v.literal("jev"), v.literal("uncertain")),
  probabilities: v.object({
    multipleToolCalls: probability,
    sequentialActions: probability,
    multipleEntities: probability,
    multipleEntityEdits: probability,
  }),
  requestId: v.optional(v.string()),
});
export type OperatorPlanningAssessment = Infer<
  typeof operatorPlanningAssessmentValidator
>;

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
