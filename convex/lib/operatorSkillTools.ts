import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { NoWriteInputError } from "./noWriteInputError";
import {
  SKILL_INSTRUCTIONS_PATH,
  normalizeSkillPath,
  parseSkillInstructions,
} from "./operatorSkills";

// Model-facing results stay under the runner's 24,000-byte tool output bound,
// so long text is paged with `offset` instead of being cut mid-result.
const TEXT_PAGE_BYTES = 14_000;
const FILE_LIST_BYTES = 6_000;
/** What the model may do with this skill's scripts right now. */
function scriptsNote(skill: {
  name: string;
  scope: "personal" | "shared";
  revision: number;
  scriptsReviewedRevision?: number;
  allowedDomains: string[];
}, runnable: boolean) {
  if (!runnable)
    return "Scripts in this skill are stored but cannot run in Spot yet. Do not claim a script ran; do the step with Spot's tools or tell the operator it needs to be run elsewhere.";
  if (skill.scope === "shared" && skill.scriptsReviewedRevision !== skill.revision)
    return `This shared skill's scripts can't run until another operator (not its importer) marks revision ${skill.revision} Scripts reviewed in Settings → Skills. Tell the operator; do not claim a script ran.`;
  return `Run a script with run_skill_script after the operator approves the exact run. Network is off unless you pass some of: ${skill.allowedDomains.join(", ") || "(no domains allowed)"}. Never claim a script ran unless run_skill_script returned its result.`;
}

/** One page of `text` from character `offset`, at most TEXT_PAGE_BYTES of UTF-8. */
function textPage(text: string, offset: number) {
  const encoder = new TextEncoder();
  let end = Math.min(text.length, offset + TEXT_PAGE_BYTES);
  while (end > offset && encoder.encode(text.slice(offset, end)).length > TEXT_PAGE_BYTES)
    end = offset + Math.floor((end - offset) * 0.8);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1] ?? "")) end -= 1;
  return {
    content: text.slice(offset, end),
    ...(end < text.length
      ? { truncated: true, nextOffset: end, totalChars: text.length }
      : {}),
  };
}

async function loadSkill(
  ctx: ActionCtx,
  operatorUserId: Id<"users">,
  name: string,
) {
  const skill = await ctx.runQuery(internal.operatorSkills.loadForAgentInternal, {
    operatorUserId,
    name: name.trim().toLowerCase(),
  });
  if (!skill)
    throw new NoWriteInputError(
      "target_not_found",
      `No enabled skill named "${name}" is available to you. Use an exact name from the OPERATOR SKILLS list.`,
    );
  return skill;
}

async function readText(ctx: ActionCtx, storageId: Id<"_storage">, path: string) {
  const blob = await ctx.storage.get(storageId);
  if (!blob)
    throw new NoWriteInputError("target_not_found", `The stored copy of ${path} is missing.`);
  return await blob.text();
}

export async function runOperatorSkillTool(
  ctx: ActionCtx,
  args: {
    operatorUserId: Id<"users">;
    toolName: string;
    input: Record<string, unknown>;
    /** cl-router advertises `exec`. */
    scriptsRunnable: boolean;
  },
) {
  const name = String(args.input.name ?? "");
  const skill = await loadSkill(ctx, args.operatorUserId, name);
  if (args.toolName === "load_skill") {
    const instructions = skill.files.find((file) => file.path === SKILL_INSTRUCTIONS_PATH);
    if (!instructions)
      throw new NoWriteInputError("target_not_found", `Skill ${skill.name} has no SKILL.md.`);
    const { body } = parseSkillInstructions(
      await readText(ctx, instructions.storageId, SKILL_INSTRUCTIONS_PATH),
    );
    const files: Array<{ path: string; kind: string; size: number }> = [];
    let listBytes = 0;
    for (const file of skill.files) {
      if (file.path === SKILL_INSTRUCTIONS_PATH) continue;
      listBytes += file.path.length + 40;
      if (listBytes > FILE_LIST_BYTES) break;
      files.push({ path: file.path, kind: file.kind, size: file.size });
    }
    const otherFiles = skill.files.length - 1;
    const page = textPage(body, 0);
    return {
      status: "loaded",
      skill: {
        name: skill.name,
        description: skill.description,
        scope: skill.scope,
        revision: skill.revision,
      },
      instructions: page.content,
      ...(page.truncated
        ? {
            instructionsTruncated: true,
            continueWith: `read_skill_file with path "${SKILL_INSTRUCTIONS_PATH}" and offset ${page.nextOffset}`,
          }
        : {}),
      files,
      ...(files.length < otherFiles ? { filesOmitted: otherFiles - files.length } : {}),
      ...(skill.hasScripts
        ? { scriptsNote: scriptsNote(skill, args.scriptsRunnable) }
        : {}),
    };
  }

  const rawPath = String(args.input.path ?? "");
  const path = normalizeSkillPath(rawPath);
  const file = path ? skill.files.find((candidate) => candidate.path === path) : undefined;
  if (!file)
    throw new NoWriteInputError(
      "target_not_found",
      `Skill ${skill.name} has no file "${rawPath}". Use a path from load_skill's file list.`,
    );
  if (!file.text)
    throw new NoWriteInputError(
      "unsupported_content",
      `${file.path} is a binary ${file.kind} file and cannot be read as text. Describe it from its name and the skill's instructions instead.`,
    );
  const offset = typeof args.input.offset === "number" ? args.input.offset : 0;
  let text = await readText(ctx, file.storageId, file.path);
  if (file.path === SKILL_INSTRUCTIONS_PATH) text = parseSkillInstructions(text).body;
  if (offset > text.length)
    throw new NoWriteInputError(
      "invalid_tool_input",
      `offset ${offset} is past the end of ${file.path} (${text.length} characters).`,
    );
  const page = textPage(text, offset);
  return {
    status: "read",
    skill: { name: skill.name, revision: skill.revision },
    path: file.path,
    kind: file.kind,
    size: file.size,
    ...(offset ? { offset } : {}),
    ...page,
    ...(file.kind === "script"
      ? { scriptsNote: scriptsNote(skill, args.scriptsRunnable) }
      : {}),
  };
}
