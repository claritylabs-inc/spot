import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { NoWriteInputError } from "./noWriteInputError";
import { findLoadableOperatorSkill } from "./operatorSkillStore";
import {
  SKILL_LIMITS,
  SKILL_SCRIPT_LIMITS,
  isExecPath,
  normalizeSkillDomain,
  skillScriptApprovalSummary,
  skillScriptCommand,
} from "./operatorSkills";

/** `run_skill_script` input after schema parsing. */
export type SkillScriptInput = {
  name: string;
  argv: string[];
  stdin?: string;
  inputClientFileIds?: string[];
  timeoutSeconds?: number;
  network?: string[];
};

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Input file names inside the sandbox: `input/<name>`, limited to exec path characters. */
function inputPath(name: string, taken: Set<string>) {
  const base =
    name
      .replace(/[^a-zA-Z0-9_.-]+/g, "_")
      .replace(/^[._]+/, "")
      .slice(0, 200) || "file";
  let path = `input/${base}`;
  for (let n = 2; taken.has(path); n++) {
    const dot = base.lastIndexOf(".");
    path =
      dot > 0
        ? `input/${base.slice(0, dot)}-${n}${base.slice(dot)}`
        : `input/${base}-${n}`;
  }
  taken.add(path);
  return path;
}

/**
 * Everything one `run_skill_script` call would run, checked the same way at
 * preflight, on the approval card, when it is approved and right before it
 * executes: the operator's enabled skill (a shared one needs another
 * operator's review of this revision), a script of that skill, the sandbox's
 * path, size and network rules, and readable client files as inputs. The
 * fingerprint binds skill id and revision, argv, stdin, input files, network
 * and timeout, so any change needs a fresh approval.
 */
export async function resolveSkillScriptRun(
  ctx: QueryCtx,
  operatorUserId: Id<"users">,
  input: SkillScriptInput,
) {
  const name = input.name.trim().toLowerCase();
  const skill = await findLoadableOperatorSkill(ctx, operatorUserId, name);
  if (!skill)
    throw new NoWriteInputError(
      "target_not_found",
      `No enabled skill named "${input.name}" is available to you. Use an exact name from the OPERATOR SKILLS list.`,
    );
  if (!skill.hasScripts)
    throw new NoWriteInputError("invalid_tool_input", `Skill ${skill.name} has no scripts to run.`);
  if (skill.scope === "shared" && skill.scriptsReviewedRevision !== skill.revision)
    throw new NoWriteInputError(
      "scripts_not_reviewed",
      `The scripts of shared skill ${skill.name} (revision ${skill.revision}) have not been reviewed. Another operator, not the one who imported it, must open Settings → Skills → Shared → ${skill.name} and mark Scripts reviewed; then run it again.`,
    );

  const argv = input.argv;
  if (
    argv.length < 1 ||
    argv.length > SKILL_SCRIPT_LIMITS.maxArgs ||
    argv.some((arg) => arg.length > SKILL_SCRIPT_LIMITS.maxArgChars || arg.includes("\0"))
  )
    throw new NoWriteInputError(
      "invalid_tool_input",
      `argv needs 1–${SKILL_SCRIPT_LIMITS.maxArgs} entries of at most ${SKILL_SCRIPT_LIMITS.maxArgChars} characters.`,
    );
  const files = await ctx.db
    .query("operatorSkillFiles")
    .withIndex("by_skillId_and_path", (q) => q.eq("skillId", skill._id))
    .take(SKILL_LIMITS.maxFiles + 1);
  const { interpreter, script, args } = skillScriptCommand(argv);
  const scriptFile = files.find((file) => file.path === script);
  if (!scriptFile || scriptFile.kind !== "script")
    throw new NoWriteInputError(
      "invalid_tool_input",
      `${script || "argv"} is not a script of skill ${skill.name}. Pass a script path from load_skill, optionally after its interpreter (python3, node, bash).`,
    );
  if (!interpreter)
    throw new NoWriteInputError(
      "invalid_tool_input",
      `Pass the interpreter before ${script}, e.g. ["python3", "${script}"].`,
    );
  const unsupported = files.find((file) => !isExecPath(file.path));
  if (unsupported)
    throw new NoWriteInputError(
      "invalid_tool_input",
      `Skill ${skill.name} has a file the sandbox can't accept (${unsupported.path}); paths may only use letters, digits, _, -, . and /. Rename it and re-import the skill.`,
    );

  const stdin = input.stdin ?? "";
  if (new TextEncoder().encode(stdin).length > SKILL_SCRIPT_LIMITS.maxStdinBytes)
    throw new NoWriteInputError("invalid_tool_input", "stdin must be 256 KiB or smaller.");
  const timeoutSeconds = input.timeoutSeconds ?? SKILL_SCRIPT_LIMITS.defaultTimeoutSeconds;
  if (
    !Number.isInteger(timeoutSeconds) ||
    timeoutSeconds < 1 ||
    timeoutSeconds > SKILL_SCRIPT_LIMITS.maxTimeoutSeconds
  )
    throw new NoWriteInputError("invalid_tool_input", "timeoutSeconds must be a whole number from 1 to 300.");

  const allowed = new Set(skill.allowedDomains ?? []);
  const network = [
    ...new Set((input.network ?? []).map((domain) => normalizeSkillDomain(domain) ?? domain)),
  ].sort();
  const blocked = network.filter((domain) => !allowed.has(domain));
  if (blocked.length)
    throw new NoWriteInputError(
      "invalid_tool_input",
      `${blocked.join(", ")} ${blocked.length === 1 ? "is" : "are"} not in skill ${skill.name}'s allowed domains (${[...allowed].join(", ") || "none"}). Its owner can add domains in Settings → Skills.`,
    );

  const ids = [...new Set(input.inputClientFileIds ?? [])];
  if (ids.length > SKILL_SCRIPT_LIMITS.maxInputFiles)
    throw new NoWriteInputError("invalid_tool_input", "Pass at most 10 input client files.");
  const taken = new Set(files.map((file) => file.path));
  const inputs: Array<{
    clientFileId: Id<"clientFiles">;
    name: string;
    path: string;
    size: number;
    storageId: Id<"_storage">;
  }> = [];
  for (const raw of ids) {
    const id = ctx.db.normalizeId("clientFiles", raw);
    const file: Doc<"clientFiles"> | null = id ? await ctx.db.get(id) : null;
    const org = file ? await ctx.db.get(file.orgId) : null;
    if (!file || file.archivedAt || file.deletedAt || org?.type !== "client")
      throw new NoWriteInputError(
        "invalid_identifier",
        `${raw} is not an active client file. Use clientFileIds from list_client_files.`,
      );
    inputs.push({
      clientFileId: file._id,
      name: file.name,
      path: inputPath(file.name, taken),
      size: file.size,
      storageId: file.fileId,
    });
  }
  const totalBytes =
    files.reduce((sum, file) => sum + file.size, 0) +
    inputs.reduce((sum, file) => sum + file.size, 0);
  if (files.length + inputs.length > SKILL_LIMITS.maxFiles || totalBytes > SKILL_LIMITS.maxTotalBytes)
    throw new NoWriteInputError(
      "invalid_tool_input",
      "The skill and its input files must stay within 200 files and 5 MiB together. Pass fewer or smaller input files.",
    );

  const command = [interpreter, script, ...args];
  const timeoutMs = timeoutSeconds * 1000;
  const fingerprint = await sha256Hex(
    JSON.stringify({
      skillId: skill._id,
      revision: skill.revision,
      argv,
      stdin: await sha256Hex(stdin),
      inputClientFileIds: inputs.map((file) => file.clientFileId),
      network,
      timeoutMs,
    }),
  );
  return {
    skill,
    files,
    script,
    command,
    stdin,
    timeoutMs,
    network,
    inputs,
    fingerprint,
    summary: skillScriptApprovalSummary({
      name: skill.name,
      argv,
      workingFiles: inputs.map((file) => file.name),
      network,
    }),
  };
}
