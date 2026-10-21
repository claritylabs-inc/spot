"use node";

import { v } from "convex/values";
import { action, type ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { api } from "../_generated/api";
import { clRouterDecide } from "../lib/clRouterClient";
import {
  intakeIndustryQuestions,
  intakeIndustrySuggestions,
} from "../lib/intakeIndustry";

const args = {
  requestId: v.id("procurementRequests"),
  description: v.string(),
};

/** Owner-authorized, one-request classification shared by both client contracts. */
async function classify(
  ctx: ActionCtx,
  {
    requestId,
    description,
  }: { requestId: Id<"procurementRequests">; description: string },
): Promise<{ industry?: string; industryVertical?: string } | null> {
  const request = await ctx.runQuery(api.requestIntake.get, { requestId });
  const text = description.trim();
  if (
    request.submitted ||
    request.answers.industry?.trim() ||
    !text ||
    text.length > 8000
  )
    return null;
  try {
    const result = await clRouterDecide(
      {
        task: "intake_description_industry",
        trace: { traceId: `intake-industry:${requestId}`, channel: "web" },
        state: { description: text },
        questions: intakeIndustryQuestions("description"),
        executionBudgetMs: 60000,
      },
      { telemetry: ctx },
    );
    const suggestions = intakeIndustrySuggestions(result.answers);
    return suggestions.industry ? suggestions : null;
  } catch {
    // Keep the dropdown available; never replay an unknown decision outcome.
    return null;
  }
}

export const suggestProfile = action({
  args,
  returns: v.union(
    v.object({
      industry: v.optional(v.string()),
      industryVertical: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: classify,
});

/** Preserve string results for intake tabs loaded before suggestProfile existed. */
export const suggest = action({
  args,
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> =>
    (await classify(ctx, args))?.industry ?? null,
});
