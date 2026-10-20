import { v } from "convex/values";
export const followupSectionValidator = v.union(
  v.literal("acord"),
  v.literal("additional"),
);
export const followupQuestionFields = {
  id: v.string(),
  section: followupSectionValidator,
  label: v.string(),
  kind: v.union(
    v.literal("yes_no"),
    v.literal("short_text"),
    v.literal("long_text"),
    v.literal("number"),
    v.literal("currency"),
    v.literal("dropdown"),
  ),
  options: v.array(v.string()),
  source: v.optional(v.string()),
  conditions: v.optional(
    v.array(v.object({ questionId: v.string(), answer: v.string() })),
  ),
};
export const followupQuestionValidator = v.object(followupQuestionFields);
export const followupAnswerValidator = v.object({
  ...followupQuestionFields,
  answer: v.string(),
  skipped: v.optional(v.boolean()),
});
export const followupBatchValidator = v.object({
  status: v.union(
    v.literal("pending"),
    v.literal("prepared"),
    v.literal("ready"),
    v.literal("failed"),
  ),
  token: v.string(),
  contextHash: v.string(),
  startedAt: v.number(),
  preloaded: v.optional(v.boolean()),
  enriching: v.optional(v.boolean()),
  preloadScopeHash: v.optional(v.string()),
  questions: v.array(followupQuestionValidator),
});
