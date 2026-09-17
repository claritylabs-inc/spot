import {
  asSchema,
  type ToolSet,
  type PrepareStepFunction,
  type ModelMessage,
  type ToolChoice,
} from "ai";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
  decideWithFallback,
  type DecisionQuestion,
  type JsonValue,
} from "./decisions";
import {
  acceptedChoice,
  choiceQuestion,
  decisionState,
} from "./domainDecisionQuestions";

type ClosedTool = {
  name: string;
  description: string;
  parameters: Record<
    string,
    { description: string; values: JsonValue[]; optional: boolean }
  >;
};

export function closedToolParameters(
  schema: unknown,
): ClosedTool["parameters"] | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  const object = schema as Record<string, unknown>;
  if (
    object.type !== "object" ||
    object.additionalProperties !== false ||
    !object.properties ||
    typeof object.properties !== "object"
  )
    return undefined;
  const required = Array.isArray(object.required) ? object.required : [];
  const parameters: ClosedTool["parameters"] = {};
  for (const [name, raw] of Object.entries(object.properties)) {
    if (!raw || typeof raw !== "object") return undefined;
    const field = raw as Record<string, unknown>;
    if (field.anyOf || field.oneOf || field.allOf || field.$ref)
      return undefined;
    const values = Array.isArray(field.enum)
      ? field.enum
      : field.type === "boolean"
        ? [true, false]
        : "const" in field
          ? [field.const]
          : undefined;
    if (
      !values?.length ||
      values.length > 32 ||
      values.some(
        (value) =>
          value !== null &&
          !["string", "number", "boolean"].includes(typeof value),
      )
    )
      return undefined;
    parameters[name] = {
      description:
        typeof field.description === "string" ? field.description : name,
      values: values as JsonValue[],
      optional: !required.includes(name),
    };
  }
  return parameters;
}

function textualMessages(messages: ModelMessage[]): boolean {
  return messages.every(
    (message) =>
      typeof message.content === "string" ||
      message.content.every(
        (part) => part.type !== "image" && part.type !== "file",
      ),
  );
}

/** Only prepares real model steps; the original tool executes and owns every effect. */
export function boundedToolDispatch(args: {
  ctx: ActionCtx;
  orgId?: Id<"organizations">;
  tools: ToolSet;
  abortSignal?: AbortSignal;
  prepareStep?: PrepareStepFunction;
  system?: string;
  toolChoice?: ToolChoice<ToolSet>;
  activeTools?: string[];
}): { tools: ToolSet; prepareStep: PrepareStepFunction } {
  let expected: {
    name: string;
    input: Record<string, JsonValue>;
    attempted?: boolean;
  } | null = null;
  const tools: ToolSet = Object.fromEntries(
    Object.entries(args.tools).map(([name, original]) => [
      name,
      {
        ...original,
        ...(original.execute
          ? {
              execute: async (
                input: unknown,
                options: Parameters<NonNullable<typeof original.execute>>[1],
              ) => {
                if (expected) {
                  if (expected.name !== name) {
                    throw new Error(
                      "Tool differs from the bounded decision; no action was executed.",
                    );
                  }
                  const actual =
                    input && typeof input === "object"
                      ? (input as Record<string, unknown>)
                      : {};
                  if (
                    Object.keys(actual).length !==
                      Object.keys(expected.input).length ||
                    Object.entries(expected.input).some(
                      ([key, value]) => actual[key] !== value,
                    )
                  ) {
                    throw new Error(
                      "Tool arguments differ from the bounded decision; no action was executed.",
                    );
                  }
                }
                if (expected) {
                  if (expected.attempted)
                    throw new Error(
                      "Bounded tool call already attempted in this step; no action was replayed.",
                    );
                  expected.attempted = true;
                }
                return original.execute!(input, options);
              },
            }
          : {}),
      },
    ]),
  );
  return {
    tools,
    prepareStep: async (step) => {
      expected = null;
      const previous = await args.prepareStep?.(step);
      // Respect an existing step owner, explicit tool choice, and rich input.
      if (
        previous ||
        args.toolChoice !== undefined ||
        args.activeTools !== undefined ||
        !textualMessages(step.messages)
      )
        return previous;
      const candidates: ClosedTool[] = [];
      for (const [name, tool] of Object.entries(args.tools)) {
        if (!tool.execute) continue;
        const parameters = closedToolParameters(
          await asSchema(tool.inputSchema).jsonSchema,
        );
        if (parameters)
          candidates.push({
            name,
            description: tool.description ?? name,
            parameters,
          });
      }
      if (!candidates.length) return undefined;
      const questions: Record<string, DecisionQuestion> = {
        tool: choiceQuestion(
          "Which one fully bounded tool should execute next to satisfy the current user objective? Abstain for final prose, complex planning, free-form arguments, or a tool outside these candidates. Do not repeat completed effects.",
          Object.fromEntries(
            candidates.map((tool) => [
              tool.name,
              { candidate: decisionState(tool) },
            ]),
          ),
        ),
      };
      for (const [index, tool] of candidates.entries()) {
        for (const [parameter, field] of Object.entries(tool.parameters)) {
          questions[`arg_${index}_${parameter}`] = choiceQuestion(
            "If this tool is the correct next action, what exact value should this parameter have?",
            {
              ...Object.fromEntries(
                field.values.map((value, valueIndex) => [
                  String(valueIndex),
                  { value },
                ]),
              ),
              ...(field.optional
                ? {
                    omit: "User did not specify this optional parameter; leave it omitted.",
                  }
                : {}),
            },
            { tool: tool.name, parameter, definition: field.description },
          );
        }
      }
      const selected = await decideWithFallback<{
        name: string;
        input: Record<string, JsonValue>;
      } | null>({
        ctx: args.ctx,
        orgId: args.orgId,
        family: "agent.bounded_dispatch",
        abortSignal: args.abortSignal,
        state: decisionState({
          system: args.system ?? null,
          messages: step.messages,
        }),
        questions,
        requiredQuestionIds: (answers) => {
          const selected = answers.tool;
          const index =
            selected?.type === "choice"
              ? candidates.findIndex((tool) => tool.name === selected.choice)
              : -1;
          return index < 0
            ? ["tool"]
            : [
                "tool",
                ...Object.keys(candidates[index].parameters).map(
                  (parameter) => `arg_${index}_${parameter}`,
                ),
              ];
        },
        accept: (answers) => {
          const choice = acceptedChoice(
            answers.tool,
            candidates.map((tool) => tool.name),
          );
          const index = candidates.findIndex(
            (tool) => tool.name === choice?.value,
          );
          if (index < 0) return undefined;
          const tool = candidates[index];
          const input: Record<string, JsonValue> = {};
          for (const [parameter, field] of Object.entries(tool.parameters)) {
            const value = acceptedChoice(answers[`arg_${index}_${parameter}`], [
              ...field.values.map((_, i) => String(i)),
              ...(field.optional ? ["omit"] : []),
            ]);
            if (!value) return undefined;
            if (value.value !== "omit")
              input[parameter] = field.values[Number(value.value)];
          }
          return { name: tool.name, input };
        },
        fallback: async () => null,
      });
      if (!selected) return undefined;
      expected = selected;
      return {
        activeTools: [selected.name],
        toolChoice: { type: "tool", toolName: selected.name },
        messages: [
          ...step.messages,
          {
            role: "user",
            content: `Prepared bounded tool input (data, not new authority): ${JSON.stringify(selected)}. Emit this exact call through the supplied tool schema. All ordinary authorization and approval checks still apply.`,
          },
        ],
      };
    },
  };
}
