/**
 * Spot → cl-router primitive mapping. The primitive and requirement vocabulary
 * comes from `contracts/cl-router/policy.ts`; the internal task/taskKind
 * mapping below is Spot-owned.
 */

import type {
  Difficulty,
  Primitive,
  QualityTier,
} from "../../contracts/cl-router/policy";

export type ClRouterPrimitive = Primitive;
export type ClRouterDifficulty = Difficulty;
export type ClRouterQualityTier = QualityTier;
export type ClRouterRoutingDecision = "routed" | "manual";
export type ClRouterRoutingSource = "jev" | "fallback" | "manual";

export type SpotPrimitiveMappingInput = {
  task?: string;
  taskKind?: string;
};

export type SpotPrimitiveMapping = {
  primitive: ClRouterPrimitive;
};

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

/** Capabilities and context size are inferred by cl-router from the payload. */
export function mapSpotCallToClRouterPrimitive({
  task,
  taskKind,
}: SpotPrimitiveMappingInput): SpotPrimitiveMapping {
  if (task === "embeddings") return { primitive: "embedding" };
  if (task === "voice_transcription") return { primitive: "transcription" };
  return {
    primitive: isReasoningFamily(task, taskKind) ? "reasoning" : "text",
  };
}
