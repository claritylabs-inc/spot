import dayjs from "dayjs";
import { ConvexError, v } from "convex/values";

import { internalQuery, mutation, query } from "./_generated/server";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import { loadEmailPrompts, savedEmailPrompts } from "./lib/emailPrompts";
import {
  DEFAULT_EMAIL_PROMPTS,
  EMAIL_PROMPT_KEYS,
  MAX_EMAIL_PROMPT_CHARS,
  PERSONAL_EMAIL_PROMPT_KEYS,
  unknownEmailPromptVariables,
  type EmailPromptKey,
} from "./lib/emailSkill";
import { requireOperator, writeOperatorAudit } from "./lib/operatorIdentity";

const keyValidator = v.union(...EMAIL_PROMPT_KEYS.map((key) => v.literal(key)));

/** Settings → Email: the defaults, the team's saved prompts and the operator's own. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    return {
      defaults: DEFAULT_EMAIL_PROMPTS,
      shared: await savedEmailPrompts(ctx, null),
      personal: await savedEmailPrompts(ctx, operator.userId),
    };
  },
});

/**
 * Saves one prompt for the team (`personal: false`) or the signed-in operator.
 * Blank text, or text equal to the default, removes the override.
 */
export const save = mutation({
  args: { key: keyValidator, personal: v.boolean(), value: v.string() },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    const key: EmailPromptKey = args.key;
    if (args.personal && !(PERSONAL_EMAIL_PROMPT_KEYS as readonly string[]).includes(key))
      throw new ConvexError("This prompt can only be set for the team.");
    const value = args.value.replace(/\r\n?/g, "\n");
    if (value.length > MAX_EMAIL_PROMPT_CHARS)
      throw new ConvexError(`Keep it under ${MAX_EMAIL_PROMPT_CHARS} characters.`);
    const unknown = unknownEmailPromptVariables(key, value);
    if (unknown.length)
      throw new ConvexError(`Unknown variable ${unknown.map((name) => `{{${name}}}`).join(", ")}.`);

    const userId = args.personal ? operator.userId : null;
    const existing = await ctx.db
      .query("emailPrompts")
      .withIndex("by_userId_and_key", (q) => q.eq("userId", userId).eq("key", key))
      .unique();
    const reset = !value.trim() || (!args.personal && value.trim() === DEFAULT_EMAIL_PROMPTS[key].trim());
    if (reset) {
      if (existing) await ctx.db.delete(existing._id);
    } else if (existing) {
      if (existing.value === value) return null;
      await ctx.db.patch(existing._id, { value, updatedBy: operator.userId, updatedAt: dayjs().valueOf() });
    } else {
      await ctx.db.insert("emailPrompts", {
        key,
        userId,
        value,
        updatedBy: operator.userId,
        updatedAt: dayjs().valueOf(),
      });
    }
    if (!existing && reset) return null;
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      summary: `${reset ? "Reset" : "Updated"} ${args.personal ? "personal" : "shared"} email prompt ${key}`,
      metadata: { key, personal: args.personal },
    });
    return null;
  },
});

/** The prompts in effect for actions, with `userId`'s own when given. */
export const resolvedInternal = internalQuery({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, { userId }) => await loadEmailPrompts(ctx, userId),
});
