"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  ClRouterRequestError,
  clRouterCapabilities,
  clRouterSupports,
} from "./clRouterClient";
import { NoWriteInputError } from "./noWriteInputError";
import { RouterJobFailed, executeDurableRouterRequest } from "./routerJobClient";

// Model-facing results stay under the runner's 24,000-byte tool output bound.
const STDOUT_BYTES = 8_000;
const STDERR_BYTES = 4_000;
const NOT_ENABLED =
  "Script execution isn't enabled yet: the script sandbox is not configured for Spot. Tell the operator this script can't run in Spot yet, and do the step another way if you can.";

/**
 * Whether skill scripts can run: cl-router advertises `exec` (cached
 * capabilities read) and Spot's kill switch, Convex env
 * `SKILL_SCRIPT_EXECUTION=off`, is not set.
 */
export async function skillScriptsRunnable() {
  if (process.env.SKILL_SCRIPT_EXECUTION?.trim().toLowerCase() === "off")
    return false;
  return clRouterSupports(
    await clRouterCapabilities().catch(() => undefined),
    "exec",
  );
}

/** Fails before approval or execution when the router cannot run scripts. */
export async function assertSkillScriptsRunnable() {
  if (!(await skillScriptsRunnable()))
    throw new NoWriteInputError("integration_unavailable", NOT_ENABLED);
}

type ExecResult = {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  outputFiles: Array<{ path: string; contentBase64: string; sizeBytes: number }>;
  outputsTruncated: boolean;
  durationMs: number;
};

function execResult(value: unknown): ExecResult {
  const result = value as Partial<ExecResult> | null;
  if (
    !result ||
    (result.exitCode !== null && !Number.isInteger(result.exitCode)) ||
    typeof result.timedOut !== "boolean" ||
    typeof result.stdout !== "string" ||
    typeof result.stderr !== "string" ||
    !Array.isArray(result.outputFiles) ||
    !result.outputFiles.every(
      (file) =>
        file &&
        typeof file.path === "string" &&
        typeof file.contentBase64 === "string" &&
        typeof file.sizeBytes === "number",
    )
  )
    throw new Error(
      "The script ran but its result could not be read; it was not run again.",
    );
  return result as ExecResult;
}

/** At most `bytes` of UTF-8: the start of stdout, the end of stderr. */
function bounded(text: string, bytes: number, keep: "start" | "end") {
  const encoded = Buffer.from(text, "utf8");
  if (encoded.length <= bytes) return { text, cut: false };
  const slice =
    keep === "start"
      ? encoded.subarray(0, bytes)
      : encoded.subarray(encoded.length - bytes);
  return { text: slice.toString("utf8").replace(/^�|�$/g, ""), cut: true };
}

const CONTENT_TYPES: Array<[RegExp, string]> = [
  [/\.txt$|\.log$/i, "text/plain"],
  [/\.md$/i, "text/markdown"],
  [/\.csv$/i, "text/csv"],
  [/\.json$/i, "application/json"],
  [/\.html?$/i, "text/html"],
  [/\.pdf$/i, "application/pdf"],
  [/\.png$/i, "image/png"],
  [/\.jpe?g$/i, "image/jpeg"],
  [/\.xlsx$/i, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [/\.docx$/i, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
];

/**
 * Runs one approved `run_skill_script` call through cl-router `exec`. The
 * invocation key is the approval, so a retried or resumed execution reconnects
 * to the same job and never starts a second run. Output files become
 * attachments on the operator conversation.
 */
export async function runSkillScript(
  ctx: ActionCtx,
  args: {
    operatorUserId: Id<"users">;
    input: Record<string, unknown>;
    confirmationId?: Id<"operatorAgentConfirmations">;
  },
) {
  if (!args.confirmationId)
    throw new Error("run_skill_script runs only after the operator approves it.");
  await assertSkillScriptsRunnable();
  const run = await ctx.runQuery(internal.operatorSkills.scriptRunInternal, {
    operatorUserId: args.operatorUserId,
    confirmationId: args.confirmationId,
    input: args.input,
  });
  const files: Array<{ path: string; contentBase64: string }> = [];
  for (const file of run.files) {
    const blob = await ctx.storage.get(file.storageId);
    if (!blob)
      throw new NoWriteInputError(
        "target_not_found",
        `${file.path} is missing from storage; re-import the skill or pick another input file.`,
      );
    files.push({
      path: file.path,
      contentBase64: Buffer.from(await blob.arrayBuffer()).toString("base64"),
    });
  }
  const payload = {
    tenantId: "glass",
    files,
    command: { argv: run.command },
    ...(run.stdin ? { stdin: run.stdin } : {}),
    timeoutMs: run.timeoutMs,
    network: { allowDomains: run.network },
  };

  let raw: unknown;
  try {
    raw = await executeDurableRouterRequest(
      ctx,
      "exec",
      payload,
      `operator-skill-exec:${args.confirmationId}`,
      undefined,
      { wait: "poll" },
    );
  } catch (error) {
    const failure =
      error instanceof RouterJobFailed
        ? error.failure
        : error instanceof ClRouterRequestError
          ? { code: error.routerCode, executionStarted: error.executionStarted }
          : undefined;
    if (failure && failure.executionStarted === false)
      throw new NoWriteInputError(
        "integration_unavailable",
        failure.code === "router_unavailable"
          ? NOT_ENABLED
          : `The script sandbox did not start the run (${failure.code ?? "router error"}); nothing ran. Tell the operator; they can approve it again later.`,
      );
    throw new Error(
      "The script run's outcome is unknown: it may have started, and it was not run again. Tell the operator and check before running it again.",
    );
  }
  const result = execResult(raw);

  const attachments: Array<{
    fileId: Id<"_storage">;
    filename: string;
    contentType: string;
    size: number;
  }> = [];
  const outputFiles: Array<{ path: string; filename: string; size: number; fileId: string }> = [];
  for (const file of result.outputFiles) {
    const bytes = Buffer.from(file.contentBase64, "base64");
    const filename = file.path.replace(/^out\//, "").replaceAll("/", "_") || "output";
    const contentType =
      CONTENT_TYPES.find(([pattern]) => pattern.test(filename))?.[1] ??
      "application/octet-stream";
    const fileId = await ctx.storage.store(new Blob([bytes], { type: contentType }));
    attachments.push({ fileId, filename, contentType, size: bytes.length });
    outputFiles.push({ path: file.path, filename, size: bytes.length, fileId });
  }
  const stdout = bounded(result.stdout, STDOUT_BYTES, "start");
  const stderr = bounded(result.stderr, STDERR_BYTES, "end");
  return {
    result: {
      status: "ran",
      skill: run.skill,
      script: run.script,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
      stdout: stdout.text,
      ...(stdout.cut || result.stdoutTruncated
        ? { stdoutTruncated: true, stdoutNote: "Only the start of stdout is shown." }
        : {}),
      stderr: stderr.text,
      ...(stderr.cut || result.stderrTruncated
        ? { stderrTruncated: true, stderrNote: "Only the end of stderr is shown." }
        : {}),
      outputFiles,
      ...(result.outputsTruncated
        ? { outputsTruncated: true, outputsNote: "Some output files were too many or too large and were not returned." }
        : {}),
      note:
        outputFiles.length > 0
          ? "Output files are attached to this conversation. File them in a client's records with add_client_files only if the operator asks."
          : "The script wrote no files under out/.",
    },
    attachments,
  };
}
