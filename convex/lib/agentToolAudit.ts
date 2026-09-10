import type { WorkflowOutcome } from "./workflows/types";
import { parseWorkflowOutcome } from "./workflows/types";

export type AgentToolAudit = {
  usedTools: string[];
  completedTools: string[];
  toolCalls: Array<{ name: string; input?: string; output?: string }>;
  workflowOutcomes: WorkflowOutcome[];
};

function serializeToolAuditValue(
  value: unknown,
  preserveContinuation = false,
): string | undefined {
  if (value === undefined) return undefined;
  try {
    if (preserveContinuation && value && typeof value === "object") {
      const wrapped = "result" in value ? value.result : value;
      if (
        wrapped &&
        typeof wrapped === "object" &&
        "nextCursor" in wrapped &&
        typeof wrapped.nextCursor === "string" &&
        wrapped.nextCursor.startsWith("gws:")
      ) {
        return JSON.stringify({
          continuation: {
            nextCursor: wrapped.nextCursor,
            completeness:
              "completeness" in wrapped ? wrapped.completeness : undefined,
          },
          value,
        }).slice(0, 500);
      }
    }
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return String(value).slice(0, 500);
  }
}

export function collectToolAudit(result: unknown): AgentToolAudit {
  const usedTools: string[] = [];
  const completedTools: string[] = [];
  const toolCalls: AgentToolAudit["toolCalls"] = [];
  const workflowOutcomes: WorkflowOutcome[] = [];
  const seenTools = new Set<string>();
  const seenCompletedTools = new Set<string>();

  const addUsedTool = (name: string) => {
    if (seenTools.has(name)) return;
    seenTools.add(name);
    usedTools.push(name);
  };

  const addToolCall = (call: Record<string, unknown>) => {
    const name = call.toolName ?? call.name;
    if (typeof name !== "string" || !name) return;
    addUsedTool(name);
    const input = call.input ?? call.args ?? call.parameters;
    toolCalls.push({
      name,
      input: serializeToolAuditValue(input),
    });
  };

  const addToolResult = (resultPart: Record<string, unknown>) => {
    const name = resultPart.toolName ?? resultPart.name;
    if (typeof name !== "string" || !name) return;
    addUsedTool(name);
    if (!seenCompletedTools.has(name)) {
      seenCompletedTools.add(name);
      completedTools.push(name);
    }
    const output =
      resultPart.output ?? resultPart.result ?? resultPart.value ?? undefined;
    if (output && typeof output === "object" && "workflowOutcome" in output) {
      const workflowOutcome = parseWorkflowOutcome(
        (output as Record<string, unknown>).workflowOutcome,
      );
      if (workflowOutcome) workflowOutcomes.push(workflowOutcome);
    }
    const target = [...toolCalls]
      .reverse()
      .find((candidate) => candidate.name === name && !candidate.output);
    if (target) {
      target.output = serializeToolAuditValue(output, true);
    }
  };

  const addStepAudit = (step: unknown) => {
    if (!step || typeof step !== "object") return;
    const stepRecord = step as Record<string, unknown>;
    const calls = Array.isArray(stepRecord.toolCalls)
      ? stepRecord.toolCalls
      : [];
    for (const call of calls) {
      if (call && typeof call === "object") {
        addToolCall(call as Record<string, unknown>);
      }
    }
    const results = Array.isArray(stepRecord.toolResults)
      ? stepRecord.toolResults
      : [];
    for (const toolResult of results) {
      if (toolResult && typeof toolResult === "object") {
        addToolResult(toolResult as Record<string, unknown>);
      }
    }
  };

  const root = result as Record<string, unknown>;
  const steps = Array.isArray(root.steps) ? root.steps : [];
  if (steps.length > 0) {
    for (const step of steps) addStepAudit(step);
  } else {
    addStepAudit(root);
  }

  return { usedTools, completedTools, toolCalls, workflowOutcomes };
}

export function mergeToolAudits(
  first: AgentToolAudit,
  second: AgentToolAudit,
): AgentToolAudit {
  return {
    usedTools: [...new Set([...first.usedTools, ...second.usedTools])],
    completedTools: [
      ...new Set([...first.completedTools, ...second.completedTools]),
    ],
    toolCalls: [...first.toolCalls, ...second.toolCalls],
    workflowOutcomes: [...first.workflowOutcomes, ...second.workflowOutcomes],
  };
}
