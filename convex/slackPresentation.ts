import dayjs from "dayjs";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { isSlackOperatorClassification } from "./lib/slackInteractions";

function actionsRevoked(presentation: Doc<"slackMessagePresentations">) {
  return (
    presentation.actionTokenRevokedAt !== undefined ||
    // Older plaintext fallbacks revoked controls by setting expiry to updatedAt.
    (presentation.actionTokenExpiresAt !== undefined &&
      presentation.actionTokenExpiresAt <= presentation.updatedAt)
  );
}

async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function interactionActor(
  ctx: MutationCtx,
  presentation: Doc<"slackMessagePresentations">,
  teamId: string,
  slackUserId: string,
) {
  const actor = await ctx.db
    .query("slackActors")
    .withIndex("slack_identity", (q) =>
      q
        .eq("connectionId", presentation.connectionId)
        .eq("teamId", teamId)
        .eq("slackUserId", slackUserId),
    )
    .first();
  if (
    !actor ||
    (actor.classification !== "customer_member" &&
      !isSlackOperatorClassification(actor.classification))
  ) {
    throw new Error("Slack actor is not authorized for this interaction");
  }
  return actor;
}

export const create = internalMutation({
  args: {
    orgId: v.id("organizations"),
    threadId: v.id("threads"),
    threadMessageId: v.id("threadMessages"),
    connectionId: v.id("slackWorkspaceConnections"),
    teamId: v.string(),
    channelId: v.string(),
    threadTs: v.optional(v.string()),
    mode: v.union(v.literal("message"), v.literal("stream")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("slackMessagePresentations")
      .withIndex("message", (q) =>
        q.eq("threadMessageId", args.threadMessageId),
      )
      .first();
    const [thread, message, connection] = await Promise.all([
      ctx.db.get(args.threadId),
      ctx.db.get(args.threadMessageId),
      ctx.db.get(args.connectionId),
    ]);
    if (
      !thread ||
      !message ||
      !connection ||
      thread.orgId !== args.orgId ||
      message.threadId !== thread._id ||
      connection.clientOrgId !== args.orgId ||
      thread.slackConnectionId !== connection._id
    ) {
      throw new Error("Slack presentation context is invalid");
    }
    if (existing) {
      if (
        existing.orgId !== args.orgId ||
        existing.threadId !== args.threadId ||
        existing.connectionId !== args.connectionId ||
        existing.teamId !== args.teamId ||
        existing.channelId !== args.channelId ||
        existing.threadTs !== args.threadTs
      ) {
        throw new Error("Slack presentation retry context does not match");
      }
      if (existing.phase === "final") {
        return { presentation: existing, actionToken: undefined };
      }
      // Rotate the bearer token on a retry. Only its digest is persisted, and
      // no interactive buttons have been published before finalization.
      const actionToken = randomToken();
      const now = dayjs().valueOf();
      await ctx.db.patch(existing._id, {
        actionTokenHash: await hashToken(actionToken),
        actionTokenRevokedAt: undefined,
        actionTokenExpiresAt: undefined,
        ...(existing.phase === "failed"
          ? {
              phase: existing.providerMessageId
                ? ("active" as const)
                : ("starting" as const),
            }
          : {}),
        error: undefined,
        providerErrorCode: undefined,
        retryable: undefined,
        updatedAt: now,
      });
      return {
        presentation: await ctx.db.get(existing._id),
        actionToken,
      };
    }
    const actionToken = randomToken();
    const now = dayjs().valueOf();
    const id = await ctx.db.insert("slackMessagePresentations", {
      ...args,
      phase: "starting",
      revision: 0,
      renderVersion: 1,
      actionTokenHash: await hashToken(actionToken),
      createdAt: now,
      updatedAt: now,
    });
    const presentation = await ctx.db.get(id);
    if (!presentation) throw new Error("Could not create Slack presentation");
    return { presentation, actionToken };
  },
});

export const get = internalQuery({
  args: { threadMessageId: v.id("threadMessages") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("slackMessagePresentations")
      .withIndex("message", (q) =>
        q.eq("threadMessageId", args.threadMessageId),
      )
      .first(),
});

export const getInteractionContext = internalQuery({
  args: { id: v.id("slackInteractionEvents") },
  handler: async (ctx, args) => {
    const interaction = await ctx.db.get(args.id);
    if (!interaction) return null;
    const [presentation, actor] = await Promise.all([
      ctx.db.get(interaction.presentationId),
      ctx.db.get(interaction.actorId),
    ]);
    return presentation && actor ? { interaction, presentation, actor } : null;
  },
});

export const markActive = internalMutation({
  args: {
    id: v.id("slackMessagePresentations"),
    providerMessageId: v.optional(v.string()),
    mode: v.optional(v.union(v.literal("message"), v.literal("stream"))),
    lastPayloadHash: v.optional(v.string()),
    processingReaction: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.phase === "final") return row;
    await ctx.db.patch(row._id, {
      ...(args.providerMessageId
        ? { providerMessageId: args.providerMessageId }
        : {}),
      mode: args.mode ?? row.mode,
      phase: "active",
      revision: row.revision + 1,
      lastPayloadHash: args.lastPayloadHash,
      processingReaction: args.processingReaction ?? row.processingReaction,
      error: undefined,
      providerErrorCode: undefined,
      retryable: undefined,
      updatedAt: dayjs().valueOf(),
    });
    return await ctx.db.get(row._id);
  },
});

export const setProcessingReaction = internalMutation({
  args: {
    id: v.id("slackMessagePresentations"),
    processingReaction: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.phase === "final") return row;
    await ctx.db.patch(row._id, {
      processingReaction: args.processingReaction,
      updatedAt: dayjs().valueOf(),
    });
    return await ctx.db.get(row._id);
  },
});

export const markFinal = internalMutation({
  args: {
    id: v.id("slackMessagePresentations"),
    providerMessageId: v.string(),
    lastPayloadHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    await ctx.db.patch(row._id, {
      providerMessageId: args.providerMessageId,
      phase: "final",
      revision: row.revision + 1,
      actionTokenRevokedAt: actionsRevoked(row)
        ? (row.actionTokenRevokedAt ?? row.actionTokenExpiresAt)
        : undefined,
      actionTokenExpiresAt: undefined,
      lastPayloadHash: args.lastPayloadHash,
      error: undefined,
      providerErrorCode: undefined,
      retryable: undefined,
      updatedAt: dayjs().valueOf(),
    });
    await ctx.db.patch(row.threadMessageId, {
      slackMessageTs: args.providerMessageId,
      slackTeamId: row.teamId,
      slackDeliveryStatus: "sent",
      slackDeliveryError: undefined,
    });
    return await ctx.db.get(row._id);
  },
});

export const markFailed = internalMutation({
  args: {
    id: v.id("slackMessagePresentations"),
    error: v.string(),
    providerErrorCode: v.optional(v.string()),
    retryable: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return;
    await ctx.db.patch(row._id, {
      phase: "failed",
      error: args.error,
      providerErrorCode: args.providerErrorCode,
      retryable: args.retryable,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const markPlaintextFallback = internalMutation({
  args: {
    id: v.id("slackMessagePresentations"),
    providerMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.phase === "final") return row;
    const now = dayjs().valueOf();
    await ctx.db.patch(row._id, {
      providerMessageId: args.providerMessageId ?? row.providerMessageId,
      phase: "final",
      revision: row.revision + 1,
      actionTokenRevokedAt: now,
      error: undefined,
      providerErrorCode: undefined,
      retryable: undefined,
      updatedAt: now,
    });
    await ctx.db.patch(row.threadMessageId, {
      slackMessageTs: args.providerMessageId ?? row.providerMessageId,
      slackTeamId: row.teamId,
      slackDeliveryStatus: "sent",
      slackDeliveryError: undefined,
    });
    return await ctx.db.get(row._id);
  },
});

export const claimInteraction = internalMutation({
  args: {
    interactionKey: v.string(),
    actionToken: v.string(),
    teamId: v.string(),
    actorTeamId: v.string(),
    slackUserId: v.string(),
    channelId: v.string(),
    messageTs: v.optional(v.string()),
    actionId: v.string(),
    value: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("slackInteractionEvents")
      .withIndex("interaction", (q) =>
        q.eq("interactionKey", args.interactionKey),
      )
      .first();
    if (existing) return { claimed: false, interaction: existing };
    const actionTokenHash = await hashToken(args.actionToken);
    const presentation = await ctx.db
      .query("slackMessagePresentations")
      .withIndex("action", (q) => q.eq("actionTokenHash", actionTokenHash))
      .first();
    if (
      !presentation ||
      presentation.phase !== "final" ||
      actionsRevoked(presentation) ||
      presentation.teamId !== args.teamId ||
      presentation.channelId !== args.channelId ||
      !args.messageTs ||
      presentation.providerMessageId !== args.messageTs
    ) {
      throw new Error("Slack action is invalid or no longer available");
    }
    const actor = await interactionActor(
      ctx,
      presentation,
      args.actorTeamId,
      args.slackUserId,
    );
    const now = dayjs().valueOf();
    const id = await ctx.db.insert("slackInteractionEvents", {
      interactionKey: args.interactionKey,
      presentationId: presentation._id,
      connectionId: presentation.connectionId,
      actorId: actor._id,
      actionId: args.actionId,
      value: args.value,
      status: "processing",
      createdAt: now,
      updatedAt: now,
    });
    const interaction = await ctx.db.get(id);
    if (!interaction) throw new Error("Could not record Slack interaction");
    return { claimed: true, interaction, presentation, actor };
  },
});

export const completeInteraction = internalMutation({
  args: {
    id: v.id("slackInteractionEvents"),
    status: v.union(
      v.literal("completed"),
      v.literal("ignored"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      error: args.error,
      updatedAt: dayjs().valueOf(),
    });
  },
});

