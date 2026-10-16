"use node";

import dayjs from "dayjs";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  getImessageWorkerUrl,
  getSpectrumCredentials,
  isImessageWebhookTransportEnabled,
} from "../lib/imessageConfig";

type ResolvedParticipant = {
  address: string;
  displayName?: string;
  userId?: Id<"users">;
  userName?: string;
  userEmail?: string;
  orgId?: Id<"organizations">;
  role: "linked" | "anonymous";
};

type WorkerGroupResponse = {
  ok?: boolean;
  chatGuid?: string;
  isGroup?: boolean;
  participants?: Array<{ address: string }>;
  error?: string;
};

export const createOutboundImessageGroupInternal = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    recipients: v.array(v.string()),
    openingMessage: v.string(),
    title: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    const resolved = await ctx.runQuery(internal.imessageOutboundGroups.resolveRecipients, {
      orgId: args.orgId,
      userId: args.userId,
      recipients: args.recipients,
    }) as {
      ok: boolean;
      reason?: string;
      participants: ResolvedParticipant[];
      unresolved: string[];
      ambiguous: Array<{ input: string; matches: string[] }>;
      scopeKind: "single_org" | "multi_org";
      primaryOrgId: Id<"organizations">;
      title?: string;
    };

    if (!resolved.ok) {
      return {
        status: "needs_clarification" as const,
        reason: resolved.reason,
        unresolved: resolved.unresolved,
        ambiguous: resolved.ambiguous,
        resolvedParticipants: resolved.participants.map((participant) => ({
          name: participant.userName ?? participant.displayName,
          address: participant.address,
          role: participant.role,
        })),
      };
    }

    const webhookTransport = isImessageWebhookTransportEnabled("customer");
    const workerUrl = getImessageWorkerUrl();
    const secret = process.env.IMESSAGE_WORKER_SECRET ?? "";
    if (
      webhookTransport
        ? !getSpectrumCredentials("customer")
        : !workerUrl || !secret
    ) {
      return {
        status: "unavailable" as const,
        reason: "iMessage is not configured for outbound group creation.",
      };
    }

    const groupRequest = {
      participants: resolved.participants.map((participant) => participant.address),
      message: args.openingMessage,
      title: args.title ?? resolved.title,
      clientMessageId: `spot-group-${args.orgId}-${dayjs().valueOf()}`,
    };
    let body: WorkerGroupResponse;
    if (webhookTransport) {
      const { sendImessageViaSpectrum } = await import("../lib/imessageSpectrum");
      body = await sendImessageViaSpectrum(ctx, "customer", groupRequest);
    } else {
      const response = await fetch(`${workerUrl!.replace(/\/$/, "")}/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify(groupRequest),
      });
      body = (await response.json().catch(() => ({}))) as WorkerGroupResponse;
      if (!response.ok) {
        body = {
          ...body,
          ok: false,
          error: body.error ?? `iMessage worker returned ${response.status}`,
        };
      }
    }
    if (!body.ok || !body.chatGuid) {
      return {
        status: "failed" as const,
        reason: body.error ?? "iMessage group creation failed",
      };
    }

    const participantAddresses = new Set(
      (body.participants ?? []).map((participant) => participant.address),
    );
    const participants = resolved.participants.filter(
      (participant) => participantAddresses.size === 0 || participantAddresses.has(participant.address),
    );

    await ctx.runMutation(internal.imessageChats.syncChat, {
      chatGuid: body.chatGuid,
      isGroup: true,
      primaryOrgId: resolved.primaryOrgId,
      title: args.title ?? resolved.title,
      participants: participants.map((participant) => ({
        address: participant.address,
        displayName: participant.displayName ?? participant.userName,
        userId: participant.userId,
        orgId: participant.orgId,
        role: participant.role,
      })),
    });

    const threadId = await ctx.runMutation(internal.threads.findOrCreateByImessageChat, {
      orgId: args.orgId,
      userId: args.userId,
      chatGuid: body.chatGuid,
      isGroup: true,
      scope: resolved.scopeKind,
      title: args.title ?? resolved.title,
      fallbackPhone: participants.find((participant) => participant.userId === args.userId)?.address,
      userName: participants.find((participant) => participant.userId === args.userId)?.userName,
    }) as Id<"threads">;

    await ctx.runMutation(internal.threads.insertImessageMessage, {
      threadId,
      orgId: args.orgId,
      role: "agent",
      content: args.openingMessage,
      responseMessageId: `outbound-group:${body.chatGuid}:${dayjs().valueOf()}`,
    });

    return {
      status: "created" as const,
      chatGuid: body.chatGuid,
      threadId,
      title: args.title ?? resolved.title,
      participants: participants.map((participant) => ({
        name: participant.userName ?? participant.displayName,
        address: participant.address,
        role: participant.role,
      })),
    };
  },
});
