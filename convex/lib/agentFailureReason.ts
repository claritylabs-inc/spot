import { RouterJobFailed } from "./routerJobClient";

const SAFE_CODE = /^[a-z0-9_.:-]{1,64}$/;

const ROUTER_CODE_REASONS: Record<string, string> = {
  router_candidates_exhausted:
    "Every model the router tried rejected or failed this request.",
  router_payload_too_large: "The request was too large for the model service.",
};

function routerReason(code: string | undefined) {
  if (code && SAFE_CODE.test(code))
    return (
      ROUTER_CODE_REASONS[code] ??
      `The model service failed this request (${code}).`
    );
  return "The model service failed this request.";
}

/**
 * Safe, categorized summary of why an agent turn failed. It names only the
 * failure class or router code; raw messages, provider payloads and prompts
 * stay in the run's stored error and router job for diagnosis.
 */
export function describeAgentFailure(error: unknown): string {
  if (error instanceof RouterJobFailed) return routerReason(error.failure?.code);
  if (error instanceof Error) {
    if (error.name === "AgentIncompleteOutputError")
      return error.message.includes("output limit")
        ? "The model reached its output limit before answering."
        : "The model finished without producing an answer.";
    const routerCode = (error as { routerCode?: unknown }).routerCode;
    if (typeof routerCode === "string") return routerReason(routerCode);
  }
  return "An unexpected error stopped the run. The technical detail is recorded on the run.";
}
