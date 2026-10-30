import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  PERSONAL_EMAIL_PROMPT_KEYS,
  resolveEmailPrompts,
  type EmailPromptKey,
  type EmailPrompts,
  type PersonalEmailPromptKey,
} from "./emailSkill";

/** Saved overrides for one scope: `null` is shared, a user id is that operator's own. */
export async function savedEmailPrompts(
  ctx: QueryCtx,
  userId: Id<"users"> | null,
): Promise<Partial<EmailPrompts>> {
  const rows = await ctx.db
    .query("emailPrompts")
    .withIndex("by_userId_and_key", (q) => q.eq("userId", userId))
    .take(20);
  return Object.fromEntries(rows.map((row) => [row.key, row.value])) as Partial<Record<EmailPromptKey, string>>;
}

/** The prompts in effect, with `userId`'s own signature and preferences when given. */
export async function loadEmailPrompts(
  ctx: QueryCtx,
  userId?: Id<"users"> | null,
): Promise<EmailPrompts> {
  const shared = await savedEmailPrompts(ctx, null);
  if (!userId) return resolveEmailPrompts(shared);
  const personal = await savedEmailPrompts(ctx, userId);
  return resolveEmailPrompts(
    shared,
    Object.fromEntries(
      PERSONAL_EMAIL_PROMPT_KEYS.flatMap((key) => (personal[key] ? [[key, personal[key]]] : [])),
    ) as Partial<Record<PersonalEmailPromptKey, string>>,
  );
}
