import { z } from "zod";
import type {
  DecideRequest,
  DecideResponse,
  DecisionQuestion,
} from "../../contracts/cl-router/policy";
import { clRouterDecide, type ClRouterClientOptions } from "./clRouterClient";
import { jevProceeds } from "./jevThreshold";

export const EXPAND_TOOLS_NAME = "expand_tools";

export type AgentToolFamilyCatalog<Family extends string> = Record<
  Family,
  {
    description: string;
    tools: readonly string[];
    availabilityTools?: readonly string[];
    question?: string;
    guidance?: string;
  }
>;

export type AgentToolFamilySelection<Family extends string> = {
  families: Family[];
  availableFamilies: Family[];
  source: "intent" | "jev" | "fallback" | "resume";
  answers?: DecideResponse["answers"];
  requestId?: string;
  probabilities?: Record<string, number>;
};

function familyNames<Family extends string>(
  catalog: AgentToolFamilyCatalog<Family>,
): Family[] {
  return Object.keys(catalog) as Family[];
}

/** Empty availability lists represent guidance that needs no specific tool. */
export function availableAgentToolFamilies<Family extends string>(
  catalog: AgentToolFamilyCatalog<Family>,
  toolNames: Iterable<string>,
): Family[] {
  const registered = new Set(toolNames);
  return familyNames(catalog).filter((family) => {
    const required = catalog[family].availabilityTools ?? catalog[family].tools;
    return (
      required.length === 0 || required.some((name) => registered.has(name))
    );
  });
}

export function agentToolFamiliesOf<Family extends string>(
  catalog: AgentToolFamilyCatalog<Family>,
  toolNames: Iterable<string>,
): Family[] {
  const used = new Set(toolNames);
  return familyNames(catalog).filter((family) =>
    catalog[family].tools.some((name) => used.has(name)),
  );
}

/** Unassigned tools are core; selection never registers a missing tool. */
export function activeAgentToolNames<
  Family extends string,
  Name extends string,
>(
  catalog: AgentToolFamilyCatalog<Family>,
  toolNames: readonly Name[],
  selected: readonly Family[],
): Name[] {
  const grouped = new Set(
    familyNames(catalog).flatMap((family) => catalog[family].tools),
  );
  const active = new Set(selected.flatMap((family) => catalog[family].tools));
  return toolNames.filter((name) => !grouped.has(name) || active.has(name));
}

export async function selectAgentToolFamilies<Family extends string>(
  args: {
    catalog: AgentToolFamilyCatalog<Family>;
    toolNames: Iterable<string>;
    required?: readonly Family[];
    intentFamilies?: readonly Family[];
    resumed?: boolean;
    request: Omit<DecideRequest, "tenantId" | "questions">;
    extraQuestions?: Record<string, DecisionQuestion>;
    question?: (family: Family, description: string) => string;
  },
  options: ClRouterClientOptions = {},
): Promise<AgentToolFamilySelection<Family>> {
  const availableFamilies = availableAgentToolFamilies(
    args.catalog,
    args.toolNames,
  );
  const required = args.required ?? [];
  const selection = (
    families: readonly Family[],
    source: AgentToolFamilySelection<Family>["source"],
  ): AgentToolFamilySelection<Family> => ({
    families: availableFamilies.filter(
      (family) => families.includes(family) || required.includes(family),
    ),
    availableFamilies,
    source,
  });
  if (args.intentFamilies) return selection(args.intentFamilies, "intent");
  if (args.resumed) return selection(availableFamilies, "resume");
  const candidates = availableFamilies.filter(
    (family) => !required.includes(family),
  );
  const questions: Record<string, DecisionQuestion> = {
    ...Object.fromEntries(
      candidates.map((family) => [
        family,
        {
          type: "noul" as const,
          instructions:
            args.catalog[family].question ??
            args.question?.(family, args.catalog[family].description) ??
            `Does this request need tools for ${args.catalog[family].description}?`,
        },
      ]),
    ),
    ...args.extraQuestions,
  };
  if (Object.keys(questions).length === 0) return selection([], "jev");
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("Tool family selection timed out")),
    args.request.executionBudgetMs ?? 10_000,
  );
  const abortSignal = options.abortSignal
    ? AbortSignal.any([controller.signal, options.abortSignal])
    : controller.signal;
  let onAbort: () => void = () => undefined;
  try {
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(abortSignal.reason);
      if (abortSignal.aborted) onAbort();
      else abortSignal.addEventListener("abort", onAbort, { once: true });
    });
    const result = await Promise.race([
      clRouterDecide(
        { ...args.request, questions },
        { ...options, abortSignal },
      ),
      aborted,
    ]);
    const probabilities: Record<string, number> = {};
    const selected = candidates.filter((family) => {
      const answer = result.answers[family];
      if (answer?.type !== "noul") return false;
      probabilities[family] = answer.noul;
      return jevProceeds(answer.noul);
    });
    return {
      ...selection(selected, "jev"),
      answers: result.answers,
      requestId: result.requestId,
      probabilities,
    };
  } catch (error) {
    console.warn("Tool family selection unavailable", {
      task: args.request.task,
      error: error instanceof Error ? error.message : String(error),
    });
    return selection(availableFamilies, "fallback");
  } finally {
    clearTimeout(timer);
    abortSignal.removeEventListener("abort", onAbort);
  }
}

export function expandToolsSpec<Family extends string>(
  catalog: AgentToolFamilyCatalog<Family>,
  families: readonly Family[],
) {
  return {
    description: `Request tool families for the next step. Already selected families stay available; this call changes no records. Families: ${families.map((family) => `${family} (${catalog[family].description})`).join("; ")}.`,
    inputSchema: z.object({ families: z.array(z.enum(families)).min(1) }),
  };
}

export function assembleFamilyGuidance<Family extends string>(
  catalog: AgentToolFamilyCatalog<Family>,
  families: readonly Family[],
  modules: ReadonlyArray<{ families: readonly Family[]; text: string }> = [],
): string[] {
  return [
    ...new Set([
      ...families.flatMap((family) =>
        catalog[family].guidance ? [catalog[family].guidance] : [],
      ),
      ...modules
        .filter((module) =>
          module.families.some((family) => families.includes(family)),
        )
        .map((module) => module.text),
    ]),
  ];
}

export function agentToolSelectionArtifact<Family extends string>(
  selection: AgentToolFamilySelection<Family>,
  context: Record<string, unknown> = {},
) {
  return {
    type: "tool_selection",
    data: {
      ...context,
      families: selection.families,
      availableFamilies: selection.availableFamilies,
      source: selection.source,
      requestId: selection.requestId ?? null,
      probabilities: selection.probabilities ?? {},
    },
  };
}
