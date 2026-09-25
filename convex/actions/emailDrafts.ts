"use node";

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { resolveEmailAgentIdentity } from "../lib/emailIdentity";
import {
  buildEmailToolExecutors,
  serializeEmailDraft,
} from "../lib/emailTools";
import { buildEmailDraftTextSummary } from "../lib/emailDraftSummary";

type McpEmailArgs = {
  orgId: Id<"organizations">;
  userId?: Id<"users">;
  name: string;
  input: Record<string, unknown>;
};

type SerializedDraft = ReturnType<typeof serializeEmailDraft> | null;
type BatchResult = {
  sent: Array<{ id: Id<"pendingEmails">; recipientEmail: string }>;
  failed: Array<{ id: Id<"pendingEmails">; error: string }>;
  summary: string;
};

type McpEmailResult = SerializedDraft | BatchResult | string;

function stringArray(input: unknown): string[] {
  return Array.isArray(input)
    ? input.filter((value): value is string => typeof value === "string")
    : [];
}

function requiredDraftId(input: Record<string, unknown>): Id<"pendingEmails"> {
  if (typeof input.draftId !== "string" || !input.draftId) {
    throw new Error("Missing draftId parameter");
  }
  return input.draftId as Id<"pendingEmails">;
}

async function requireDraft(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  draftId: Id<"pendingEmails">,
): Promise<Doc<"pendingEmails">> {
  const draft = await ctx.runQuery(internal.pendingEmails.getInternal, {
    id: draftId,
  });
  if (!draft || draft.orgId !== orgId || draft.status !== "draft") {
    throw new Error(`Draft ${draftId} not found`);
  }
  return draft;
}

async function getSerializedDraft(
  ctx: ActionCtx,
  id: Id<"pendingEmails">,
): Promise<SerializedDraft> {
  const draft = await ctx.runQuery(internal.pendingEmails.getInternal, { id });
  return draft ? serializeEmailDraft(draft) : null;
}

async function toolsForMcp(
  ctx: ActionCtx,
  args: McpEmailArgs,
  threadId?: Id<"threads">,
): Promise<ReturnType<typeof buildEmailToolExecutors>> {
  const org = await ctx.runQuery(internal.orgs.getInternal, {
    id: args.orgId,
  });
  if (!org) throw new Error("Organization not found");
  const user = args.userId
    ? await ctx.runQuery(internal.users.getInternal, { id: args.userId })
    : null;
  const identity = resolveEmailAgentIdentity(org);
  const writesContent =
    args.name === "draft_email" || args.name === "update_email_draft";
  if (
    writesContent &&
    (!identity.canSend || !identity.agentAddress || !identity.fromHeader)
  ) {
    throw new Error(identity.reason ?? "Email sending is not configured.");
  }
  return buildEmailToolExecutors(ctx, {
    orgId: args.orgId,
    userId: args.userId,
    threadId,
    routingParentId: crypto.randomUUID(),
    channel: "mcp",
    fromHeader: identity.fromHeader ?? "",
    agentAddress: identity.agentAddress ?? "",
    senderEmail: user?.email,
    defaultBcc:
      org.bccRequesterOnAgentEmails !== false && user?.email
        ? [user.email]
        : undefined,
    ...(writesContent
      ? { mcpOriginalPolicyIds: stringArray(args.input.originalPolicyIds) }
      : {}),
    ...(args.name === "send_email_draft" || args.name === "send_email_drafts"
      ? { sendAuthorization: { kind: "mcp_explicit_action" as const } }
      : {}),
  });
}

export function executeMcpEmailTool(
  ctx: ActionCtx,
  args: McpEmailArgs & {
    name:
      | "draft_email"
      | "update_email_draft"
      | "send_email_draft"
      | "cancel_email_draft";
  },
): Promise<SerializedDraft>;
export function executeMcpEmailTool(
  ctx: ActionCtx,
  args: McpEmailArgs & { name: "send_email_drafts" },
): Promise<BatchResult>;
export function executeMcpEmailTool(
  ctx: ActionCtx,
  args: McpEmailArgs & { name: "list_email_drafts" },
): Promise<string>;
export function executeMcpEmailTool(
  ctx: ActionCtx,
  args: McpEmailArgs,
): Promise<McpEmailResult>;
export async function executeMcpEmailTool(
  ctx: ActionCtx,
  args: McpEmailArgs,
): Promise<McpEmailResult> {
  const { input, name, orgId } = args;
  if (name === "send_email_drafts") {
    const draftIds = [
      ...new Set(stringArray(input.draftIds)),
    ] as Id<"pendingEmails">[];
    if (draftIds.length === 0) throw new Error("Missing draftIds parameter");
    // Validate the whole batch before a shared tool can send its first draft.
    const drafts: Doc<"pendingEmails">[] = [];
    for (const id of draftIds) drafts.push(await requireDraft(ctx, orgId, id));
    const tools = await toolsForMcp(ctx, args);
    const sent: BatchResult["sent"] = [];
    const failed: BatchResult["failed"] = [];
    for (const draft of drafts) {
      try {
        const result = await tools.send_email_draft.execute({
          draftId: draft._id,
        });
        if (result.status !== "sent") throw new Error(result.responseBody);
        sent.push({ id: draft._id, recipientEmail: draft.recipientEmail });
      } catch (error) {
        failed.push({
          id: draft._id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return {
      sent,
      failed,
      summary:
        failed.length === 0
          ? `Sent ${sent.length} email${sent.length === 1 ? "" : "s"}.`
          : `Sent ${sent.length} email${sent.length === 1 ? "" : "s"}; ${failed.length} failed.`,
    };
  }

  if (name === "draft_email" || name === "update_email_draft") {
    const draftId =
      name === "update_email_draft" ? requiredDraftId(input) : undefined;
    if (!input.to || !input.subject || !input.body) {
      throw new Error("Missing to, subject, or body parameter");
    }
    const existing = draftId
      ? await requireDraft(ctx, orgId, draftId)
      : undefined;
    const tools = await toolsForMcp(
      ctx,
      args,
      existing?.threadId ??
        (typeof input.threadId === "string"
          ? (input.threadId as Id<"threads">)
          : undefined),
    );
    const fields = {
      to: input.to as string,
      subject: input.subject as string,
      body: input.body as string,
      cc: stringArray(input.cc),
      bcc: stringArray(input.bcc),
      recipientDirection: "explicit" as const,
    };
    const result = draftId
      ? await tools.update_email_draft.execute(
          tools.update_email_draft.inputSchema.parse({ ...fields, draftId }),
        )
      : await tools.draft_email.execute(
          tools.draft_email.inputSchema.parse(fields),
        );
    if (result.status === "error" || !result.pendingEmailId) {
      throw new Error(result.responseBody || "Failed to create email draft.");
    }
    return await getSerializedDraft(ctx, result.pendingEmailId);
  }

  if (name === "list_email_drafts") {
    const tools = await toolsForMcp(ctx, args);
    const result = await tools.list_email_drafts.execute({
      threadId:
        typeof input.threadId === "string" && input.threadId
          ? input.threadId
          : undefined,
    });
    const drafts = result.drafts.map((draft) => ({ ...draft, _id: draft.id }));
    return drafts.length > 0
      ? buildEmailDraftTextSummary(drafts, {
          sampleSize: input.showAll === true ? drafts.length : 3,
          includeIds: true,
          commands: "mcp",
        })
      : "No email drafts found.";
  }

  if (name === "send_email_draft" || name === "cancel_email_draft") {
    const draftId = requiredDraftId(input);
    const draft = await requireDraft(ctx, orgId, draftId);
    const tools = await toolsForMcp(ctx, args, draft.threadId);
    const result =
      name === "send_email_draft"
        ? await tools.send_email_draft.execute({ draftId })
        : await tools.cancel_email_draft.execute({ draftId });
    if (
      result.status === "error" ||
      (name === "send_email_draft" && result.status !== "sent")
    ) {
      throw new Error(result.responseBody);
    }
    return await getSerializedDraft(ctx, draftId);
  }
  throw new Error(`Unknown MCP email tool: ${name}`);
}

export const upsertForMcp = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    draftId: v.optional(v.id("pendingEmails")),
    threadId: v.optional(v.id("threads")),
    to: v.string(),
    subject: v.string(),
    body: v.string(),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    originalPolicyIds: v.optional(v.array(v.id("policies"))),
  },
  handler: async (ctx, args): Promise<SerializedDraft> =>
    executeMcpEmailTool(ctx, {
      orgId: args.orgId,
      userId: args.userId,
      name: args.draftId ? "update_email_draft" : "draft_email",
      input: args,
    }),
});

export const sendForMcp = internalAction({
  args: { orgId: v.id("organizations"), draftId: v.id("pendingEmails") },
  handler: async (ctx, args): Promise<SerializedDraft> =>
    executeMcpEmailTool(ctx, {
      orgId: args.orgId,
      name: "send_email_draft",
      input: args,
    }),
});

export const sendManyForMcp = internalAction({
  args: {
    orgId: v.id("organizations"),
    draftIds: v.array(v.id("pendingEmails")),
  },
  handler: async (ctx, args): Promise<BatchResult> =>
    executeMcpEmailTool(ctx, {
      orgId: args.orgId,
      name: "send_email_drafts",
      input: args,
    }),
});

export const cancelForMcp = internalAction({
  args: { orgId: v.id("organizations"), draftId: v.id("pendingEmails") },
  handler: async (ctx, args): Promise<SerializedDraft> =>
    executeMcpEmailTool(ctx, {
      orgId: args.orgId,
      name: "cancel_email_draft",
      input: args,
    }),
});
