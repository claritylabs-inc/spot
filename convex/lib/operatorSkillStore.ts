import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** Per-scope listing bound; imports refuse to go past it. */
export const MAX_SKILLS_PER_SCOPE = 200;

/** The operator's own personal skills and every shared skill, by name. */
export async function visibleOperatorSkills(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<{ personal: Doc<"operatorSkills">[]; shared: Doc<"operatorSkills">[] }> {
  const [personal, shared] = await Promise.all([
    ctx.db
      .query("operatorSkills")
      .withIndex("by_scope_and_ownerUserId_and_name", (q) =>
        q.eq("scope", "personal").eq("ownerUserId", userId),
      )
      .take(MAX_SKILLS_PER_SCOPE),
    ctx.db
      .query("operatorSkills")
      .withIndex("by_scope_and_name", (q) => q.eq("scope", "shared"))
      .take(MAX_SKILLS_PER_SCOPE),
  ]);
  return { personal, shared };
}

/** The enabled skill the agent loads by name: the operator's own first, then shared. */
export async function findLoadableOperatorSkill(
  ctx: QueryCtx,
  userId: Id<"users">,
  name: string,
) {
  const personal = await ctx.db
    .query("operatorSkills")
    .withIndex("by_scope_and_ownerUserId_and_name", (q) =>
      q.eq("scope", "personal").eq("ownerUserId", userId).eq("name", name),
    )
    .unique();
  if (personal?.enabled) return personal;
  const shared = await ctx.db
    .query("operatorSkills")
    .withIndex("by_scope_and_name", (q) =>
      q.eq("scope", "shared").eq("name", name),
    )
    .unique();
  return shared?.enabled ? shared : null;
}

export function canViewOperatorSkill(
  skill: Doc<"operatorSkills">,
  userId: Id<"users">,
) {
  return skill.scope === "shared" || skill.ownerUserId === userId;
}

/** Enabled skills the agent may load for `userId`: personal first, then shared. */
export async function enabledOperatorSkills(ctx: QueryCtx, userId: Id<"users">) {
  const { personal, shared } = await visibleOperatorSkills(ctx, userId);
  const own = personal.filter((skill) => skill.enabled);
  const names = new Set(own.map((skill) => skill.name));
  return [
    ...own,
    ...shared.filter((skill) => skill.enabled && !names.has(skill.name)),
  ].map((skill) => ({ name: skill.name, description: skill.description }));
}
