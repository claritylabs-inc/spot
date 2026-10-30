import dayjs from "dayjs";
import type { FunctionReference } from "convex/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  isOperatorNotificationTargetCompatible,
  type OperatorNotificationInput,
  type OperatorNotificationTarget,
} from "./operatorNotificationTypes";
import { getClientPortalUrl } from "./domains";
import { isSlackMockMode } from "./slackConfig";
import { teamTargetProblem } from "./teamEmailStore";
import { readPolicyPipelineState } from "../policies";
import { isNonInsuranceDocument } from "./policyDocumentGate";

type ReadCtx = QueryCtx | MutationCtx;
export type OperatorNotificationEventId = Id<"operatorNotificationEvents">;
export type OperatorNotificationDestination = {
  teamId: string;
  channelId: string;
  routeRevision: number;
};
export type OperatorNotificationHost = {
  available: boolean;
  teamId?: string;
  unavailableReason?: string;
};

export const deliverOperatorNotificationRef: FunctionReference<
  "action", "internal", { eventId: OperatorNotificationEventId }, null
> = internal.actions.operatorNotifications.deliver;

export async function operatorNotificationHost(ctx: ReadCtx): Promise<OperatorNotificationHost> {
  const teamId = process.env.SLACK_CLARITY_TEAM_ID?.trim();
  if (process.env.SLACK_ENABLED !== "true")
    return { available: false, teamId, unavailableReason: "Slack is turned off for this environment." };
  if (!teamId) return { available: false, unavailableReason: "Connect the internal Slack workspace to enable alerts." };
  if (isSlackMockMode()) return { available: true, teamId };
  const installation = await ctx.db.query("slackInstallations")
    .withIndex("team_status", q => q.eq("teamId", teamId).eq("status", "active"))
    .first();
  return installation?.kind === "host" && installation.encryptedBotToken
    ? { available: true, teamId }
    : { available: false, teamId, unavailableReason: "The internal Slack connection needs attention." };
}

export async function operatorNotificationRoute(ctx: ReadCtx, category: OperatorNotificationInput["category"]) {
  return ctx.db.query("operatorNotificationRoutes")
    .withIndex("by_category", q => q.eq("category", category)).unique();
}

async function liveClient(ctx: ReadCtx, orgId: Id<"organizations">) {
  const org = await ctx.db.get(orgId);
  return org?.type === "client" && org.deletedAt === undefined;
}

/** Resolves identifiers against current records; never reads prose into copy. */
export async function resolveOperatorNotificationTarget(
  ctx: ReadCtx,
  target: OperatorNotificationTarget,
): Promise<string | null> {
  const base = getClientPortalUrl();
  switch (target.kind) {
    case "inbox": {
      const thread = await ctx.db.get(target.threadId);
      if (!thread || thread.deletedAt !== undefined || thread.archivedAt !== undefined ||
        await teamTargetProblem(ctx, thread)) return null;
      const latest = await ctx.db.query("teamEmailMessages")
        .withIndex("by_threadId_and_receivedAt", q => q.eq("threadId", thread._id))
        .order("desc").first();
      return latest?.direction === "inbound" ? `${base}/operator/inbox/${thread._id}` : null;
    }
    case "approval": {
      const confirmation = await ctx.db.get(target.confirmationId);
      const now = dayjs().valueOf();
      if (!confirmation || confirmation.status !== "pending" || confirmation.approvalMode === "automatic" ||
        confirmation.invalidatedAt !== undefined ||
        (confirmation.expiresAt !== undefined && confirmation.expiresAt <= now)) return null;
      const [thread, run, user, profiles] = await Promise.all([
        ctx.db.get(confirmation.threadId), ctx.db.get(confirmation.payload.runId),
        ctx.db.get(confirmation.operatorUserId),
        ctx.db.query("operatorProfiles").withIndex("user", q => q.eq("userId", confirmation.operatorUserId)).take(2),
      ]);
      if (!thread || !run || run.threadId !== thread._id || run.operatorUserId !== confirmation.operatorUserId ||
        run.status !== "waiting_confirmation" || run.cancellationRequestedAt !== undefined ||
        run.checkpoint?.pendingConfirmationId !== confirmation._id ||
        user?.accountKind !== "operator" || user.isAnonymous || user.serviceAccountKind ||
        profiles.length !== 1 || profiles[0].status !== "active") return null;
      return `${base}/operator/threads/${thread._id}`;
    }
    case "intake": {
      const request = await ctx.db.get(target.requestId);
      if (!request || request.deletedAt !== undefined || !request.intakeSubmittedAt ||
        !request.clientOrgId || !await liveClient(ctx, request.clientOrgId)) return null;
      return request.intakeAnswers?.intakeGoal === "savings"
        ? `${base}/operator/clients/${request.clientOrgId}/policies`
        : `${base}/operator/clients/${request.clientOrgId}/procurement/${request._id}`;
    }
    case "operator_run": {
      const run = await ctx.db.get(target.runId);
      if (!run || run.status !== "failed" || !await ctx.db.get(run.threadId)) return null;
      return `${base}/operator/threads/${run.threadId}`;
    }
    case "policy": {
      const policy = await ctx.db.get(target.policyId);
      if (!policy || !policy.orgId || policy.deletedAt !== undefined || policy.dismissed || !await liveClient(ctx, policy.orgId)) return null;
      const state = await readPolicyPipelineState(ctx, policy._id);
      if (state?.pipelineStatus !== "error" || state.pipelineError === "Cancelled by user" ||
        isNonInsuranceDocument(state.pipelineError)) return null;
      return `${base}/operator/clients/${policy.orgId}/policies/${policy._id}`;
    }
    case "client_monitor": {
      const event = await ctx.db.get(target.eventId);
      if (!event || event.acknowledgedAt !== undefined || !await liveClient(ctx, event.orgId)) return null;
      return `${base}/operator/clients/${event.orgId}`;
    }
    case "provider_discovery": {
      const discovery = await ctx.db.get(target.discoveryId);
      const request = discovery ? await ctx.db.get(discovery.requestId) : null;
      if (discovery?.status !== "completed" || !request || request.deletedAt !== undefined ||
        !request.clientOrgId || !await liveClient(ctx, request.clientOrgId)) return null;
      return `${base}/operator/clients/${request.clientOrgId}/procurement/${request._id}`;
    }
    case "proposal": {
      const proposal = await ctx.db.get(target.proposalId);
      if (!proposal || proposal.status !== "draft") return null;
      const [request, job] = await Promise.all([
        ctx.db.get(proposal.requestId),
        ctx.db.query("procurementProposalExtractionJobs")
          .withIndex("proposal", q => q.eq("proposalId", proposal._id)).order("desc").first(),
      ]);
      if (!request || request.deletedAt !== undefined || request.clientOrgId !== proposal.clientOrgId ||
        !await liveClient(ctx, proposal.clientOrgId) || job?.status !== "failed" || job.requestId !== request._id ||
        job.clientOrgId !== proposal.clientOrgId ||
        job.cancelledAt !== undefined || job.extractionFingerprint !== proposal.extractionFingerprint) return null;
      return `${base}/operator/clients/${proposal.clientOrgId}/procurement/${request._id}?view=proposals&proposal=${proposal._id}`;
    }
  }
}

/** Runs in the producer transaction, including the durable scheduler write. */
export async function emitOperatorNotification(
  ctx: MutationCtx,
  input: OperatorNotificationInput,
): Promise<OperatorNotificationEventId> {
  const existing = await ctx.db.query("operatorNotificationEvents")
    .withIndex("by_eventKey", q => q.eq("eventKey", input.eventKey)).unique();
  if (existing) return existing._id;
  const route = await operatorNotificationRoute(ctx, input.category);
  const validTarget = isOperatorNotificationTargetCompatible(input) &&
    await resolveOperatorNotificationTarget(ctx, input.target);
  const hostTeamId = process.env.SLACK_CLARITY_TEAM_ID?.trim();
  const enabled = route?.enabled && route.teamId === hostTeamId && route.channelId;
  const now = dayjs().valueOf();
  const row: Omit<Doc<"operatorNotificationEvents">, "_id" | "_creationTime"> = {
    ...input, status: !validTarget ? "cancelled" : enabled ? "pending" : "suppressed",
    attempts: 0, createdAt: now, updatedAt: now,
    ...(!validTarget ? { errorCode: "source_unavailable" } : enabled ? {
      teamId: route.teamId, channelId: route.channelId, routeRevision: route.revision, nextAttemptAt: now,
    } : { errorCode: "route_disabled" }),
  };
  const eventId = await ctx.db.insert("operatorNotificationEvents", row);
  if (row.status === "pending")
    await ctx.scheduler.runAfter(0, deliverOperatorNotificationRef, { eventId });
  return eventId;
}
