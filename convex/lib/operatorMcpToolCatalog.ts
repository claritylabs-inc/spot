import { z } from "zod";

import {
  OPERATOR_AGENT_TOOL_REGISTRY,
  type OperatorToolRole,
} from "./operatorAgentToolRegistry";

function oauthSecuritySchemes(scopes: Array<"read" | "write">) {
  return [{ type: "oauth2" as const, scopes }];
}

export function buildOperatorMcpToolCatalog(args: {
  canWrite: boolean;
  operatorRole: OperatorToolRole;
  toolNames?: readonly string[];
}) {
  const available = args.toolNames ? new Set(args.toolNames) : undefined;
  const registeredTools = Object.entries(OPERATOR_AGENT_TOOL_REGISTRY)
    .filter(([name, spec]) => {
      if (!spec.offered || spec.agentOnly || (available && !available.has(name)))
        return false;
      if (spec.requiredRole === "owner" && args.operatorRole !== "owner") {
        return false;
      }
      return spec.effect === "read" || args.canWrite;
    })
    .map(([name, spec]) => {
      const write = spec.effect !== "read";
      const inputSchema = z.toJSONSchema(spec.inputSchema, {
        io: "input",
      }) as Record<string, unknown>;
      delete inputSchema.$schema;
      inputSchema.properties = {
        ...((inputSchema.properties as Record<string, unknown> | undefined) ??
          {}),
        idempotency_key: {
          type: "string",
          maxLength: 200,
          description:
            "Optional caller-generated unique key for safe retries of this exact invocation",
        },
      };
      return {
        name,
        title: spec.description.split(".")[0],
        description: spec.description,
        inputSchema,
        securitySchemes: oauthSecuritySchemes(
          write ? ["read", "write"] : ["read"],
        ),
        annotations: {
          readOnlyHint: !write,
          destructiveHint: spec.effect === "destructive",
          idempotentHint: spec.effect === "read",
          openWorldHint: spec.openWorld,
        },
      };
    });

  const taskTools = [
    {
      name: "run_operator_task",
      title: "Run a durable operator task",
      description:
        "Start or continue a durable internal Spot operator task. The agent can investigate across operator systems, invoke registered tools, start parallel subtasks, pause for exact confirmation, and resume on any internal channel. Without thread_id or conversation_key, a call joins this connection's default conversation unless a task is already running there; then it starts its own conversation, so parallel callers never cancel each other. Continuing a busy conversation (thread_id or conversation_key) follows if_busy: queue (default) waits and starts when the current task finishes, steer adds the objective as guidance to your own running task at its next step, replace stops your own task and starts this one. Another operator's task is never stopped or steered: steer queues instead and replace is rejected. Returns delivery (started, queued or steered) and threadId, with runId once a run exists and inputId for a queued or steering message; watch it with get_operator_run and wait_seconds.",
      inputSchema: {
        type: "object" as const,
        properties: {
          objective: {
            type: "string",
            description: "The concrete operator objective to complete",
          },
          thread_id: {
            type: "string",
            description:
              "Optional operator thread ID to continue (from an earlier result); if_busy decides what happens while it has a task in progress",
          },
          conversation_key: {
            type: "string",
            description:
              "Optional stable client conversation key when no thread ID is available",
          },
          if_busy: {
            type: "string",
            enum: ["queue", "steer", "replace"],
            description:
              "With thread_id or conversation_key, what to do while that conversation has a task in progress: queue (default) starts this objective after it, steer gives it to your own running task as guidance, replace stops your own task first",
          },
          attachments: {
            type: "array",
            description:
              "Optional PDF, spreadsheet, image, document, or text files for the operator agent to inspect",
            items: {
              type: "object",
              properties: {
                filename: {
                  type: "string",
                  description: "Original filename including its extension",
                },
                content_type: {
                  type: "string",
                  description:
                    "Optional MIME type; filename detection is used when omitted",
                },
                data_base64: {
                  type: "string",
                  description:
                    "The complete file encoded as base64; each inline file is limited to 12 MB and the request to 14 MB decoded",
                },
              },
              required: ["filename", "data_base64"],
            },
          },
          idempotency_key: {
            type: "string",
            maxLength: 200,
            description:
              "Optional caller-generated unique key for safe retries of this exact task",
          },
        },
        required: ["objective"],
      },
      securitySchemes: oauthSecuritySchemes(["read", "write"]),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    {
      name: "get_operator_run",
      title: "Get an operator task result",
      description:
        "Read an operator run: status, iteration, executionCount, lastToolName, step tool names, failure, response, checkpoint and metadata-only timing (per-iteration phase durations, model calls with router job and request IDs, tool execution times, and a run summary). Accepts the runId from run_operator_task or read_operator_conversation, or the inputId of a queued or steering run_operator_task: input shows its status (pending until its turn starts, started, applied once steered, cancelled or failed) and the run once it has one. Other operators' runs return a compact view without tool outputs. wait_seconds (up to 60) waits until the input starts and the run is completed, failed, cancelled or waiting_confirmation before answering; call again while it is pending, queued or running.",
      inputSchema: {
        type: "object" as const,
        properties: {
          run_id: { type: "string", description: "Operator run ID; omit when passing input_id" },
          input_id: {
            type: "string",
            description:
              "inputId from run_operator_task when it was queued or steered; use instead of run_id",
          },
          wait_seconds: {
            type: "integer",
            minimum: 0,
            maximum: 60,
            description:
              "Optional seconds to wait for the run to finish or pause for approval; omit to read it now",
          },
        },
      },
      securitySchemes: oauthSecuritySchemes(["read"]),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "cancel_operator_run",
      title: "Cancel an operator task",
      description:
        "Stop one queued, running or approval-waiting operator run you started, with the subtasks it started; its pending approval is withdrawn and completed writes are kept. Another operator's run cannot be stopped.",
      inputSchema: {
        type: "object" as const,
        properties: {
          run_id: { type: "string", description: "Operator run ID" },
        },
        required: ["run_id"],
      },
      securitySchemes: oauthSecuritySchemes(["read", "write"]),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "confirm_operator_action",
      title: "Approve or reject an operator action",
      description:
        "Resolve a pending exact operator confirmation. Approval executes only the fingerprinted action shown by the agent.",
      inputSchema: {
        type: "object" as const,
        properties: {
          confirmation_id: {
            type: "string",
            description: "Pending confirmation ID",
          },
          thread_id: {
            type: "string",
            description: "Operator thread containing the confirmation",
          },
          decision: {
            type: "string",
            enum: ["approve", "reject"],
          },
        },
        required: ["thread_id", "confirmation_id", "decision"],
      },
      securitySchemes: oauthSecuritySchemes(["read", "write"]),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ];

  return [
    ...registeredTools,
    ...(args.canWrite
      ? taskTools
      : taskTools.filter(({ name }) => name === "get_operator_run")),
  ];
}
