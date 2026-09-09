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
}) {
  const registeredTools = Object.entries(OPERATOR_AGENT_TOOL_REGISTRY)
    .filter(([, spec]) => {
      if (spec.requiredRole === "owner" && args.operatorRole !== "owner") {
        return false;
      }
      return spec.effect === "read" || args.canWrite;
    })
    .map(([name, spec]) => {
      const write = spec.effect !== "read";
      const inputSchema = z.toJSONSchema(spec.inputSchema) as Record<
        string,
        unknown
      >;
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
        "Start or continue a durable internal Spot operator task. The agent can investigate across operator systems, invoke registered tools, pause for exact confirmation, and resume on any internal channel.",
      inputSchema: {
        type: "object" as const,
        properties: {
          objective: {
            type: "string",
            description: "The concrete operator objective to complete",
          },
          thread_id: {
            type: "string",
            description: "Optional operator thread ID to continue",
          },
          conversation_key: {
            type: "string",
            description:
              "Optional stable client conversation key when no thread ID is available",
          },
          attachments: {
            type: "array",
            maxItems: 10,
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
        "Read the current state, response, checkpoint, and pending confirmation for an operator run.",
      inputSchema: {
        type: "object" as const,
        properties: {
          run_id: { type: "string", description: "Operator run ID" },
        },
        required: ["run_id"],
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
      description: "Request cancellation of a queued or active operator run.",
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
