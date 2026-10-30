import dayjs from "dayjs";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import {
  requireOperator,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import {
  MAX_SKILLS_PER_SCOPE,
  canViewOperatorSkill,
  findLoadableOperatorSkill,
  visibleOperatorSkills,
  enabledOperatorSkills,
} from "./lib/operatorSkillStore";
import {
  SKILL_INSTRUCTIONS_PATH,
  SKILL_LIMITS,
  classifySkillFile,
  decodeSkillText,
  SKILL_SCRIPT_LIMITS,
  isSkippedSkillPath,
  normalizeSkillDomain,
  normalizeSkillPath,
  parseSkillInstructions,
  skillPortabilityWarnings,
} from "./lib/operatorSkills";
import { getSessionUserId } from "./lib/sessionIdentity";
import { NoWriteInputError } from "./lib/noWriteInputError";
import {
  resolveSkillScriptRun,
  type SkillScriptInput,
} from "./lib/operatorSkillScripts";

const scopeValidator = v.union(v.literal("personal"), v.literal("shared"));
const kindValidator = v.union(
  v.literal("instructions"),
  v.literal("reference"),
  v.literal("script"),
  v.literal("asset"),
);
// Uploaded but uncommitted bytes older than this are never deleted by a
// failed import: they cannot be from it.
const UPLOAD_DISCARD_WINDOW_MS = 6 * 60 * 60 * 1000;

async function ownerNames(ctx: QueryCtx, skills: Doc<"operatorSkills">[]) {
  const ids = [
    ...new Set(
      skills.flatMap((skill) => [
        skill.ownerUserId,
        skill.importedBy,
        ...(skill.scriptsReviewedBy ? [skill.scriptsReviewedBy] : []),
      ]),
    ),
  ];
  const users = await Promise.all(ids.map((id) => ctx.db.get(id)));
  return new Map(
    ids.map((id, index) => [
      id,
      users[index]?.name?.trim() || users[index]?.email || "Operator",
    ]),
  );
}

function skillRow(
  skill: Doc<"operatorSkills">,
  viewerUserId: Id<"users">,
  names: Map<Id<"users">, string>,
) {
  return {
    _id: skill._id,
    name: skill.name,
    description: skill.description,
    scope: skill.scope,
    enabled: skill.enabled,
    revision: skill.revision,
    fileCount: skill.fileCount,
    totalBytes: skill.totalBytes,
    hasScripts: skill.hasScripts,
    sourceLabel: skill.sourceLabel,
    warnings: skill.warnings,
    updatedAt: skill.updatedAt,
    ownerName: names.get(skill.ownerUserId) ?? "Operator",
    isOwner: skill.ownerUserId === viewerUserId,
    allowedDomains: skill.allowedDomains ?? [],
    importedByViewer: skill.importedBy === viewerUserId,
    importedByName: names.get(skill.importedBy) ?? "Operator",
    /** Set only while the current revision is reviewed. */
    scriptsReview:
      skill.scriptsReviewedBy && skill.scriptsReviewedRevision === skill.revision
        ? {
            reviewerName: names.get(skill.scriptsReviewedBy) ?? "Operator",
            reviewedByViewer: skill.scriptsReviewedBy === viewerUserId,
            at: skill.scriptsReviewedAt ?? skill.updatedAt,
          }
        : null,
  };
}

/** Settings → Skills: the operator's personal skills and the team's shared ones. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    const { personal, shared } = await visibleOperatorSkills(ctx, operator.userId);
    const names = await ownerNames(ctx, [...personal, ...shared]);
    return {
      personal: personal.map((skill) => skillRow(skill, operator.userId, names)),
      shared: shared.map((skill) => skillRow(skill, operator.userId, names)),
    };
  },
});

/** Skills the operator can invoke with `/name` in operator chat: enabled, personal over shared. */
export const invocable = query({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    return (await enabledOperatorSkills(ctx, operator.userId)).map(({ name, description }) => ({
      name,
      description,
    }));
  },
});

/** One visible skill with its files and download URLs for preview. */
export const get = query({
  args: { skillId: v.id("operatorSkills") },
  handler: async (ctx, { skillId }) => {
    const operator = await requireOperator(ctx);
    const skill = await ctx.db.get(skillId);
    if (!skill || !canViewOperatorSkill(skill, operator.userId)) return null;
    const files = await ctx.db
      .query("operatorSkillFiles")
      .withIndex("by_skillId_and_path", (q) => q.eq("skillId", skill._id))
      .take(SKILL_LIMITS.maxFiles);
    return {
      skill: skillRow(skill, operator.userId, await ownerNames(ctx, [skill])),
      files: await Promise.all(
        files.map(async (file) => ({
          path: file.path,
          size: file.size,
          kind: file.kind,
          text: file.text,
          url: await ctx.storage.getUrl(file.storageId),
        })),
      ),
    };
  },
});

export const generateUploadUrl = mutation({
  args: { count: v.number() },
  handler: async (ctx, { count }) => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    if (!Number.isInteger(count) || count < 1 || count > SKILL_LIMITS.maxFiles)
      throw new ConvexError(`A skill can have at most ${SKILL_LIMITS.maxFiles} files.`);
    return await Promise.all(
      Array.from({ length: count }, () => ctx.storage.generateUploadUrl()),
    );
  },
});

export const importContextInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    replaceSkillId: v.optional(v.id("operatorSkills")),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    await assertNoOperatorImpersonation(ctx, args.operatorUserId);
    if (args.replaceSkillId) {
      const skill = await ctx.db.get(args.replaceSkillId);
      if (!skill || skill.ownerUserId !== args.operatorUserId)
        throw new ConvexError("Only the skill's owner can replace it.");
    }
    return null;
  },
});

/**
 * Imports one skill from files the browser uploaded. Everything is checked
 * again here: paths, skipped folders, limits, SKILL.md front matter, text and
 * script detection. A failed import deletes its uploads.
 */
export const importSkill = action({
  args: {
    scope: scopeValidator,
    replaceSkillId: v.optional(v.id("operatorSkills")),
    sourceLabel: v.string(),
    files: v.array(v.object({ path: v.string(), storageId: v.id("_storage") })),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ skillId: Id<"operatorSkills">; name: string; revision: number; replaced: boolean }> => {
    const operatorUserId = await getSessionUserId(ctx);
    if (!operatorUserId) throw new ConvexError("Sign in required");
    const uploaded = args.files.map((file) => file.storageId);
    const discard = (storageIds: Id<"_storage">[]) =>
      storageIds.length
        ? ctx.runMutation(internal.operatorSkills.discardUploadsInternal, {
            operatorUserId,
            storageIds,
          })
        : Promise.resolve(null);
    try {
      await ctx.runQuery(internal.operatorSkills.importContextInternal, {
        operatorUserId,
        replaceSkillId: args.replaceSkillId,
      });
      if (args.files.length > SKILL_LIMITS.maxFiles + 50)
        throw new ConvexError(`A skill can have at most ${SKILL_LIMITS.maxFiles} files.`);
      const kept: Array<{ path: string; storageId: Id<"_storage"> }> = [];
      const skipped: Id<"_storage">[] = [];
      const paths = new Set<string>();
      for (const file of args.files) {
        const path = normalizeSkillPath(file.path);
        if (!path)
          throw new ConvexError(`"${file.path.slice(0, 120)}" is not a valid relative path.`);
        if (isSkippedSkillPath(path)) {
          skipped.push(file.storageId);
          continue;
        }
        if (paths.has(path)) throw new ConvexError(`"${path}" appears twice.`);
        paths.add(path);
        kept.push({ path, storageId: file.storageId });
      }
      if (kept.length > SKILL_LIMITS.maxFiles)
        throw new ConvexError(`A skill can have at most ${SKILL_LIMITS.maxFiles} files.`);
      if (!paths.has(SKILL_INSTRUCTIONS_PATH))
        throw new ConvexError("A skill needs a SKILL.md file at its root.");

      let totalBytes = 0;
      let instructions: ReturnType<typeof parseSkillInstructions> | undefined;
      const files: Array<{
        path: string;
        storageId: Id<"_storage">;
        size: number;
        kind: Doc<"operatorSkillFiles">["kind"];
        text: boolean;
      }> = [];
      for (const file of kept) {
        const blob = await ctx.storage.get(file.storageId);
        if (!blob) throw new ConvexError(`"${file.path}" was not uploaded.`);
        totalBytes += blob.size;
        if (totalBytes > SKILL_LIMITS.maxTotalBytes)
          throw new ConvexError("A skill can be at most 5 MiB in total.");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const text = decodeSkillText(bytes);
        if (file.path === SKILL_INSTRUCTIONS_PATH) {
          if (text === null) throw new ConvexError("SKILL.md must be UTF-8 text.");
          try {
            instructions = parseSkillInstructions(text);
          } catch (error) {
            throw new ConvexError(
              error instanceof Error ? error.message : "SKILL.md could not be read.",
            );
          }
        }
        files.push({
          path: file.path,
          storageId: file.storageId,
          size: blob.size,
          kind: classifySkillFile(file.path, bytes.subarray(0, 2), text !== null),
          text: text !== null,
        });
      }
      if (!instructions) throw new ConvexError("A skill needs a SKILL.md file at its root.");
      const warnings = [
        ...instructions.warnings,
        ...skillPortabilityWarnings(instructions.body),
        ...(skipped.length
          ? [`Skipped ${skipped.length} file${skipped.length === 1 ? "" : "s"} from version control, dependency or system folders.`]
          : []),
      ];
      const result = await ctx.runMutation(internal.operatorSkills.commitImportInternal, {
        operatorUserId,
        scope: args.scope,
        replaceSkillId: args.replaceSkillId,
        name: instructions.name,
        description: instructions.description,
        sourceLabel: args.sourceLabel.trim().slice(0, 200) || "Imported skill",
        warnings,
        files: files.sort((a, b) => a.path.localeCompare(b.path)),
      });
      await discard(skipped);
      return result;
    } catch (error) {
      await discard(uploaded).catch(() => null);
      throw error;
    }
  },
});

async function nameTaken(
  ctx: QueryCtx,
  scope: "personal" | "shared",
  ownerUserId: Id<"users">,
  name: string,
) {
  return scope === "shared"
    ? await ctx.db
        .query("operatorSkills")
        .withIndex("by_scope_and_name", (q) => q.eq("scope", "shared").eq("name", name))
        .unique()
    : await ctx.db
        .query("operatorSkills")
        .withIndex("by_scope_and_ownerUserId_and_name", (q) =>
          q.eq("scope", "personal").eq("ownerUserId", ownerUserId).eq("name", name),
        )
        .unique();
}

async function assertScopeCapacity(
  ctx: QueryCtx,
  scope: "personal" | "shared",
  ownerUserId: Id<"users">,
) {
  const rows =
    scope === "shared"
      ? await ctx.db
          .query("operatorSkills")
          .withIndex("by_scope_and_name", (q) => q.eq("scope", "shared"))
          .take(MAX_SKILLS_PER_SCOPE)
      : await ctx.db
          .query("operatorSkills")
          .withIndex("by_scope_and_ownerUserId_and_name", (q) =>
            q.eq("scope", "personal").eq("ownerUserId", ownerUserId),
          )
          .take(MAX_SKILLS_PER_SCOPE);
  if (rows.length >= MAX_SKILLS_PER_SCOPE)
    throw new ConvexError(`Remove a ${scope} skill before adding another (maximum ${MAX_SKILLS_PER_SCOPE}).`);
}

async function skillFiles(ctx: QueryCtx, skillId: Id<"operatorSkills">) {
  return await ctx.db
    .query("operatorSkillFiles")
    .withIndex("by_skillId_and_path", (q) => q.eq("skillId", skillId))
    .take(SKILL_LIMITS.maxFiles + 1);
}

/** Deletes a skill's file rows; their bytes go after the transaction commits. */
async function removeSkillFiles(ctx: MutationCtx, skillId: Id<"operatorSkills">) {
  const files = await skillFiles(ctx, skillId);
  for (const file of files) await ctx.db.delete(file._id);
  if (files.length)
    await ctx.scheduler.runAfter(0, internal.operatorSkills.deleteStorageInternal, {
      storageIds: files.map((file) => file.storageId),
    });
}

function base64ToHex(value: string) {
  return Array.from(atob(value), (char) =>
    char.charCodeAt(0).toString(16).padStart(2, "0"),
  ).join("");
}

export const commitImportInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    scope: scopeValidator,
    replaceSkillId: v.optional(v.id("operatorSkills")),
    name: v.string(),
    description: v.string(),
    sourceLabel: v.string(),
    warnings: v.array(v.string()),
    files: v.array(
      v.object({
        path: v.string(),
        storageId: v.id("_storage"),
        size: v.number(),
        kind: kindValidator,
        text: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperatorForUser(ctx, args.operatorUserId);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    const stored = [];
    for (const file of args.files) {
      const metadata = await ctx.db.system.get("_storage", file.storageId);
      if (!metadata || metadata.size !== file.size)
        throw new ConvexError(`"${file.path}" was not uploaded.`);
      const reused = await ctx.db
        .query("operatorSkillFiles")
        .withIndex("by_storageId", (q) => q.eq("storageId", file.storageId))
        .first();
      if (reused) throw new ConvexError("These files belong to another skill. Import again.");
      stored.push({ ...file, sha256: base64ToHex(metadata.sha256) });
    }

    let existing: Doc<"operatorSkills"> | null = null;
    if (args.replaceSkillId) {
      existing = await ctx.db.get(args.replaceSkillId);
      if (!existing || existing.ownerUserId !== operator.userId)
        throw new ConvexError("Only the skill's owner can replace it.");
      const clash = await nameTaken(ctx, existing.scope, operator.userId, args.name);
      if (clash && clash._id !== existing._id)
        throw new ConvexError(`A ${existing.scope} skill named ${args.name} already exists.`);
    } else {
      existing = await nameTaken(ctx, args.scope, operator.userId, args.name);
      if (existing && existing.ownerUserId !== operator.userId)
        throw new ConvexError(
          `The team already shares a skill named ${args.name}. Rename yours in SKILL.md or ask its owner to replace it.`,
        );
    }

    const now = dayjs().valueOf();
    const summary = {
      name: args.name,
      description: args.description,
      fileCount: stored.length,
      totalBytes: stored.reduce((sum, file) => sum + file.size, 0),
      hasScripts: stored.some((file) => file.kind === "script"),
      sourceLabel: args.sourceLabel,
      warnings: args.warnings.slice(0, 20),
      updatedBy: operator.userId,
      updatedAt: now,
    };
    let skillId: Id<"operatorSkills">;
    let revision: number;
    if (existing) {
      skillId = existing._id;
      revision = existing.revision + 1;
      await removeSkillFiles(ctx, skillId);
      // A new revision's scripts need a fresh review.
      await ctx.db.patch(skillId, {
        ...summary,
        revision,
        importedBy: operator.userId,
        importedAt: now,
        scriptsReviewedBy: undefined,
        scriptsReviewedRevision: undefined,
        scriptsReviewedAt: undefined,
      });
    } else {
      await assertScopeCapacity(ctx, args.scope, operator.userId);
      revision = 1;
      skillId = await ctx.db.insert("operatorSkills", {
        ...summary,
        scope: args.scope,
        ownerUserId: operator.userId,
        enabled: true,
        revision,
        importedBy: operator.userId,
        importedAt: now,
      });
    }
    for (const file of stored) {
      await ctx.db.insert("operatorSkillFiles", {
        skillId,
        path: file.path,
        size: file.size,
        sha256: file.sha256,
        kind: file.kind,
        text: file.text,
        storageId: file.storageId,
      });
    }
    const scope = existing?.scope ?? args.scope;
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      summary: `${existing ? "Replaced" : "Imported"} ${scope} skill ${args.name}${existing ? ` (revision ${revision})` : ""}`,
      metadata: {
        skillId,
        name: args.name,
        scope,
        revision,
        fileCount: summary.fileCount,
        hasScripts: summary.hasScripts,
      },
    });
    return { skillId, name: args.name, revision, replaced: Boolean(existing) };
  },
});

/** Deletes a failed import's uploads, never bytes another record still uses. */
export const discardUploadsInternal = internalMutation({
  args: { operatorUserId: v.id("users"), storageIds: v.array(v.id("_storage")) },
  handler: async (ctx, args) => {
    const cutoff = dayjs().valueOf() - UPLOAD_DISCARD_WINDOW_MS;
    for (const storageId of args.storageIds.slice(0, SKILL_LIMITS.maxFiles + 50)) {
      const metadata = await ctx.db.system.get("_storage", storageId);
      if (!metadata || metadata._creationTime < cutoff) continue;
      const used = await ctx.db
        .query("operatorSkillFiles")
        .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
        .first();
      if (!used) await ctx.storage.delete(storageId);
    }
    return null;
  },
});

export const deleteStorageInternal = internalMutation({
  args: { storageIds: v.array(v.id("_storage")) },
  handler: async (ctx, { storageIds }) => {
    for (const storageId of storageIds) {
      if (await ctx.db.system.get("_storage", storageId))
        await ctx.storage.delete(storageId);
    }
    return null;
  },
});

async function writableSkill(ctx: MutationCtx, skillId: Id<"operatorSkills">) {
  const operator = await requireOperator(ctx);
  await assertNoOperatorImpersonation(ctx, operator.userId);
  const skill = await ctx.db.get(skillId);
  if (!skill || !canViewOperatorSkill(skill, operator.userId))
    throw new ConvexError("Skill not found.");
  return { operator, skill };
}

/** The hostnames `run_skill_script` may reach for this skill; owner only. */
export const setAllowedDomains = mutation({
  args: { skillId: v.id("operatorSkills"), domains: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { operator, skill } = await writableSkill(ctx, args.skillId);
    if (skill.ownerUserId !== operator.userId)
      throw new ConvexError("Only the skill's owner can change its allowed domains.");
    const domains: string[] = [];
    for (const value of args.domains) {
      const domain = normalizeSkillDomain(value);
      if (!domain)
        throw new ConvexError(
          `${value.trim().slice(0, 80) || "An empty entry"} is not a public hostname (no https://, paths, ports, wildcards or IP addresses).`,
        );
      if (!domains.includes(domain)) domains.push(domain);
    }
    if (domains.length > SKILL_SCRIPT_LIMITS.maxDomains)
      throw new ConvexError(`Allow at most ${SKILL_SCRIPT_LIMITS.maxDomains} domains.`);
    domains.sort();
    const previous = skill.allowedDomains ?? [];
    if (previous.join(",") === domains.join(",")) return null;
    await ctx.db.patch(skill._id, {
      allowedDomains: domains,
      updatedBy: operator.userId,
      updatedAt: dayjs().valueOf(),
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      summary: `Set allowed domains of ${skill.scope} skill ${skill.name}: ${domains.join(", ") || "none"}`,
      metadata: { skillId: skill._id, name: skill.name, previous, domains },
    });
    return null;
  },
});

/**
 * Marks the current revision of a shared skill's scripts reviewed, or clears
 * it. The operator who imported that revision cannot review it.
 */
export const setScriptsReviewed = mutation({
  args: {
    skillId: v.id("operatorSkills"),
    revision: v.number(),
    reviewed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { operator, skill } = await writableSkill(ctx, args.skillId);
    if (skill.scope !== "shared" || !skill.hasScripts)
      throw new ConvexError("Only a shared skill with scripts needs a script review.");
    if (skill.revision !== args.revision)
      throw new ConvexError("The skill was re-imported. Review the new revision.");
    if (args.reviewed && skill.importedBy === operator.userId)
      throw new ConvexError(
        "Another operator has to review these scripts; you imported this revision.",
      );
    const reviewed = skill.scriptsReviewedRevision === skill.revision;
    if (reviewed === args.reviewed) return null;
    const now = dayjs().valueOf();
    await ctx.db.patch(skill._id, {
      scriptsReviewedBy: args.reviewed ? operator.userId : undefined,
      scriptsReviewedRevision: args.reviewed ? skill.revision : undefined,
      scriptsReviewedAt: args.reviewed ? now : undefined,
      updatedBy: operator.userId,
      updatedAt: now,
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      summary: `${args.reviewed ? "Reviewed" : "Cleared the review of"} the scripts of shared skill ${skill.name} (revision ${skill.revision})`,
      metadata: {
        skillId: skill._id,
        name: skill.name,
        revision: skill.revision,
        reviewed: args.reviewed,
      },
    });
    return null;
  },
});

/** Owners turn their skills on and off; any operator can turn a shared skill off for the team. */
export const setEnabled = mutation({
  args: { skillId: v.id("operatorSkills"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const { operator, skill } = await writableSkill(ctx, args.skillId);
    if (skill.enabled === args.enabled) return null;
    await ctx.db.patch(skill._id, {
      enabled: args.enabled,
      updatedBy: operator.userId,
      updatedAt: dayjs().valueOf(),
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      summary: `${args.enabled ? "Enabled" : "Disabled"} ${skill.scope} skill ${skill.name}${skill.scope === "shared" ? " for the team" : ""}`,
      metadata: { skillId: skill._id, name: skill.name, scope: skill.scope, enabled: args.enabled },
    });
    return null;
  },
});

/** Shares a personal skill with the team or takes it back; owner only. */
export const setScope = mutation({
  args: { skillId: v.id("operatorSkills"), scope: scopeValidator },
  handler: async (ctx, args) => {
    const { operator, skill } = await writableSkill(ctx, args.skillId);
    if (skill.ownerUserId !== operator.userId)
      throw new ConvexError("Only the skill's owner can change who sees it.");
    if (skill.scope === args.scope) return null;
    if (await nameTaken(ctx, args.scope, operator.userId, skill.name))
      throw new ConvexError(
        args.scope === "shared"
          ? `The team already shares a skill named ${skill.name}.`
          : `You already have a personal skill named ${skill.name}.`,
      );
    await assertScopeCapacity(ctx, args.scope, operator.userId);
    await ctx.db.patch(skill._id, {
      scope: args.scope,
      updatedBy: operator.userId,
      updatedAt: dayjs().valueOf(),
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      summary:
        args.scope === "shared"
          ? `Shared skill ${skill.name} with the team`
          : `Made shared skill ${skill.name} personal`,
      metadata: { skillId: skill._id, name: skill.name, from: skill.scope, to: args.scope },
    });
    return null;
  },
});

export const remove = mutation({
  args: { skillId: v.id("operatorSkills") },
  handler: async (ctx, args) => {
    const { operator, skill } = await writableSkill(ctx, args.skillId);
    if (skill.ownerUserId !== operator.userId)
      throw new ConvexError("Only the skill's owner can remove it.");
    await removeSkillFiles(ctx, skill._id);
    await ctx.db.delete(skill._id);
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      summary: `Removed ${skill.scope} skill ${skill.name}`,
      metadata: { skillId: skill._id, name: skill.name, scope: skill.scope },
    });
    return null;
  },
});

/** The enabled skill `load_skill` / `read_skill_file` may read for this operator. */
export const loadForAgentInternal = internalQuery({
  args: { operatorUserId: v.id("users"), name: v.string() },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    const skill = await findLoadableOperatorSkill(ctx, args.operatorUserId, args.name);
    if (!skill) return null;
    const files = await skillFiles(ctx, skill._id);
    return {
      skillId: skill._id,
      name: skill.name,
      description: skill.description,
      scope: skill.scope,
      revision: skill.revision,
      hasScripts: skill.hasScripts,
      allowedDomains: skill.allowedDomains ?? [],
      scriptsReviewedRevision: skill.scriptsReviewedRevision,
      files: files.map((file) => ({
        path: file.path,
        size: file.size,
        kind: file.kind,
        text: file.text,
        storageId: file.storageId,
      })),
    };
  },
});

/**
 * The approved `run_skill_script` run, re-resolved right before it executes:
 * the approval must still be for this exact skill revision and input.
 */
export const scriptRunInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    confirmationId: v.id("operatorAgentConfirmations"),
    input: v.any(),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    await assertNoOperatorImpersonation(ctx, args.operatorUserId);
    const confirmation = await ctx.db.get(args.confirmationId);
    if (
      !confirmation ||
      confirmation.operatorUserId !== args.operatorUserId ||
      confirmation.status !== "completed" ||
      confirmation.payload.kind !== "operator_tool_action" ||
      confirmation.payload.toolName !== "run_skill_script"
    )
      throw new ConvexError("run_skill_script needs the operator's approval of this run.");
    const run = await resolveSkillScriptRun(
      ctx,
      args.operatorUserId,
      args.input as SkillScriptInput,
    );
    if (run.fingerprint !== confirmation.payload.sourceFingerprint)
      throw new NoWriteInputError(
        "stale_approval",
        "The skill, its script or the run's inputs changed after approval. Ask the operator to approve the run again.",
      );
    return {
      skill: { name: run.skill.name, revision: run.skill.revision, scope: run.skill.scope },
      script: run.script,
      command: run.command,
      stdin: run.stdin,
      timeoutMs: run.timeoutMs,
      network: run.network,
      files: [
        ...run.files.map((file) => ({ path: file.path, storageId: file.storageId })),
        ...run.inputs.map((file) => ({ path: file.path, storageId: file.storageId })),
      ],
    };
  },
});
