import { z } from "zod";
import type {
  DecideRequest,
  DecideResponse,
  DecisionQuestion,
} from "../../contracts/cl-router/policy";
import { clRouterDecide, type ClRouterClientOptions } from "./clRouterClient";
import { jevProceedThreshold } from "./jevThreshold";

export const EXPAND_TOOLS_NAME = "expand_tools";

// Lookups needed to use another family's tools; never register unavailable tools.
// Replies need the team inbox reads that left outbound_email for team_inbox.
export const AGENT_TOOL_FAMILY_LOOKUPS: Record<string, readonly string[]> = {
  // Request research (research_procurement_information) is awaited with the
  // organizations family's status read.
  procurement: ["get_research_status"],
  organizations: ["list_operators", "lookup_client_wiki"],
  outbound_email: [
    "list_client_files",
    "get_procurement_request",
    "list_team_inbox_threads",
    "get_team_inbox_thread",
    "search_team_inbox",
  ],
};

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
  const active = new Set(
    selected.flatMap((family) => [
      ...catalog[family].tools,
      ...(AGENT_TOOL_FAMILY_LOOKUPS[family] ?? []),
    ]),
  );
  return toolNames.filter((name) => !grouped.has(name) || active.has(name));
}

/**
 * Opt-in policy for families Jev is unsure about: a missing family costs a
 * full model step, while an extra one costs only cached prompt tokens.
 */
export type AgentToolFamilyLoadPolicy<Family extends string> = {
  /** Lowest probability that may load a family when the budget allows. */
  loadThreshold: number;
  /** Estimated tokens for every tool offered by the selected families. */
  budgetTokens: number;
  cost: (families: readonly Family[]) => number;
};

/**
 * Required and confident families always load. Uncertain-band families then
 * load from most to least likely while the offered tools stay in budget.
 */
export function composeAgentToolFamilies<Family extends string>(
  candidates: readonly Family[],
  probabilities: Readonly<Record<string, number>>,
  required: readonly Family[],
  confidentThreshold: number,
  policy?: AgentToolFamilyLoadPolicy<Family>,
): Family[] {
  const ranked = candidates
    .filter((family) => probabilities[family] !== undefined)
    .sort((left, right) => probabilities[right] - probabilities[left]);
  const selected = [
    ...required,
    ...ranked.filter((family) => probabilities[family] >= confidentThreshold),
  ];
  if (!policy) return selected;
  for (const family of ranked) {
    const probability = probabilities[family];
    if (
      probability < confidentThreshold &&
      probability >= policy.loadThreshold &&
      policy.cost([...selected, family]) <= policy.budgetTokens
    )
      selected.push(family);
  }
  return selected;
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
    loadPolicy?: AgentToolFamilyLoadPolicy<Family>;
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
            `Does \`request\` or \`message\` need tools for ${args.catalog[family].description}?`,
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
    for (const family of candidates) {
      const answer = result.answers[family];
      if (answer?.type === "noul") probabilities[family] = answer.noul;
    }
    const selected = composeAgentToolFamilies(
      candidates,
      probabilities,
      required,
      jevProceedThreshold(),
      args.loadPolicy,
    );
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

/**
 * Whether a run's first step omits expand_tools: its initial selection
 * (intent, Jev or carryover) already loaded a domain family, so the model acts
 * with what it has. A core-only step keeps it. A resumed step whose stored
 * families were missing falls back to every family and keeps it too, because
 * its submission may have offered expand_tools and a replayed response may
 * call it; offering more tools than the submission is safe, fewer is not.
 */
export function withholdExpandToolsOnFirstStep(step: {
  iteration: number;
  loadedFamilyCount: number;
  replayFallback: boolean;
}) {
  return (
    step.iteration === 0 && step.loadedFamilyCount > 0 && !step.replayFallback
  );
}

export type ExpandToolsOptions<Family extends string> = {
  /** Retired family names still accepted from models and stored audits. */
  aliases?: Readonly<Record<string, Family>>;
  /** List each family's tools so a tool name can be requested directly. */
  listTools?: boolean;
};

export function expandToolsSpec<Family extends string>(
  catalog: AgentToolFamilyCatalog<Family>,
  families: readonly Family[],
  toolNames: readonly string[] = [],
  options: ExpandToolsOptions<Family> = {},
) {
  const grouped = new Set(
    familyNames(catalog).flatMap((family) => catalog[family].tools),
  );
  const registered = new Set(toolNames);
  const coreTools = new Set(toolNames.filter((name) => !grouped.has(name)));
  const names = z.union([
    z.string().min(1).max(200),
    z.array(z.string().min(1).max(200)).min(1).max(50),
  ]);
  const available = options.listTools
    ? families
        .map((family) => {
          const tools = catalog[family].tools.filter((name) =>
            registered.has(name),
          );
          return `${family} (${tools.join(", ")})`;
        })
        .join("; ")
    : families.join(", ");
  return {
    description: `Load families or named tools for the next step; loaded families stay available. No business writes. Use families (string or array); family, tool_families and tools are aliases. Never request a family or tool you already have. Available: ${available}.`,
    inputSchema: z
      .object({
        families: names.optional(),
        family: names.optional(),
        tool_families: names.optional(),
        tools: names.optional(),
      })
      .transform((input, ctx) => {
        const requested = Object.values(input)
          .flatMap((value) => value ?? [])
          // Models sometimes pass a JSON array as one string: `["a", "b"]`.
          .flatMap((name) => name.split(/[\s,[\]"'`]+/).filter(Boolean));
        const resolved = new Set<Family>();
        const tools = new Set<string>();
        for (const name of requested) {
          if (coreTools.has(name)) {
            tools.add(name);
            continue;
          }
          const alias = options.aliases?.[name];
          const family = families.find(
            (family) =>
              family === name ||
              family === alias ||
              catalog[family].tools.includes(name),
          );
          if (family) {
            resolved.add(family);
            if (catalog[family].tools.includes(name)) tools.add(name);
          } else
            ctx.addIssue({
              code: "custom",
              message: `Unknown or unavailable family/tool ${name}. Valid families: ${families.join(", ")}. Request a tool by its exact name to load the family that has it.`,
            });
        }
        if (!requested.length)
          ctx.addIssue({
            code: "custom",
            message: `Provide families, family, tool_families or tools. Valid families: ${families.join(", ")}.`,
          });
        return { families: [...resolved], tools: [...tools] };
      }),
  };
}

/**
 * What one expand_tools call achieved. Loaded families and callable tools
 * answer "call them now" so the model does not spend another step asking.
 */
export function expandToolsResult<Family extends string>(
  request: { families: readonly Family[]; tools: readonly string[] },
  loadedFamilies: readonly Family[],
  callableTools: ReadonlySet<string>,
  toolsFor: (families: readonly Family[]) => readonly string[],
) {
  const added = request.families.filter(
    (family) => !loadedFamilies.includes(family),
  );
  const alreadyLoaded = request.families.filter((family) =>
    loadedFamilies.includes(family),
  );
  const callableNow = [
    ...new Set([...request.tools, ...toolsFor(alreadyLoaded)]),
  ].filter((name) => callableTools.has(name));
  const nextStep = toolsFor(added).filter((name) => !callableTools.has(name));
  if (!added.length)
    return {
      status: "already_available" as const,
      families: [],
      alreadyLoaded,
      callableNow,
      note: callableNow.length
        ? `Everything requested is already loaded. Call these tools now instead of expand_tools: ${callableNow.join(", ")}.`
        : "Everything requested is already loaded. Call the tools you need now instead of expand_tools.",
    };
  return {
    status: "available_next_step" as const,
    families: added,
    alreadyLoaded,
    nextStepTools: nextStep,
    ...(callableNow.length ? { callableNow } : {}),
    note: `These tools become available on your next step: ${nextStep.join(", ") || "none new"}. If none of them is what you need, request the exact tool name instead.`,
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
