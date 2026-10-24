import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOperator } from "./lib/operatorIdentity";
import type { OperatorSuggestionList } from "./lib/operatorSuggestionTypes";

const pageContextValidator = v.object({
  pageType: v.string(),
  entityId: v.optional(v.string()),
  summary: v.optional(v.string()),
  href: v.optional(v.string()),
});

export const list = query({
  args: { pageContext: v.optional(pageContextValidator) },
  handler: async (ctx): Promise<OperatorSuggestionList> => {
    await requireOperator(ctx);
    return { suggestions: [], stale: false };
  },
});

export const refresh = mutation({
  args: { pageContext: v.optional(pageContextValidator) },
  handler: async (ctx) => {
    await requireOperator(ctx);
    return null;
  },
});
