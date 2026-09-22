/**
 * Locked Spot → cl-router primitive mapping.
 *
 * Internal task names stay in Spot for telemetry, prompts, and `/operator/logs`
 * labels. The wire field is `primitive` (+ `requirements`), never `task`.
 *
 * Keep in sync with `convex/lib/clRouterPrimitive.ts` and
 * `extraction-worker/src/clRouterPrimitive.ts`.
 */

import type {
  ClRouterPrimitive,
  ClRouterRequirements,
} from "./types";

export type SpotPrimitiveMappingInput = {
  task?: string;
  taskKind?: string;
  hasTools?: boolean;
  hasVision?: boolean;
  hasStructuredOutput?: boolean;
};

export type SpotPrimitiveMapping = {
  primitive: ClRouterPrimitive;
  requirements?: ClRouterRequirements;
};

const TEXT_TASKS = new Set([
  "chat",
  "email_draft",
  "email_reply",
  "summary",
]);

const TEXT_TASK_KINDS = new Set([
  "inbound_email_reply",
  "threadTitle",
  "query_respond",
]);

const REASONING_TASKS = new Set([
  "analysis",
  "extraction",
  "extraction_preview",
  "extraction_coverage_recovery",
  "requirement_extraction",
  "org_memory_extraction",
  "email_extraction",
  "document_extraction",
  "triage",
  "classification",
  "security",
]);

const AGENT_TOOL_TASKS = new Set(["mailbox_coordinator"]);

const AGENT_TOOL_TASK_KINDS = new Set([
  "email_draft_tool_loop",
  "mailbox_coordinate",
  "operator_agent",
  "query_reason",
  "query_plan",
  "query_verify",
  "query_attachment",
]);

function isExtractionFamily(task?: string, taskKind?: string): boolean {
  return (
    (task?.startsWith("extraction") ?? false) ||
    (taskKind?.startsWith("extraction_") ?? false) ||
    task === "requirement_extraction" ||
    task === "org_memory_extraction" ||
    task === "email_extraction" ||
    task === "document_extraction" ||
    taskKind === "requirement_extraction" ||
    taskKind === "company_information_document_extraction" ||
    taskKind === "company_information_email_extraction" ||
    taskKind === "extraction_review" ||
    taskKind === "extraction_focused" ||
    taskKind === "client_file_name_inference"
  );
}

function isReasoningFamily(task?: string, taskKind?: string): boolean {
  if (isExtractionFamily(task, taskKind)) return true;
  if (task && REASONING_TASKS.has(task)) return true;
  if (taskKind?.startsWith("pce_")) return true;
  return (
    taskKind === "query_reason" ||
    taskKind === "query_plan" ||
    taskKind === "query_verify" ||
    taskKind === "carrier_identity_selection"
  );
}

function isAgentToolTurn(task?: string, taskKind?: string): boolean {
  return (
    (task !== undefined && AGENT_TOOL_TASKS.has(task)) ||
    (taskKind !== undefined && AGENT_TOOL_TASK_KINDS.has(taskKind))
  );
}

function compactRequirements(
  flags: ClRouterRequirements,
): ClRouterRequirements | undefined {
  const requirements: ClRouterRequirements = {};
  if (flags.vision) requirements.vision = true;
  if (flags.tools) requirements.tools = true;
  if (flags.structuredOutput) requirements.structuredOutput = true;
  if (
    flags.minInputTokens !== undefined &&
    Number.isFinite(flags.minInputTokens)
  ) {
    requirements.minInputTokens = flags.minInputTokens;
  }
  return Object.keys(requirements).length > 0 ? requirements : undefined;
}

function mapped(
  primitive: ClRouterPrimitive,
  flags: ClRouterRequirements = {},
): SpotPrimitiveMapping {
  const requirements = compactRequirements(flags);
  return requirements ? { primitive, requirements } : { primitive };
}

/**
 * Map a Spot call to the frozen cl-router primitive contract.
 *
 * Capability overrides:
 * - vision + tools → `multimodal` + `requirements.tools`
 * - tools, no vision, agent/tool-loop → `tool_use`
 * - schema only → keep the table primitive and set `structuredOutput`
 *
 * Exception: ordinary `chat` / `email_*` / `summary` calls that send tools
 * keep `text` + `requirements.tools` rather than upgrading to `tool_use`.
 * Authenticated agent turns are identified by taskKind (`query_reason`,
 * `email_draft_tool_loop`, `mailbox_coordinate`, `operator_agent`, …).
 */
export function mapSpotCallToClRouterPrimitive(
  input: SpotPrimitiveMappingInput,
): SpotPrimitiveMapping {
  const { task, taskKind, hasTools, hasVision, hasStructuredOutput } = input;
  const structured = { structuredOutput: Boolean(hasStructuredOutput) };

  if (task === "embeddings") return mapped("embedding");
  if (task === "voice_transcription") return mapped("transcription");

  if (hasVision && hasTools) {
    return mapped("multimodal", { ...structured, tools: true });
  }

  if (hasVision) {
    if (isExtractionFamily(task, taskKind) || task === "chat_vision") {
      return mapped("multimodal", structured);
    }
    if (isReasoningFamily(task, taskKind)) {
      return mapped("reasoning", { ...structured, vision: true });
    }
    return mapped("multimodal", structured);
  }

  if (hasTools && isAgentToolTurn(task, taskKind)) {
    return mapped("tool_use", structured);
  }

  if (isReasoningFamily(task, taskKind) || isExtractionFamily(task, taskKind)) {
    return mapped("reasoning", { ...structured, tools: Boolean(hasTools) });
  }

  if (
    (task !== undefined && TEXT_TASKS.has(task)) ||
    (taskKind !== undefined && TEXT_TASK_KINDS.has(taskKind))
  ) {
    return mapped("text", { ...structured, tools: Boolean(hasTools) });
  }

  if (hasTools) return mapped("tool_use", structured);
  return mapped("text", structured);
}
