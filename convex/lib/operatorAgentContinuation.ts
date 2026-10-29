import type { AgentToolAudit } from "./agentToolAudit";

const OPERATOR_CHECKPOINT_MAX_CHARS = 6_000;
// Continuations up to this many serialized bytes are written as a document by
// the checkpoint mutation itself; larger ones are stored as a blob first.
// Well under the 1 MiB document limit.
export const OPERATOR_INLINE_CONTINUATION_BYTES = 512 * 1024;

export function shouldContinueOperatorRun(
  result: unknown,
  maximumSteps: number,
): boolean {
  if (!result || typeof result !== "object") return false;
  const steps = Array.isArray((result as { steps?: unknown[] }).steps)
    ? (result as { steps: unknown[] }).steps
    : [];
  if (steps.length < maximumSteps) return false;
  const lastStep = steps.at(-1);
  if (!lastStep || typeof lastStep !== "object") return false;
  return Array.isArray((lastStep as { toolCalls?: unknown[] }).toolCalls) &&
    (lastStep as { toolCalls: unknown[] }).toolCalls.length > 0;
}

export function buildOperatorRunCheckpointSummary(args: {
  previous?: string;
  audit: AgentToolAudit;
}): string {
  const calls = args.audit.toolCalls.map((call) =>
    [
      `Tool ${call.name}`,
      call.input ? `input=${call.input}` : undefined,
      call.output ? `output=${call.output}` : undefined,
    ]
      .filter(Boolean)
      .join("; "),
  );
  return [args.previous, ...calls]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n")
    .slice(-OPERATOR_CHECKPOINT_MAX_CHARS);
}
