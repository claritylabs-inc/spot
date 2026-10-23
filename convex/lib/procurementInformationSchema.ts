import { v } from "convex/values";
import { followupQuestionValidator } from "./intakeFollowupSchema";

export const informationScopeValidator = v.object({
  subject: v.string(),
  period: v.string(),
  coverage: v.string(),
  currency: v.optional(v.string()),
});
export const informationRequirementStatus = v.union(
  v.literal("needs_information"),
  v.literal("clarification_needed"),
  v.literal("operator_work"),
  v.literal("accepted"),
  v.literal("waived"),
  v.literal("withdrawn"),
);
export const informationResponseValidator = v.object({
  questionId: v.id("procurementInformationQuestions"),
  answer: v.string(),
  unsure: v.boolean(),
  fileItemIds: v.array(v.id("procurementFileItems")),
});
export const informationFormQuestionValidator = v.object({
  questionId: v.id("procurementInformationQuestions"),
  answerIdAtPublish: v.optional(v.id("procurementInformationAnswers")),
  question: followupQuestionValidator,
  scope: informationScopeValidator,
});

export const informationExtractionQuestionValidator = v.object({
  confirmed: v.optional(v.boolean()),
  key: v.optional(v.string()),
  conditions: v.optional(
    v.array(v.object({ questionId: v.string(), answer: v.string() })),
  ),
  existingQuestionId: v.optional(v.union(v.string(), v.null())),
  label: v.string(),
  kind: v.union(
    v.literal("yes_no"),
    v.literal("short_text"),
    v.literal("long_text"),
    v.literal("number"),
    v.literal("currency"),
    v.literal("date"),
    v.literal("dropdown"),
  ),
  currency: v.optional(v.union(v.string(), v.null())),
  options: v.array(v.string()),
  subject: v.string(),
  period: v.string(),
  coverage: v.string(),
  quote: v.string(),
  existingAnswer: v.union(v.string(), v.null()),
});

export const informationEmailAnswerValidator = v.object({
  confirmed: v.optional(v.boolean()),
  questionId: v.id("procurementInformationQuestions"),
  answer: v.string(),
  quote: v.string(),
});
