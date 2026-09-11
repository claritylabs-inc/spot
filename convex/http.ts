import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import dayjs from "dayjs";
import { httpAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { auth } from "./auth";
import {
  getImessageWorkerUrl,
  getOperatorImessageContactPhone,
  isImessageInboundEnabled,
  isOperatorImessageInboundEnabled,
  isOperatorImessageTerminalEnabled,
} from "./lib/imessageConfig";
import { getAuthSiteUrl, getClientPortalUrl } from "./lib/domains";
import { spotIconResponse } from "./lib/brandIcon";
import { negotiateMcpProtocolVersion } from "./lib/mcpProtocol";
import { getEmailDeliveryMode } from "./lib/resend";
import {
  MAX_AGENT_ATTACHMENT_FILES,
  MAX_OPERATOR_IMESSAGE_ACTION_BASE64_CHARS,
} from "./lib/agentAttachmentLimits";
import { buildEmailDraftTextSummary } from "./lib/emailDraftSummary";
import { ORG_WIKI_SECTION_KEYS, isOrgWikiSectionKey } from "./lib/orgWiki";
import { canAccessThread } from "./lib/threadAccess";
import {
  parseSlackEventPayload,
  parseSlackLifecyclePayload,
} from "./lib/slackPayload";
import { verifySlackRequest } from "./lib/slackSecurity";
import { quoBrokerWebhook } from "./quoBrokerWebhook";
import {
  operatorSlackConfirmationDecision,
  parseSlackInteraction,
  slackActionToken,
} from "./lib/slackInteractions";
import { getSlackMode } from "./lib/slackConfig";
import { getOperatorSlackConfig } from "./lib/operatorSlackConfig";
import { missingSlackHostScopes } from "./lib/slackOAuthPolicy";
import {
  routerAssetSigningConfiguration,
  signRouterAsset,
  verifyRouterAssetSignature,
} from "./lib/routerAssetSignature";
import { ROUTER_ASSET_MAX_BYTES, ROUTER_ASSET_TTL_MS } from "./routerAssets";
import {
  type McpPolicySummarySource,
  policyMatchesMcpFilters,
  policyMatchesSearch,
  toCertificateHolderDto,
  toCertificateDto,
  toCertificateVersionDto,
  toCertificateWorkflowJobDto,
  toMcpConnectedVendorPolicyDto,
  toMcpMyPolicyDto,
  toMcpPolicySearchResultDto,
  toMcpPolicySummaryDto,
  toMcpThreadMessageDto,
  toMcpThreadSummaryDto,
  toNotificationDto,
  toOrgDto,
  toPolicyDto,
  toPolicyFileDto,
  toPolicyStatsDto,
  toPolicyVersionDto,
} from "./lib/apiDto";
import { OPERATOR_AGENT_TOOL_REGISTRY } from "./lib/operatorAgentToolRegistry";
import { decodeOperatorMcpAttachments } from "./lib/operatorMcpAttachments";
import { buildOperatorMcpToolCatalog } from "./lib/operatorMcpToolCatalog";
const http = httpRouter();
const internalApi = internal as any;
const JSON_HEADERS = { "Content-Type": "application/json" };

function routerAssetMediaType(value: string | null): string | null {
  const mediaType = value?.trim().toLowerCase().split(";", 1)[0] ?? "";
  return mediaType === "application/pdf" ||
    mediaType.startsWith("image/") ||
    mediaType.startsWith("audio/")
    ? mediaType
    : null;
}

async function readRouterAssetBody(
  request: Request,
  declaredBytes: number,
): Promise<Uint8Array | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (
      receivedBytes > declaredBytes ||
      receivedBytes > ROUTER_ASSET_MAX_BYTES
    ) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  if (receivedBytes !== declaredBytes) return null;
  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

const routerAssetUpload = httpAction(async (ctx, request) => {
  const expectedSecret = process.env.EXTRACTION_WORKER_SECRET?.trim();
  const authorization = request.headers.get("authorization");
  const jobKind = request.headers.get("x-spot-router-asset-job-kind");
  const jobId = request.headers.get("x-spot-router-asset-job-id");
  const leaseId = request.headers.get("x-spot-router-asset-lease-id");
  const orgId = request.headers.get("x-spot-router-asset-org-id");
  const filename = request.headers
    .get("x-spot-router-asset-filename")
    ?.trim()
    .slice(0, 255);
  const mediaType = routerAssetMediaType(request.headers.get("content-type"));
  const declaredBytes = Number(request.headers.get("content-length"));
  if (!expectedSecret || authorization !== `Bearer ${expectedSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (
    !jobId ||
    !leaseId ||
    !orgId ||
    !mediaType ||
    (jobKind !== "policy" && jobKind !== "preview" && jobKind !== "proposal")
  ) {
    return new Response("Invalid router asset metadata", { status: 400 });
  }
  if (
    !Number.isSafeInteger(declaredBytes) ||
    declaredBytes <= 0 ||
    declaredBytes > ROUTER_ASSET_MAX_BYTES
  ) {
    return new Response("Router asset exceeds the 12 MiB limit", {
      status: 413,
    });
  }
  let signing: { secret: string; siteUrl: string };
  try {
    signing = routerAssetSigningConfiguration();
  } catch {
    return new Response("Router asset signing is unavailable", { status: 503 });
  }
  const lease = await ctx
    .runQuery(internal.routerAssets.validateWorkerLease, {
      jobKind,
      jobId,
      leaseId,
      orgId: orgId as Id<"organizations">,
    })
    .catch(() => ({ leaseExpiresAt: null }));
  if (!lease.leaseExpiresAt)
    return new Response("Stale or mismatched extraction worker lease", {
      status: 409,
    });
  const bytes = await readRouterAssetBody(request, declaredBytes);
  if (!bytes) {
    return new Response("Router asset size does not match Content-Length", {
      status: 400,
    });
  }
  const ownedBytes = new Uint8Array(bytes.byteLength);
  ownedBytes.set(bytes);
  const ownedBuffer = ownedBytes.buffer as ArrayBuffer;
  const storageId = await ctx.storage.store(
    new Blob([ownedBuffer], { type: mediaType }),
  );
  let registeredAssetId: Id<"routerAssets"> | undefined;
  try {
    const sha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", ownedBuffer)),
    )
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const expiresAt = Math.min(
      dayjs().valueOf() + ROUTER_ASSET_TTL_MS,
      lease.leaseExpiresAt,
    );
    const assetId = await ctx.runMutation(
      internal.routerAssets.registerWorkerAsset,
      {
        jobKind,
        jobId,
        leaseId,
        orgId: orgId as Id<"organizations">,
        storageId,
        mediaType,
        ...(filename ? { filename } : {}),
        sizeBytes: bytes.byteLength,
        sha256,
        expiresAt,
      },
    );
    registeredAssetId = assetId;
    const signature = await signRouterAsset(
      String(assetId),
      expiresAt,
      signing.secret,
    );
    const query = new URLSearchParams({
      assetId: String(assetId),
      expiresAt: String(expiresAt),
      signature,
    });
    return new Response(
      JSON.stringify({
        assetId,
        reference: {
          url: `${signing.siteUrl}/router-assets?${query.toString()}`,
          mediaType,
          ...(filename ? { filename } : {}),
          sizeBytes: bytes.byteLength,
          sha256,
        },
        cleanup: { expiresAt, signature },
      }),
      { status: 201, headers: JSON_HEADERS },
    );
  } catch (error) {
    try {
      await ctx.storage.delete(storageId);
      if (registeredAssetId) {
        await ctx.runMutation(internal.routerAssets.completeCleanup, {
          assetId: registeredAssetId,
          storageId,
        });
      }
    } catch {
      if (registeredAssetId) {
        await ctx
          .runMutation(internal.routerAssets.recordCleanupFailure, {
            assetId: registeredAssetId,
            storageId,
          })
          .catch(() => {});
      } else {
        await ctx
          .runMutation(internal.routerAssets.scheduleUnregisteredCleanup, {
            storageId,
            attempt: 1,
          })
          .catch(() => {});
      }
    }
    console.error(
      "Router asset upload registration failed",
      error instanceof Error ? error.name : "unknown",
    );
    return new Response("Router asset registration failed", { status: 500 });
  }
});

const routerAssetDownload = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const assetId = url.searchParams.get("assetId");
  const expiresAt = Number(url.searchParams.get("expiresAt"));
  const signature = url.searchParams.get("signature");
  const secret = process.env.CL_ROUTER_SECRET?.trim();
  if (
    !assetId ||
    !signature ||
    !secret ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= dayjs().valueOf() ||
    !(await verifyRouterAssetSignature(assetId, expiresAt, signature, secret))
  ) {
    return new Response("Not found", { status: 404 });
  }
  const asset = await ctx.runQuery(internal.routerAssets.resolveForDownload, {
    assetId: assetId as Id<"routerAssets">,
    expiresAt,
  });
  if (!asset) return new Response("Not found", { status: 404 });
  const blob = await ctx.storage.get(asset.storageId);
  if (!blob || blob.size !== asset.sizeBytes) {
    return new Response("Not found", { status: 404 });
  }
  const headers = {
    "Content-Type": asset.mediaType,
    "Content-Length": String(asset.sizeBytes),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  return new Response(blob, { status: 200, headers });
});

http.route({
  path: "/router-assets",
  method: "GET",
  handler: routerAssetDownload,
});
http.route({
  path: "/router-assets/upload",
  method: "POST",
  handler: routerAssetUpload,
});

http.route({
  path: "/quo-brokers/webhook",
  method: "POST",
  handler: quoBrokerWebhook,
});

// Public, revocable packet-file delivery. The token is re-resolved on every
// request so a revoked packet immediately invalidates previously copied URLs.
http.route({
  path: "/packet-file",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const token = url.searchParams.get("token") ?? "";
    const item = url.searchParams.get("item") ?? "";
    if (!token || !item) return new Response(null, { status: 404 });
    const resolved = await ctx.runQuery(
      internalApi.procurementPacket.getFileByTokenInternal,
      { token, item },
    );
    if (!resolved) return new Response(null, { status: 404 });
    const blob = await ctx.storage.get(resolved.fileId);
    if (!blob) return new Response(null, { status: 404 });
    return new Response(blob, {
      status: 200,
      headers: {
        "Content-Type": resolved.contentType,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
        "Content-Disposition": `attachment; filename="${resolved.name.replace(/[\\"\r\n]/g, "_")}"`,
      },
    });
  }),
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

auth.addHttpRoutes(http);

http.route({
  path: "/slack/oauth/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    if (!code || !state || error) {
      const redirect = new URL(
        "/settings?section=agent&tab=channels",
        process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://app.spot.insure",
      );
      redirect.searchParams.set("slack", "error");
      redirect.searchParams.set("reason", error || "missing_oauth_parameters");
      return Response.redirect(redirect.toString(), 302);
    }
    const redirect = await ctx.runAction(
      internalApi.actions.slackOAuth.complete,
      { code, state },
    );
    return Response.redirect(redirect, 302);
  }),
});

http.route({
  path: "/slack/events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.SLACK_SIGNING_SECRET?.trim();
    if (!secret)
      return jsonResponse({ error: "Slack webhook is not configured" }, 503);
    const rawBody = await request.text();
    const verification = await verifySlackRequest({
      secret,
      timestamp: request.headers.get("X-Slack-Request-Timestamp"),
      signature: request.headers.get("X-Slack-Signature"),
      rawBody,
    });
    if (!verification.ok) {
      return jsonResponse({ error: verification.reason }, 401);
    }

    let rawPayload: unknown;
    try {
      rawPayload = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }
    const envelope = rawPayload as Record<string, unknown>;
    if (envelope.type === "url_verification") {
      const challenge =
        typeof envelope.challenge === "string" ? envelope.challenge : undefined;
      return challenge
        ? jsonResponse({ challenge })
        : jsonResponse({ error: "Missing Slack challenge" }, 400);
    }
    if (process.env.SLACK_ENABLED !== "true") {
      return jsonResponse({ error: "Slack is not enabled" }, 404);
    }
    const receivedAt = dayjs().valueOf();
    const lifecyclePayload = parseSlackLifecyclePayload(
      rawPayload,
      await sha256Hex(rawBody),
      receivedAt,
    );
    if (lifecyclePayload) {
      const claim = await ctx.runMutation(internalApi.slackLifecycle.claim, {
        source: "slack",
        ...lifecyclePayload,
      });
      return jsonResponse({ ok: true, duplicate: claim.duplicate });
    }

    const payload = parseSlackEventPayload(rawPayload);
    if (!payload || payload.isBotEcho) {
      return jsonResponse({ ok: true, ignored: true });
    }
    const timestamp =
      typeof envelope.event_time === "number"
        ? dayjs.unix(envelope.event_time).valueOf()
        : receivedAt;
    await ctx.runMutation(internalApi.slack.claimInbound, {
      eventKey: payload.eventKey,
      providerEventId: payload.providerEventId,
      teamId: payload.teamId,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      replyThreadTs: payload.replyThreadTs,
      messageTs: payload.messageTs,
      senderTeamId: payload.senderTeamId,
      senderUserId: payload.senderUserId,
      content: payload.content,
      attachments: payload.attachments,
      eventType: payload.eventType,
      isDirectMessage: payload.isDirectMessage,
      isPrivateChannel: payload.isPrivateChannel,
      receivedAt: Number.isFinite(timestamp) ? timestamp : receivedAt,
    });
    return jsonResponse({ ok: true });
  }),
});

http.route({
  path: "/slack/interactivity",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.SLACK_SIGNING_SECRET?.trim();
    if (!secret)
      return jsonResponse({ error: "Slack webhook is not configured" }, 503);
    const rawBody = await request.text();
    const verification = await verifySlackRequest({
      secret,
      timestamp: request.headers.get("X-Slack-Request-Timestamp"),
      signature: request.headers.get("X-Slack-Signature"),
      rawBody,
    });
    if (!verification.ok)
      return jsonResponse({ error: verification.reason }, 401);
    if (process.env.SLACK_ENABLED !== "true") {
      return jsonResponse({ error: "Slack is not enabled" }, 404);
    }
    const payload = parseSlackInteraction(rawBody);
    if (!payload)
      return jsonResponse({ error: "Unsupported Slack interaction" }, 400);
    if (payload.type === "view_submission") {
      if (payload.callbackId !== "spot_negative_feedback") {
        return jsonResponse({ response_action: "clear" });
      }
      try {
        await ctx.runMutation(
          internalApi.slackPresentation.submitFeedbackComment,
          {
            interactionId: payload.privateMetadata,
            teamId: payload.teamId,
            actorTeamId: payload.actorTeamId,
            slackUserId: payload.userId,
            comment: payload.comment,
          },
        );
      } catch (error) {
        console.warn("[slack] Rejected feedback submission", error);
      }
      return jsonResponse({ response_action: "clear" });
    }
    const operatorDecision = operatorSlackConfirmationDecision(
      payload.actionId,
    );
    if (operatorDecision) {
      if (!payload.messageTs) {
        return jsonResponse({ error: "Invalid operator confirmation" }, 400);
      }
      try {
        const authorized = await ctx.runQuery(
          internalApi.operatorSlack.authorizeConfirmationInteraction,
          {
            teamId: payload.teamId,
            actorTeamId: payload.actorTeamId,
            slackUserId: payload.userId,
            channelId: payload.channelId,
            confirmationId: payload.value,
          },
        );
        if (authorized) {
          await ctx.scheduler.runAfter(
            0,
            internalApi.actions.handleInboundSlack
              .processOperatorConfirmationInteraction,
            {
              operatorUserId: authorized.operatorUserId,
              threadId: authorized.threadId,
              confirmationId: authorized.confirmationId,
              decision: operatorDecision,
              teamId: payload.teamId,
              channelId: payload.channelId,
              messageTs: payload.messageTs,
              threadTs: payload.threadTs,
              summary: authorized.summary,
              unavailableReason: authorized.unavailableReason,
            },
          );
        }
      } catch (error) {
        console.warn("[slack] Rejected operator confirmation", error);
      }
      return jsonResponse({ ok: true });
    }
    const action = slackActionToken(payload.actionId, payload.value);
    if (!action) return jsonResponse({ error: "Invalid Slack action" }, 400);
    const interactionKey = [
      payload.teamId,
      payload.channelId,
      payload.messageTs ?? "no-message",
      payload.userId,
      payload.actionId,
      payload.actionTs ?? payload.value,
    ].join(":");
    try {
      const claim = await ctx.runMutation(
        internalApi.slackPresentation.claimInteraction,
        {
          interactionKey,
          actionToken: action.token,
          teamId: payload.teamId,
          actorTeamId: payload.actorTeamId,
          slackUserId: payload.userId,
          channelId: payload.channelId,
          messageTs: payload.messageTs,
          actionId: payload.actionId,
          value: action.value,
        },
      );
      if (claim.claimed) {
        let feedbackModalOpened = false;
        if (action.value === "negative" && payload.triggerId) {
          try {
            const workerUrl = process.env.SLACK_WORKER_URL?.trim().replace(
              /\/$/,
              "",
            );
            const workerSecret = process.env.SLACK_WORKER_SECRET?.trim();
            if (workerUrl && workerSecret) {
              const response = await fetch(`${workerUrl}/view/open`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${workerSecret}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  teamId: payload.teamId,
                  triggerId: payload.triggerId,
                  privateMetadata: claim.interaction._id,
                }),
                signal: AbortSignal.timeout(1_500),
              });
              feedbackModalOpened = response.ok;
            }
          } catch (error) {
            console.warn("[slack] Could not open feedback detail modal", error);
          }
        }
        await ctx.scheduler.runAfter(
          0,
          internalApi.actions.slackPresentation.processInteraction,
          {
            interactionId: claim.interaction._id,
            feedbackModalOpened,
          },
        );
      }
      return jsonResponse({ ok: true });
    } catch (error) {
      console.warn("[slack] Rejected interactive action", error);
      return jsonResponse({ ok: true });
    }
  }),
});

http.route({
  path: "/slack-worker/installation",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.SLACK_WORKER_SECRET?.trim();
    if (
      !secret ||
      request.headers.get("Authorization") !== `Bearer ${secret}`
    ) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    let body: { teamId?: unknown };
    try {
      body = (await request.json()) as { teamId?: unknown };
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }
    const teamId = typeof body.teamId === "string" ? body.teamId.trim() : "";
    if (!teamId) return jsonResponse({ error: "teamId is required" }, 400);
    try {
      return jsonResponse(
        await ctx.runAction(
          internalApi.actions.slackCredentials.resolveInstallation,
          { teamId },
        ),
      );
    } catch (error) {
      return jsonResponse(
        { error: error instanceof Error ? error.message : String(error) },
        404,
      );
    }
  }),
});

http.route({
  path: "/agent-health",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const slackEnabled = process.env.SLACK_ENABLED === "true";
    const operatorSlack = getOperatorSlackConfig();
    const operatorImessageEnabled = isOperatorImessageInboundEnabled();
    const operatorImessageTerminalEnabled = isOperatorImessageTerminalEnabled();
    const slackMode = getSlackMode();
    const slackHostInstallation =
      slackEnabled && slackMode === "slack"
        ? await ctx.runQuery(
            internalApi.agentChannels.getActiveSlackHostInstallation,
            {},
          )
        : null;
    const slackLifecycleHealth = slackEnabled
      ? await ctx.runQuery(internalApi.slackLifecycle.getHealthSummary, {})
      : null;
    const missingHostScopes = slackHostInstallation
      ? missingSlackHostScopes(slackHostInstallation.grantedScopes)
      : [];
    let operatorAgentModelConfigured = false;
    try {
      await ctx.runQuery(
        internalApi.modelSettings.resolveOperatorAgentRoute,
        {},
      );
      operatorAgentModelConfigured = true;
    } catch {
      operatorAgentModelConfigured = false;
    }
    const checks = {
      operatorAgentModelConfigured,
      imessageInboundEnabled: isImessageInboundEnabled(),
      imessageWorkerUrlConfigured: Boolean(getImessageWorkerUrl()),
      imessageWorkerSecretConfigured: Boolean(
        process.env.IMESSAGE_WORKER_SECRET,
      ),
      operatorImessageWorkerUrlConfigured:
        !operatorImessageEnabled ||
        Boolean(process.env.OPERATOR_IMESSAGE_WORKER_URL),
      operatorImessageWorkerSecretConfigured:
        !operatorImessageEnabled ||
        Boolean(process.env.OPERATOR_IMESSAGE_WORKER_SECRET),
      operatorImessageContactPhoneConfigured:
        !operatorImessageEnabled ||
        operatorImessageTerminalEnabled ||
        Boolean(getOperatorImessageContactPhone()),
      emailInboundWebhookSecretConfigured: Boolean(
        process.env.RESEND_WEBHOOK_SECRET,
      ),
      emailOutboundConfigured: Boolean(process.env.AUTH_RESEND_KEY),
      emailScanCronSecretConfigured: Boolean(
        process.env.EMAIL_SCAN_CRON_SECRET,
      ),
      connectedEmailEncryptionConfigured: Boolean(
        process.env.EMAIL_CONNECTIONS_ENCRYPTION_KEY,
      ),
      slackWorkerConfigured:
        !slackEnabled ||
        Boolean(
          process.env.SLACK_WORKER_URL && process.env.SLACK_WORKER_SECRET,
        ),
      slackWebhookConfigured:
        !slackEnabled || Boolean(process.env.SLACK_SIGNING_SECRET),
      slackTokenEncryptionConfigured:
        !slackEnabled ||
        slackMode === "mock" ||
        Boolean(process.env.SLACK_TOKEN_ENCRYPTION_KEY),
      slackHostInstallationConfigured:
        !slackEnabled || slackMode === "mock" || Boolean(slackHostInstallation),
      slackHostScopesGranted: missingHostScopes.length === 0,
      slackOAuthConfigured:
        !slackEnabled ||
        slackMode === "mock" ||
        process.env.SPOT_ENV === "local" ||
        Boolean(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET),
      operatorSlackHostTeamConfigured:
        !operatorSlack.enabled || Boolean(operatorSlack.hostTeamId),
      operatorSlackBaseChannelConfigured:
        !operatorSlack.enabled || slackEnabled,
    };
    const ok = Object.values(checks).every(Boolean);
    return new Response(
      JSON.stringify({
        ok,
        service: "spot-convex-agent-health",
        spotEnv: process.env.SPOT_ENV ?? "unknown",
        emailDeliveryMode: getEmailDeliveryMode(),
        clientPortalUrl: getClientPortalUrl(),
        authSiteUrl: getAuthSiteUrl(),
        extractionWorker: {
          mode: process.env.EXTRACTION_WORKER_MODE ?? "internal",
          expectedProtocolVersion:
            process.env.EXTRACTION_WORKER_EXPECTED_PROTOCOL_VERSION ?? null,
          expectedClSdkVersion:
            process.env.EXTRACTION_WORKER_EXPECTED_CL_SDK_VERSION ?? null,
        },
        operatorImessage: {
          inboundEnabled: operatorImessageEnabled,
          contactPhoneConfigured: Boolean(getOperatorImessageContactPhone()),
          workerUrlConfigured: Boolean(
            process.env.OPERATOR_IMESSAGE_WORKER_URL,
          ),
          workerSecretConfigured: Boolean(
            process.env.OPERATOR_IMESSAGE_WORKER_SECRET,
          ),
        },
        operatorSlack: {
          enabled: operatorSlack.enabled,
          hostTeamConfigured: Boolean(operatorSlack.hostTeamId),
          missingHostScopes,
        },
        operatorAgent: {
          modelConfigured: operatorAgentModelConfigured,
        },
        slack: {
          enabled: slackEnabled,
          mode: slackMode,
          workerUrlConfigured: Boolean(process.env.SLACK_WORKER_URL),
          workerSecretConfigured: Boolean(process.env.SLACK_WORKER_SECRET),
          webhookSigningSecretConfigured: Boolean(
            process.env.SLACK_SIGNING_SECRET,
          ),
          tokenEncryptionConfigured: Boolean(
            process.env.SLACK_TOKEN_ENCRYPTION_KEY,
          ),
          oauthConfigured: Boolean(
            process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET,
          ),
          clarityTeamConfigured: Boolean(process.env.SLACK_CLARITY_TEAM_ID),
          hostInstallationConfigured: Boolean(slackHostInstallation),
          lifecycle: slackLifecycleHealth,
        },
        checks,
      }),
      {
        status: ok ? 200 : 503,
        headers: { "Content-Type": "application/json" },
      },
    );
  }),
});

http.route({
  path: "/resend-inbound",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Pass raw body + svix headers for signature verification in the action
    const rawBody = await request.text();
    const svixId = request.headers.get("svix-id") ?? "";
    const svixTimestamp = request.headers.get("svix-timestamp") ?? "";
    const svixSignature = request.headers.get("svix-signature") ?? "";

    await ctx.runAction(internal.actions.handleInboundEmail.processInbound, {
      payload: rawBody,
      svixId,
      svixTimestamp,
      svixSignature,
    });
    return new Response("OK", { status: 200 });
  }),
});

http.route({
  path: "/imessage-inbound",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!isImessageInboundEnabled()) {
      return new Response(
        JSON.stringify({ error: "iMessage inbound is not configured" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Validate shared secret
    const secret = process.env.IMESSAGE_WORKER_SECRET;
    const authHeader = request.headers.get("Authorization") ?? "";
    if (secret && authHeader !== `Bearer ${secret}`) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    let body: {
      fromPhone: string;
      messageText: string;
      chatGuid?: string;
      isGroup?: boolean;
      chatTitle?: string;
      participantsUnavailable?: boolean;
      participants?: Array<{ address: string; displayName?: string }>;
      sourceMessageId?: string;
      receivedAt?: number;
      recoveryFailure?: {
        stage: "raw_message" | "attachment_download";
        error: string;
      };
      attachments?: Array<{ data: string; mimeType: string; name: string }>;
    };
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!body.fromPhone || !body.messageText) {
      return new Response(
        JSON.stringify({ error: "fromPhone and messageText are required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    try {
      const result = await ctx.runAction(
        internal.actions.handleInboundImessage.processInbound,
        {
          fromPhone: body.fromPhone,
          messageText: body.messageText,
          chatGuid: body.chatGuid,
          isGroup: body.isGroup,
          chatTitle: body.chatTitle,
          participantsUnavailable: body.participantsUnavailable,
          participants: body.participants,
          sourceMessageId: body.sourceMessageId,
          receivedAt: body.receivedAt,
          recoveryFailure: body.recoveryFailure,
          attachments: body.attachments,
        },
      );
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("[imessage-inbound] Error:", err);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

http.route({
  path: "/imessage-delivery-events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.IMESSAGE_WORKER_SECRET;
    const authHeader = request.headers.get("Authorization") ?? "";
    if (secret && authHeader !== `Bearer ${secret}`) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    let body: {
      threadMessageId?: string;
      attachmentFailures?: Array<{ filename?: string; error?: string }>;
    };
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }

    const threadMessageId = body.threadMessageId?.trim();
    const failures = (body.attachmentFailures ?? [])
      .map((failure) => ({
        filename: failure.filename?.trim() ?? "",
        error: failure.error?.trim() || undefined,
      }))
      .filter((failure) => failure.filename);

    if (!threadMessageId || failures.length === 0) {
      return jsonResponse(
        { error: "threadMessageId and attachmentFailures are required" },
        400,
      );
    }

    await ctx.runMutation(
      internal.threads.recordImessageAttachmentDeliveryFailure,
      {
        threadMessageId: threadMessageId as Id<"threadMessages">,
        stage: "worker_delivery",
        failures,
      },
    );

    return jsonResponse({ ok: true });
  }),
});

http.route({
  path: "/operator-imessage-inbound",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!isOperatorImessageInboundEnabled()) {
      return jsonResponse(
        { error: "Operator iMessage inbound is not configured" },
        404,
      );
    }
    const secret = process.env.OPERATOR_IMESSAGE_WORKER_SECRET?.trim();
    if (!secret) {
      return jsonResponse(
        { error: "Operator iMessage worker secret is not configured" },
        503,
      );
    }
    if (request.headers.get("Authorization") !== `Bearer ${secret}`) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    let body: {
      fromPhone?: string;
      messageText?: string;
      chatGuid?: string;
      isGroup?: boolean;
      chatTitle?: string;
      participantsUnavailable?: boolean;
      participants?: Array<{ address: string; displayName?: string }>;
      sourceMessageId?: string;
      receivedAt?: number;
      recoveryFailure?: {
        stage: "raw_message" | "attachment_download";
        error: string;
      };
      attachments?: Array<{ data: string; mimeType: string; name: string }>;
    };
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }
    if (
      !body.fromPhone?.trim() ||
      (typeof body.messageText !== "string" && !body.attachments?.length)
    ) {
      return jsonResponse(
        { error: "fromPhone and messageText or attachments are required" },
        400,
      );
    }
    if (body.isGroup === true) {
      return jsonResponse(
        { error: "Operator iMessage supports direct conversations only" },
        400,
      );
    }
    if ((body.attachments?.length ?? 0) > MAX_AGENT_ATTACHMENT_FILES) {
      return jsonResponse(
        {
          error: `Operator iMessage supports at most ${MAX_AGENT_ATTACHMENT_FILES} attachments`,
        },
        413,
      );
    }
    const encodedAttachmentChars = (body.attachments ?? []).reduce(
      (total, attachment) => total + attachment.data.length,
      0,
    );
    if (encodedAttachmentChars > MAX_OPERATOR_IMESSAGE_ACTION_BASE64_CHARS) {
      return jsonResponse(
        {
          error:
            "Operator iMessage attachments exceed the 3.5 million-character encoded transport limit (about 2.5 MB decoded)",
        },
        413,
      );
    }
    const operatorIdentity = await ctx.runQuery(
      (internal as any).operatorImessage.resolveIdentity,
      { fromPhone: body.fromPhone },
    );
    if (!operatorIdentity) {
      return jsonResponse({ error: "Operator sender is not authorized" }, 403);
    }

    try {
      const result = await ctx.runAction(
        (internal as any).actions.handleInboundOperatorImessage.processInbound,
        {
          fromPhone: body.fromPhone,
          messageText: body.messageText ?? "",
          chatGuid: body.chatGuid,
          isGroup: body.isGroup,
          chatTitle: body.chatTitle,
          participantsUnavailable: body.participantsUnavailable,
          participants: body.participants,
          sourceMessageId: body.sourceMessageId,
          receivedAt: body.receivedAt,
          recoveryFailure: body.recoveryFailure,
          attachments: body.attachments,
        },
      );
      return jsonResponse(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not authorized")) {
        return jsonResponse(
          { error: "Operator sender is not authorized" },
          403,
        );
      }
      console.error("[operator-imessage-inbound] Error:", error);
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  }),
});

http.route({
  path: "/operator-imessage-delivery-events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.OPERATOR_IMESSAGE_WORKER_SECRET?.trim();
    if (!secret) {
      return jsonResponse(
        { error: "Operator iMessage worker secret is not configured" },
        503,
      );
    }
    if (request.headers.get("Authorization") !== `Bearer ${secret}`) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    let body: {
      threadMessageId?: string;
      attachmentFailures?: Array<{ filename?: string; error?: string }>;
    };
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }
    const threadMessageId = body.threadMessageId?.trim();
    const failures = (body.attachmentFailures ?? [])
      .map((failure) => ({
        filename: failure.filename?.trim() ?? "",
        error: failure.error?.trim() || undefined,
      }))
      .filter((failure) => failure.filename);
    if (!threadMessageId || failures.length === 0) {
      return jsonResponse(
        { error: "threadMessageId and attachmentFailures are required" },
        400,
      );
    }
    const recorded = await ctx.runMutation(
      (internal as any).operatorAgent
        .recordImessageAttachmentDeliveryFailureInternal,
      {
        operatorMessageId: threadMessageId as Id<"operatorAgentMessages">,
        stage: "worker_delivery",
        failures,
      },
    );
    if (!recorded) {
      return jsonResponse({ error: "Operator message not found" }, 404);
    }
    return jsonResponse({ ok: true });
  }),
});

http.route({
  path: "/cron/connected-email/scan",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const expectedSecret = process.env.EMAIL_SCAN_CRON_SECRET;
    if (!expectedSecret) {
      return new Response(
        JSON.stringify({ error: "EMAIL_SCAN_CRON_SECRET is not configured" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const authHeader = request.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${expectedSecret}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const result = await ctx.runAction(
      internal.actions.connectedEmailScan.scanAllMailboxes,
      {},
    );
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ── OAuth 2.1 Routes ──

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// GET /.well-known/oauth-protected-resource (RFC 9728 — tells MCP clients where to find the auth server)
http.route({
  path: "/.well-known/oauth-protected-resource",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const issuer = url.origin;

    return new Response(
      JSON.stringify({
        resource: `${issuer}/mcp`,
        authorization_servers: [issuer],
        scopes_supported: ["read", "write"],
        resource_documentation: `${getAuthSiteUrl()}/operator`,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }),
});

// GET /.well-known/oauth-authorization-server
http.route({
  path: "/.well-known/oauth-authorization-server",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const issuer = url.origin;
    const siteUrl = getAuthSiteUrl();

    return new Response(
      JSON.stringify({
        issuer,
        authorization_endpoint: `${siteUrl}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        registration_endpoint: `${issuer}/oauth/register`,
        revocation_endpoint: `${issuer}/oauth/revoke`,
        response_types_supported: ["code"],
        authorization_response_iss_parameter_supported: true,
        grant_types_supported: ["authorization_code", "refresh_token"],
        scopes_supported: ["read", "write"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        service_documentation: `${siteUrl}`,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }),
});

// OPTIONS /oauth/register (CORS preflight)
http.route({
  path: "/oauth/register",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }),
});

// POST /oauth/register — Dynamic Client Registration (RFC 7591)
http.route({
  path: "/oauth/register",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { client_name, redirect_uris, token_endpoint_auth_method } = body;

      if (
        !client_name ||
        !redirect_uris ||
        !Array.isArray(redirect_uris) ||
        redirect_uris.length === 0
      ) {
        return new Response(
          JSON.stringify({
            error: "invalid_client_metadata",
            error_description: "client_name and redirect_uris are required",
          }),
          {
            status: 400,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          },
        );
      }

      // Validate redirect URIs (HTTPS or localhost)
      for (const uri of redirect_uris) {
        try {
          const parsed = new URL(uri);
          const isLocalhost =
            parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
          if (parsed.protocol !== "https:" && !isLocalhost) {
            return new Response(
              JSON.stringify({
                error: "invalid_redirect_uri",
                error_description: "Redirect URIs must use HTTPS or localhost",
              }),
              {
                status: 400,
                headers: {
                  ...CORS_HEADERS,
                  "Content-Type": "application/json",
                },
              },
            );
          }
        } catch {
          return new Response(
            JSON.stringify({
              error: "invalid_redirect_uri",
              error_description: `Invalid URI: ${uri}`,
            }),
            {
              status: 400,
              headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            },
          );
        }
      }

      const result = await ctx.runMutation(internal.oauth.registerClient, {
        clientName: client_name,
        redirectUris: redirect_uris,
        tokenEndpointAuthMethod: token_endpoint_auth_method,
      });

      return new Response(JSON.stringify(result), {
        status: 201,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "server_error", error_description: String(e) }),
        {
          status: 500,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        },
      );
    }
  }),
});

// OPTIONS /oauth/token (CORS preflight)
http.route({
  path: "/oauth/token",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }),
});

// POST /oauth/token — Token exchange
http.route({
  path: "/oauth/token",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const contentType = request.headers.get("Content-Type") ?? "";
    let params: URLSearchParams;

    if (contentType.includes("application/x-www-form-urlencoded")) {
      params = new URLSearchParams(await request.text());
    } else if (contentType.includes("application/json")) {
      const body = await request.json();
      params = new URLSearchParams(body);
    } else {
      params = new URLSearchParams(await request.text());
    }

    const grantType = params.get("grant_type");
    const responseHeaders = {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    };

    try {
      if (grantType === "authorization_code") {
        const code = params.get("code");
        const clientId = params.get("client_id");
        const redirectUri = params.get("redirect_uri");
        const codeVerifier = params.get("code_verifier");
        const resource = params.get("resource") ?? undefined;

        if (!code || !clientId || !redirectUri || !codeVerifier) {
          return new Response(
            JSON.stringify({
              error: "invalid_request",
              error_description: "Missing required parameters",
            }),
            { status: 400, headers: responseHeaders },
          );
        }

        const result = await ctx.runMutation(internal.oauth.exchangeAuthCode, {
          codeRaw: code,
          clientId,
          redirectUri,
          codeVerifier,
          resource,
        });

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: responseHeaders,
        });
      } else if (grantType === "refresh_token") {
        const refreshToken = params.get("refresh_token");
        const clientId = params.get("client_id");
        const resource = params.get("resource") ?? undefined;

        if (!refreshToken || !clientId) {
          return new Response(
            JSON.stringify({
              error: "invalid_request",
              error_description: "Missing required parameters",
            }),
            { status: 400, headers: responseHeaders },
          );
        }

        const result = await ctx.runMutation(
          internal.oauth.refreshAccessToken,
          {
            refreshTokenRaw: refreshToken,
            clientId,
            resource,
          },
        );

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: responseHeaders,
        });
      } else {
        return new Response(
          JSON.stringify({ error: "unsupported_grant_type" }),
          { status: 400, headers: responseHeaders },
        );
      }
    } catch (e: unknown) {
      const message =
        e instanceof ConvexError && typeof e.data === "string"
          ? e.data
          : e instanceof Error
            ? e.message
            : String(e);
      if (message === "invalid_grant") {
        return new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
          headers: responseHeaders,
        });
      }
      if (message.startsWith("invalid_target:")) {
        return new Response(
          JSON.stringify({
            error: "invalid_target",
            error_description: message.slice("invalid_target:".length).trim(),
          }),
          { status: 400, headers: responseHeaders },
        );
      }
      return new Response(
        JSON.stringify({ error: "server_error", error_description: message }),
        { status: 500, headers: responseHeaders },
      );
    }
  }),
});

// POST /oauth/revoke — Token revocation
http.route({
  path: "/oauth/revoke",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const params = new URLSearchParams(await request.text());
    const authHeader = request.headers.get("Authorization");
    const rawToken =
      params.get("token") ??
      (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined);
    if (!rawToken) {
      return new Response(JSON.stringify({ error: "invalid_request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(rawToken),
    );
    const tokenHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const revoked = await ctx.runMutation(internal.oauth.revokeTokenInternal, {
      tokenHash,
      clientId: params.get("client_id") ?? undefined,
    });
    if (!revoked) {
      return new Response(JSON.stringify({ error: "invalid_client" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(null, { status: 200 });
  }),
});

// ── MCP API Routes ──

type OrganizationMcpIdentity = {
  principalKind: "organization";
  userId: string;
  orgId: string;
  scopes?: ("read" | "write")[];
  tokenId?: string;
};

type OperatorMcpIdentity = {
  principalKind: "operator";
  userId: string;
  orgId?: undefined;
  operatorRole: "operator" | "owner";
  scopes?: ("read" | "write")[];
  tokenId?: string;
};

type McpIdentity = OrganizationMcpIdentity | OperatorMcpIdentity;

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function mcpResourceMetadataAuthenticateHeader(request: Request): string {
  const origin = new URL(request.url).origin;
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
}

/**
 * Authenticate MCP requests with an OAuth access token.
 * Returns 401 with WWW-Authenticate: Bearer when no auth so MCP clients start OAuth.
 */
async function requireMcpAuth(
  ctx: {
    runQuery: (...args: any[]) => Promise<any>;
    runMutation: (...args: any[]) => Promise<any>;
  },
  request: Request,
  options: { allowOperator?: boolean } = {},
): Promise<McpIdentity> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: {
        ...JSON_HEADERS,
        "WWW-Authenticate": mcpResourceMetadataAuthenticateHeader(request),
      },
    });
  }

  const rawToken = authHeader.slice(7);

  if (rawToken.startsWith("prsm_at_")) {
    const tokenHash = await sha256Hex(rawToken);
    const result = await ctx.runQuery(
      (internal as any).oauth.validateAccessTokenWithScopes,
      { tokenHash },
    );
    if (!result) {
      throw new Response("Invalid or expired token", {
        status: 401,
        headers: {
          ...JSON_HEADERS,
          "WWW-Authenticate": `Bearer error="invalid_token", resource_metadata="${new URL(request.url).origin}/.well-known/oauth-protected-resource"`,
        },
      });
    }
    const expectedResource = `${new URL(request.url).origin}/mcp`;
    if (result.resource && result.resource !== expectedResource) {
      throw new Response("Token audience does not match this MCP server", {
        status: 401,
        headers: {
          ...JSON_HEADERS,
          "WWW-Authenticate": `Bearer error="invalid_token", resource_metadata="${new URL(request.url).origin}/.well-known/oauth-protected-resource"`,
        },
      });
    }
    if (result.principalKind === "operator") {
      if (!result.operatorRole || result.resource !== expectedResource) {
        throw new Response("Invalid operator token", {
          status: 401,
          headers: {
            ...JSON_HEADERS,
            "WWW-Authenticate": mcpResourceMetadataAuthenticateHeader(request),
          },
        });
      }
      if (!options.allowOperator) {
        throw new Response(
          JSON.stringify({
            error: "forbidden",
            error_description:
              "Operator credentials are only accepted by the MCP protocol endpoint",
          }),
          { status: 403, headers: JSON_HEADERS },
        );
      }
      return {
        principalKind: "operator",
        userId: result.userId,
        operatorRole: result.operatorRole,
        tokenId: result.tokenId,
        scopes: result.scopes ?? ["read"],
      };
    }
    if (!result.orgId) {
      throw new Response("Invalid organization token", { status: 401 });
    }
    return {
      principalKind: "organization",
      userId: result.userId,
      orgId: result.orgId,
      tokenId: result.tokenId,
      scopes: result.scopes ?? ["read"],
    };
  }

  throw new Response("Invalid token format", {
    status: 401,
    headers: {
      ...JSON_HEADERS,
      "WWW-Authenticate": mcpResourceMetadataAuthenticateHeader(request),
    },
  });
}

function getQueryParam(request: Request, name: string): string | null {
  const url = new URL(request.url);
  return url.searchParams.get(name);
}

function requireMcpWriteScope(identity: McpIdentity): void {
  if (!(identity.scopes ?? ["read"]).includes("write")) {
    throw new Error("insufficient_scope: this tool requires write scope");
  }
}

function mcpCanWrite(identity: McpIdentity): boolean {
  return (identity.scopes ?? ["read"]).includes("write");
}

function normalizeCertificateRequest(body: Record<string, unknown>) {
  const certificateHolder =
    typeof body.certificate_holder === "string"
      ? body.certificate_holder.trim()
      : "";
  const certificateHolderAddressLines = certificateHolder
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(1)
    .filter(
      (line) =>
        !/^(attn|attention|email|e-mail|phone|tel|telephone)\s*:/i.test(line),
    );
  const holderName =
    (typeof body.holderName === "string" && body.holderName.trim()) ||
    (typeof body.certificate_holder_name === "string" &&
      body.certificate_holder_name.trim()) ||
    certificateHolder.split(/\r?\n/)[0]?.trim() ||
    "";
  const requestedEndorsements = Array.isArray(body.requestedEndorsements)
    ? body.requestedEndorsements.filter(
        (item): item is string => typeof item === "string",
      )
    : Array.isArray(body.requested_endorsements)
      ? body.requested_endorsements.filter(
          (item): item is string => typeof item === "string",
        )
      : undefined;
  const requirementSourceDocumentId =
    (typeof body.requirementSourceDocumentId === "string" &&
      body.requirementSourceDocumentId) ||
    (typeof body.requirement_source_document_id === "string" &&
      body.requirement_source_document_id) ||
    undefined;
  const requirementId =
    (typeof body.requirementId === "string" && body.requirementId) ||
    (typeof body.requirement_id === "string" && body.requirement_id) ||
    undefined;

  return {
    holderName,
    holderContactName:
      (typeof body.holderContactName === "string" &&
        body.holderContactName.trim()) ||
      (typeof body.holder_contact_name === "string" &&
        body.holder_contact_name.trim()) ||
      (typeof body.certificate_holder_contact_name === "string" &&
        body.certificate_holder_contact_name.trim()) ||
      undefined,
    holderEmail:
      (typeof body.holderEmail === "string" && body.holderEmail.trim()) ||
      (typeof body.holder_email === "string" && body.holder_email.trim()) ||
      (typeof body.certificate_holder_email === "string" &&
        body.certificate_holder_email.trim()) ||
      (typeof body.recipient_email === "string" &&
        body.recipient_email.trim()) ||
      undefined,
    holderPhone:
      (typeof body.holderPhone === "string" && body.holderPhone.trim()) ||
      (typeof body.holder_phone === "string" && body.holder_phone.trim()) ||
      (typeof body.certificate_holder_phone === "string" &&
        body.certificate_holder_phone.trim()) ||
      (typeof body.recipient_phone === "string" &&
        body.recipient_phone.trim()) ||
      undefined,
    addressLine1:
      (typeof body.addressLine1 === "string" && body.addressLine1.trim()) ||
      (typeof body.address_line_1 === "string" && body.address_line_1.trim()) ||
      certificateHolderAddressLines[0] ||
      undefined,
    addressLine2:
      (typeof body.addressLine2 === "string" && body.addressLine2.trim()) ||
      (typeof body.address_line_2 === "string" && body.address_line_2.trim()) ||
      certificateHolderAddressLines[1] ||
      undefined,
    city: (typeof body.city === "string" && body.city.trim()) || undefined,
    state: (typeof body.state === "string" && body.state.trim()) || undefined,
    postalCode:
      (typeof body.postalCode === "string" && body.postalCode.trim()) ||
      (typeof body.postal_code === "string" && body.postal_code.trim()) ||
      undefined,
    country:
      (typeof body.country === "string" && body.country.trim()) ||
      (typeof body.country_code === "string" && body.country_code.trim()) ||
      (typeof body.certificate_holder_country === "string" &&
        body.certificate_holder_country.trim()) ||
      undefined,
    requestText:
      (typeof body.requestText === "string" && body.requestText.trim()) ||
      (typeof body.request_text === "string" && body.request_text.trim()) ||
      undefined,
    descriptionOfOperations:
      (typeof body.descriptionOfOperations === "string" &&
        body.descriptionOfOperations.trim()) ||
      (typeof body.description_of_operations === "string" &&
        body.description_of_operations.trim()) ||
      undefined,
    requestedEndorsements,
    requirementSourceDocumentId: requirementSourceDocumentId as
      | Id<"requirementSourceDocuments">
      | undefined,
    requirementId: requirementId as Id<"insuranceRequirements"> | undefined,
    additionalInsuredName:
      (typeof body.additionalInsuredName === "string" &&
        body.additionalInsuredName.trim()) ||
      (typeof body.additional_insured_name === "string" &&
        body.additional_insured_name.trim()) ||
      undefined,
    forceReissue:
      body.forceReissue === true ||
      body.explicitReissue === true ||
      body.explicit_reissue === true ||
      body.reissue === true,
  };
}

function compatibleCertificateGenerationResponse(
  batch: Record<string, any>,
  requirementsMode: boolean,
) {
  if (requirementsMode) return batch;
  return Array.isArray(batch.results) && batch.results.length === 1
    ? batch.results[0]
    : batch;
}

function certificateWorkflowJobStatusParam(status: string | null) {
  if (
    status === "review_required" ||
    status === "blocked_missing_contact" ||
    status === "sending" ||
    status === "sent" ||
    status === "cancelled" ||
    status === "failed"
  ) {
    return status;
  }
  return undefined;
}

function effectivePolicyDataStage(policy: Record<string, unknown>) {
  const stage = policy.extractionDataStage;
  if (stage === "placeholder" || stage === "preview" || stage === "final") {
    return stage;
  }
  return policy.pipelineStatus === "complete" ? "final" : "placeholder";
}

function policyFileIsAvailable(policy: Record<string, unknown>) {
  return (
    policy.pipelineStatus === "complete" &&
    effectivePolicyDataStage(policy) === "final"
  );
}

function policyFileUnavailableMessage(policy: Record<string, unknown>) {
  return `Policy ${String(policy.policyNumber ?? policy._id ?? "record")} must finish extraction before its original PDF is available.`;
}

// GET /mcp/policies/list
http.route({
  path: "/mcp/policies/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const policies = await ctx.runQuery(
        internal.policies.listAllPreviewReadableInternal,
        {
          orgId: identity.orgId as Id<"organizations">,
        },
      );

      // Apply optional filters from query params
      const carrier = getQueryParam(request, "carrier");
      const year = getQueryParam(request, "year");
      const type = getQueryParam(request, "type");

      const filtered = policies.filter((policy: McpPolicySummarySource) =>
        policyMatchesMcpFilters(policy, { carrier, year, type }),
      );

      // Return lightweight summaries
      return jsonResponse(filtered.map(toMcpPolicySummaryDto));
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/policies/get
http.route({
  path: "/mcp/policies/get",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const id = getQueryParam(request, "id");
      if (!id) return jsonResponse({ error: "Missing id parameter" }, 400);

      const policy = await ctx.runQuery(
        internal.policies.listAllPreviewReadableInternal,
        {
          orgId: identity.orgId as Id<"organizations">,
        },
      );
      const found = policy.find((p: any) => p._id === id);
      if (!found) return jsonResponse({ error: "Not found" }, 404);

      return jsonResponse(found);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/policies/file
http.route({
  path: "/mcp/policies/file",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const id = getQueryParam(request, "id");
      if (!id) return jsonResponse({ error: "Missing id parameter" }, 400);

      const policies = await ctx.runQuery(
        internal.policies.listAllPreviewReadableInternal,
        {
          orgId: identity.orgId as Id<"organizations">,
        },
      );
      const found = policies.find((p: any) => p._id === id);
      if (!found) return jsonResponse({ error: "Not found" }, 404);
      if (!policyFileIsAvailable(found as Record<string, unknown>)) {
        return jsonResponse(
          {
            error: policyFileUnavailableMessage(
              found as Record<string, unknown>,
            ),
          },
          409,
        );
      }
      if (!found.fileId) {
        return jsonResponse(
          { error: "Original policy PDF is not available" },
          404,
        );
      }
      const url = await ctx.storage.getUrl(found.fileId as Id<"_storage">);
      if (!url)
        return jsonResponse(
          { error: "Original policy PDF is not available" },
          404,
        );
      return jsonResponse(toPolicyFileDto(found, url));
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/policies/search
http.route({
  path: "/mcp/policies/search",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const q = getQueryParam(request, "q");
      if (!q) return jsonResponse({ error: "Missing q parameter" }, 400);

      const policies = await ctx.runQuery(
        internal.policies.listAllPreviewReadableInternal,
        {
          orgId: identity.orgId as Id<"organizations">,
        },
      );

      const results = policies.filter((policy: McpPolicySummarySource) =>
        policyMatchesSearch(policy, q),
      );

      return jsonResponse(results.map(toMcpPolicySearchResultDto));
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/policies/stats
http.route({
  path: "/mcp/policies/stats",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const policies = await ctx.runQuery(
        internal.policies.listAllPreviewReadableInternal,
        {
          orgId: identity.orgId as Id<"organizations">,
        },
      );

      return jsonResponse(toPolicyStatsDto(policies));
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/policies/certificates/list
http.route({
  path: "/mcp/policies/certificates/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const policyId =
        getQueryParam(request, "policyId") ??
        getQueryParam(request, "policy_id");
      if (!policyId)
        return jsonResponse({ error: "Missing policyId parameter" }, 400);

      const certificates = await ctx.runQuery(
        internal.certificates.listByPolicyInternal,
        {
          orgId: identity.orgId as Id<"organizations">,
          policyId: policyId as Id<"policies">,
        },
      );
      return jsonResponse(certificates.map(toCertificateDto));
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/certificates/holders/list
http.route({
  path: "/mcp/certificates/holders/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const holders = await ctx.runQuery(
        internal.certificateHolders.listForOrgInternal,
        {
          orgId: identity.orgId as Id<"organizations">,
          query:
            getQueryParam(request, "query") ??
            getQueryParam(request, "q") ??
            undefined,
        },
      );
      return jsonResponse(holders.map(toCertificateHolderDto));
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/policies/versions/list
http.route({
  path: "/mcp/policies/versions/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const policyId =
        getQueryParam(request, "policyId") ??
        getQueryParam(request, "policy_id");
      const versions = await ctx.runQuery(
        internal.policyVersions.listForOrgInternal,
        {
          orgId: identity.orgId as Id<"organizations">,
          policyId: policyId ? (policyId as Id<"policies">) : undefined,
        },
      );
      return jsonResponse(versions.map(toPolicyVersionDto));
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/policies/certificates/versions/list
http.route({
  path: "/mcp/policies/certificates/versions/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const versions = await ctx.runQuery(
        internal.certificateLifecycle.listVersionsInternal,
        {
          orgId: identity.orgId as Id<"organizations">,
          policyId: (getQueryParam(request, "policyId") ??
            getQueryParam(request, "policy_id") ??
            undefined) as Id<"policies"> | undefined,
          certificateId: (getQueryParam(request, "certificateId") ??
            getQueryParam(request, "certificate_id") ??
            undefined) as Id<"policyCertificates"> | undefined,
          holderId: (getQueryParam(request, "holderId") ??
            getQueryParam(request, "holder_id") ??
            getQueryParam(request, "certificateHolderId") ??
            getQueryParam(request, "certificate_holder_id") ??
            undefined) as Id<"certificateHolders"> | undefined,
        },
      );
      return jsonResponse(versions.map(toCertificateVersionDto));
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/certificates/review-jobs/list
http.route({
  path: "/mcp/certificates/review-jobs/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const jobs = await ctx.runQuery(
        internal.certificateWorkflowJobs.listForOrgInternal,
        {
          orgId: identity.orgId as Id<"organizations">,
          policyId: (getQueryParam(request, "policyId") ??
            getQueryParam(request, "policy_id") ??
            undefined) as Id<"policies"> | undefined,
          status: certificateWorkflowJobStatusParam(
            getQueryParam(request, "status"),
          ),
        },
      );
      return jsonResponse(jobs.map(toCertificateWorkflowJobDto));
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// POST /mcp/policies/certificates/generate
http.route({
  path: "/mcp/policies/certificates/generate",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      requireMcpWriteScope(identity);
      const body = (await request.json()) as Record<string, unknown>;
      const policyId = body.policyId ?? body.policy_id;
      const certificate = normalizeCertificateRequest(body);
      const requirementsMode = Boolean(
        certificate.requirementSourceDocumentId || certificate.requirementId,
      );
      if (Boolean(policyId) === requirementsMode) {
        return jsonResponse(
          { error: "Choose either policyId or a requirement source" },
          400,
        );
      }
      if (!requirementsMode && !certificate.holderName) {
        return jsonResponse({ error: "Missing certificate holder" }, 400);
      }

      const result = await ctx.runAction(
        internal.certificates.generateBatchForOrg,
        {
          orgId: identity.orgId as Id<"organizations">,
          primaryPolicyId: policyId as Id<"policies"> | undefined,
          ...certificate,
          source: "mcp",
          createdByUserId: identity.userId as Id<"users">,
        },
      );
      return jsonResponse(
        compatibleCertificateGenerationResponse(result, requirementsMode),
        201,
      );
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/threads/list
http.route({
  path: "/mcp/threads/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const threads = await ctx.runQuery(internal.threads.listByOrg, {
        orgId: identity.orgId as Id<"organizations">,
        userId: identity.userId as Id<"users">,
      });
      return jsonResponse(threads.map(toMcpThreadSummaryDto));
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/threads/messages
http.route({
  path: "/mcp/threads/messages",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const threadId = getQueryParam(request, "threadId");
      if (!threadId)
        return jsonResponse({ error: "Missing threadId parameter" }, 400);

      // Verify thread belongs to org
      const thread = await ctx.runQuery(internal.threads.getInternal, {
        id: threadId as Id<"threads">,
      });
      if (
        !thread ||
        !canAccessThread({
          userId: identity.userId as Id<"users">,
          userOrgId: identity.orgId as Id<"organizations">,
          thread,
          clientOrg: null,
        })
      ) {
        return jsonResponse({ error: "Not found" }, 404);
      }

      const messages = await ctx.runQuery(internal.threads.messagesInternal, {
        threadId: threadId as Id<"threads">,
      });
      return jsonResponse(messages.map(toMcpThreadMessageDto));
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/org/info
http.route({
  path: "/mcp/org/info",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const org = await ctx.runQuery(internal.orgs.getInternal, {
        id: identity.orgId as Id<"organizations">,
      });
      if (!org) return jsonResponse({ error: "Not found" }, 404);
      return jsonResponse({
        _id: org._id,
        name: org.name,
        website: org.website,
        industry: org.industry,
        industryVertical: org.industryVertical,
        context: org.context,
      });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// ── MCP Streamable HTTP Transport ──
// Single endpoint implementing MCP protocol over HTTP for remote clients (Claude.ai, etc.)

function mcpOAuthSecuritySchemes(scopes: Array<"read" | "write">) {
  return [{ type: "oauth2" as const, scopes }];
}

function operatorMcpTools(identity: OperatorMcpIdentity) {
  return buildOperatorMcpToolCatalog({
    canWrite: mcpCanWrite(identity),
    operatorRole: identity.operatorRole,
  });
}

type TenantMcpToolCatalogEntry = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  effect?: "read" | "write";
  openWorld?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
};

const MCP_TOOLS: TenantMcpToolCatalogEntry[] = [
  {
    name: "list_policies",
    description:
      "List insurance policies. Optionally filter by carrier, year, or line of business.",
    inputSchema: {
      type: "object" as const,
      properties: {
        carrier: { type: "string", description: "Filter by carrier name" },
        year: {
          type: "string",
          description: "Filter by policy year (e.g. '2024')",
        },
        type: {
          type: "string",
          description:
            "Filter by ACORD line of business code or label (e.g. 'CGL', 'Commercial General Liability')",
        },
      },
    },
  },
  {
    name: "get_policy",
    description:
      "Get full details of a specific insurance policy by ID, including coverages, document sections, and metadata.",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string", description: "The policy ID" } },
      required: ["id"],
    },
  },
  {
    name: "get_policy_pdf",
    description:
      "Get a temporary download URL for the original full policy PDF document by policy ID.",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string", description: "The policy ID" } },
      required: ["id"],
    },
  },
  {
    name: "search_policies",
    description:
      "Search across policies by text query. Searches carrier, policy number, insured name, summary, and lines of business.",
    inputSchema: {
      type: "object" as const,
      properties: { q: { type: "string", description: "Search query text" } },
      required: ["q"],
    },
  },
  {
    name: "get_policy_stats",
    description:
      "Get dashboard statistics for policies: total count, breakdown by type, carrier, and year.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "list_policy_certificates",
    description:
      "List generated Certificates of Insurance for a policy, including download URLs and lifecycle metadata.",
    inputSchema: {
      type: "object" as const,
      properties: {
        policyId: { type: "string", description: "The policy ID" },
      },
      required: ["policyId"],
    },
  },
  {
    name: "list_certificate_holders",
    description: "List/search the organization's certificate holder registry.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Optional holder name, email, or address search text",
        },
      },
    },
  },
  {
    name: "list_policy_versions",
    description:
      "List policy document-event versions. Use this when the user explicitly asks for policy history, renewals, endorsements, re-extractions, or prior versions; current policy answers should use get_policy/list_policies by default.",
    inputSchema: {
      type: "object" as const,
      properties: {
        policyId: {
          type: "string",
          description:
            "Optional policy ID. Omit to list recent versions for the organization.",
        },
      },
    },
  },
  {
    name: "list_certificate_versions",
    description:
      "List certificate issue/reissue versions by policy, certificate parent, or holder.",
    inputSchema: {
      type: "object" as const,
      properties: {
        policyId: { type: "string", description: "Optional policy ID" },
        certificateId: {
          type: "string",
          description: "Optional policy certificate parent ID",
        },
        holderId: {
          type: "string",
          description: "Optional certificate holder ID",
        },
        certificateHolderId: {
          type: "string",
          description: "Optional alias for holderId",
        },
      },
    },
  },
  {
    name: "list_certificate_review_jobs",
    description:
      "List certificate renewal/post-endorsement/manual review jobs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        policyId: { type: "string", description: "Optional policy ID" },
        status: {
          type: "string",
          description:
            "Optional job status: review_required, blocked_missing_contact, sending, sent, cancelled, or failed",
        },
      },
    },
  },
  {
    name: "generate_policy_certificate",
    description:
      "Generate certificate PDFs in one exclusive mode: policyId plus holder details for one all-coverages certificate, or requirementSourceDocumentId/requirementId for source-owned holder details and requirement-specific certificates across matching policies. Requires write scope.",
    inputSchema: {
      type: "object" as const,
      properties: {
        policyId: {
          type: "string",
          description: "Policy-mode ID; omit in requirements mode",
        },
        requirementSourceDocumentId: {
          type: "string",
          description:
            "Requirements-mode source ID; omit policy and holder inputs",
        },
        requirementId: {
          type: "string",
          description:
            "Requirements-mode single requirement ID; Spot uses its connected source",
        },
        holderName: { type: "string", description: "Certificate holder name" },
        holderContactName: {
          type: "string",
          description: "Certificate holder contact or attention name",
        },
        holderEmail: {
          type: "string",
          description: "Certificate holder email for renewal delivery",
        },
        holderPhone: {
          type: "string",
          description: "Certificate holder phone for renewal delivery",
        },
        addressLine1: {
          type: "string",
          description: "Certificate holder street address",
        },
        addressLine2: {
          type: "string",
          description: "Suite, floor, or attention line",
        },
        city: { type: "string", description: "Certificate holder city" },
        state: { type: "string", description: "Certificate holder state" },
        postalCode: {
          type: "string",
          description: "Certificate holder ZIP or postal code",
        },
        country: {
          type: "string",
          description: "Certificate holder country",
        },
        requestText: {
          type: "string",
          description:
            "Full certificate request text, especially endorsement or special wording language",
        },
        requestedEndorsements: {
          type: "array",
          items: { type: "string" },
          description: "Requested endorsements or special wording",
        },
        descriptionOfOperations: {
          type: "string",
          description:
            "Concise source-backed operations/location/vehicle/special-item wording for the certificate description box. Do not include carrier, policy number, term, limits, or unsupported endorsement status.",
        },
        additionalInsuredName: {
          type: "string",
          description: "Requested additional insured name when applicable",
        },
        explicitReissue: {
          type: "boolean",
          description:
            "Force a new certificate version even if an issued certificate already exists for this holder and current policy version",
        },
      },
      oneOf: [
        { required: ["policyId", "holderName"] },
        { required: ["requirementSourceDocumentId"] },
        { required: ["requirementId"] },
      ],
    },
    effect: "write",
  },
  {
    name: "list_threads",
    description: "List recent conversation threads (up to 50, newest first).",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_thread_messages",
    description: "Get all messages in a conversation thread.",
    inputSchema: {
      type: "object" as const,
      properties: {
        threadId: { type: "string", description: "The thread ID" },
      },
      required: ["threadId"],
    },
  },
  {
    name: "get_org_info",
    description:
      "Get organization profile information including name, industry, website, and broker details.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "ask_glass",
    description:
      "Legacy alias for ask_spot. Ask the Spot AI assistant a question about the organization's insurance portfolio.",
    inputSchema: {
      type: "object" as const,
      properties: {
        message: {
          type: "string",
          description: "The question or message to send to Spot",
        },
        threadId: {
          type: "string",
          description:
            "Optional thread ID to continue an existing conversation",
        },
      },
      required: ["message"],
    },
    openWorld: true,
  },
  {
    name: "ask_spot",
    description:
      "Ask the Spot AI assistant a question about the organization's insurance portfolio, bound policies, renewals, or coverage details. Spot answers within the selected organization. Optionally pass a threadId to continue an existing conversation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        message: {
          type: "string",
          description: "The question or message to send to Spot",
        },
        threadId: {
          type: "string",
          description:
            "Optional thread ID to continue an existing conversation",
        },
      },
      required: ["message"],
    },
    openWorld: true,
  },
  {
    name: "list_email_drafts",
    description:
      "List durable outbound email drafts for the organization. Returns a compact text summary by default, with a sample and draft IDs. Optionally filter by threadId or set showAll to see every draft.",
    inputSchema: {
      type: "object" as const,
      properties: {
        threadId: { type: "string", description: "Optional thread ID" },
        showAll: {
          type: "boolean",
          description: "Show every draft instead of a short sample",
        },
      },
    },
  },
  {
    name: "draft_email",
    description:
      "Create a durable outbound email draft using the same Spot email artifact used by web chat. Requires write scope. Returns a draft ID that can be updated, sent, or cancelled.",
    inputSchema: {
      type: "object" as const,
      properties: {
        threadId: {
          type: "string",
          description: "Optional thread ID to attach the draft to",
        },
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Plain text email body" },
        cc: {
          type: "array",
          items: { type: "string" },
          description: "CC email addresses",
        },
        bcc: {
          type: "array",
          items: { type: "string" },
          description: "BCC email addresses",
        },
        originalPolicyIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Policy IDs whose original full policy PDFs should be attached",
        },
      },
      required: ["to", "subject", "body"],
    },
    effect: "write",
  },
  {
    name: "update_email_draft",
    description:
      "Update an existing durable outbound email draft in place. Requires write scope.",
    inputSchema: {
      type: "object" as const,
      properties: {
        draftId: {
          type: "string",
          description: "Draft ID returned by draft_email or list_email_drafts",
        },
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Plain text email body" },
        cc: {
          type: "array",
          items: { type: "string" },
          description: "CC email addresses",
        },
        bcc: {
          type: "array",
          items: { type: "string" },
          description: "BCC email addresses",
        },
        originalPolicyIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Policy IDs whose original full policy PDFs should be attached",
        },
      },
      required: ["draftId", "to", "subject", "body"],
    },
    effect: "write",
  },
  {
    name: "send_email_draft",
    description: "Send a durable outbound email draft. Requires write scope.",
    inputSchema: {
      type: "object" as const,
      properties: {
        draftId: {
          type: "string",
          description: "Draft ID returned by draft_email or list_email_drafts",
        },
      },
      required: ["draftId"],
    },
    effect: "write",
    openWorld: true,
    idempotent: false,
  },
  {
    name: "send_email_drafts",
    description:
      "Send multiple durable outbound email drafts in one batch. Requires write scope.",
    inputSchema: {
      type: "object" as const,
      properties: {
        draftIds: {
          type: "array",
          items: { type: "string" },
          description: "Draft IDs returned by list_email_drafts",
        },
      },
      required: ["draftIds"],
    },
    effect: "write",
    openWorld: true,
    idempotent: false,
  },
  {
    name: "cancel_email_draft",
    description: "Cancel a durable outbound email draft. Requires write scope.",
    inputSchema: {
      type: "object" as const,
      properties: {
        draftId: {
          type: "string",
          description: "Draft ID returned by draft_email or list_email_drafts",
        },
      },
      required: ["draftId"],
    },
    effect: "write",
  },
  {
    name: "list_client_files",
    description:
      "List client-visible shared files across the caller's readable client scope, optionally narrowed to one exact client organization.",
    inputSchema: {
      type: "object" as const,
      properties: {
        client_org_id: {
          type: "string",
          description: "Optional exact readable client organization ID",
        },
        query: { type: "string", description: "Optional filename search" },
        limit: { type: "number", description: "Maximum results, up to 50" },
      },
    },
  },
  {
    name: "get_client_file",
    description:
      "Get metadata and a temporary download URL for one exact client-visible shared file.",
    inputSchema: {
      type: "object" as const,
      properties: {
        client_file_id: { type: "string", description: "Exact client file ID" },
      },
      required: ["client_file_id"],
    },
  },
  {
    name: "read_company_wiki",
    description:
      "Read the company wiki for the OAuth token's organization: the whole markdown document, its sections, and the sections still empty.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "write_company_wiki_section",
    description:
      "Rewrite one section of the company wiki for the OAuth token's organization. Send the whole section body as markdown; an empty body clears the section. Requires write scope and current org admin membership.",
    inputSchema: {
      type: "object" as const,
      properties: {
        section: {
          type: "string",
          enum: [...ORG_WIKI_SECTION_KEYS],
          description: "Company wiki section key",
        },
        body: { type: "string", description: "Whole section body as markdown" },
      },
      required: ["section", "body"],
    },
    effect: "write",
  },
  {
    name: "list_connected_vendors",
    description:
      "List vendor organizations that have approved read-only insurance access for the caller's org.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_connected_vendor",
    description: "Get a connected vendor org profile and policy count.",
    inputSchema: {
      type: "object" as const,
      properties: {
        vendor_org_id: {
          type: "string",
          description: "Connected vendor org ID",
        },
      },
      required: ["vendor_org_id"],
    },
  },
  {
    name: "list_connected_vendor_policies",
    description:
      "List policies for a connected vendor org that approved access.",
    inputSchema: {
      type: "object" as const,
      properties: {
        vendor_org_id: {
          type: "string",
          description: "Connected vendor org ID",
        },
      },
      required: ["vendor_org_id"],
    },
  },
  {
    name: "list_my_policies",
    description: "List policies for the caller's client org. Client only.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "list_insurance_requirements",
    description:
      "List the caller org's insurance compliance requirements, including source document provenance when available.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "create_insurance_requirement",
    description:
      "Create a typed insurance coverage requirement checked against policy coverages. Requires write scope and org admin role.",
    inputSchema: {
      type: "object" as const,
      properties: {
        kind: {
          type: "string",
          description: 'Always "coverage"',
        },
        scope: {
          type: "string",
          description: "vendors or own_org",
        },
        title: { type: "string", description: "Short requirement title" },
        requirement_text: {
          type: "string",
          description: "Plain-language requirement text",
        },
        line_of_business: {
          type: "string",
          description: "ACORD line of business code, e.g. CGL",
        },
        limits: {
          type: "array",
          description:
            'Coverage limits: { kind, amount, label }. amount is a plain number (1000000, not "$1M"). Limit kinds include per_occurrence, general_aggregate, combined_single_limit, other.',
        },
        source_document_name: {
          type: "string",
          description: "Optional lease, contract, or requirement packet name",
        },
        source_excerpt: {
          type: "string",
          description:
            "Optional exact original source language supporting the requirement",
        },
      },
      required: [
        "kind",
        "scope",
        "title",
        "requirement_text",
        "line_of_business",
      ],
    },
    effect: "write",
  },
  {
    name: "list_vendor_compliance",
    description:
      "List connected vendor compliance status against the caller org's insurance requirements.",
    inputSchema: { type: "object" as const, properties: {} },
  },
];

const AUTHENTICATED_TENANT_MCP_TOOLS = MCP_TOOLS.map((entry) => {
  const {
    effect = "read",
    openWorld = false,
    destructive = false,
    idempotent,
    ...tool
  } = entry;
  const write = effect === "write";
  return {
    ...tool,
    title: tool.description.split(".")[0],
    securitySchemes: mcpOAuthSecuritySchemes(
      write ? ["read", "write"] : ["read"],
    ),
    annotations: {
      readOnlyHint: !write,
      destructiveHint: destructive,
      idempotentHint: idempotent ?? !write,
      openWorldHint: openWorld,
    },
  };
});

export function tenantMcpToolAccess(name: string) {
  const tool = MCP_TOOLS.find((entry) => entry.name === name);
  if (!tool) return null;
  return {
    effect: tool.effect ?? ("read" as const),
    openWorld: tool.openWorld ?? false,
    destructive: tool.destructive ?? false,
  };
}

export function tenantMcpToolNames() {
  return MCP_TOOLS.map((tool) => tool.name);
}

function jsonRpcResponse(
  id: string | number | null,
  result: unknown,
): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "Content-Type": "application/json" },
  });
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }),
    { headers: { "Content-Type": "application/json" } },
  );
}

function mcpTextResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

type McpToolContext = Pick<
  ActionCtx,
  "runQuery" | "runMutation" | "runAction" | "storage"
>;

type StoredOperatorMcpAttachment = {
  fileId: Id<"_storage">;
  filename: string;
  contentType: string;
  size: number;
};

async function deleteOperatorMcpAttachments(
  ctx: McpToolContext,
  attachments: StoredOperatorMcpAttachment[],
) {
  await Promise.all(
    attachments.map((attachment) =>
      ctx.storage.delete(attachment.fileId).catch(() => undefined),
    ),
  );
}

async function storeOperatorMcpAttachments(
  ctx: McpToolContext,
  input: unknown,
): Promise<StoredOperatorMcpAttachment[]> {
  const decoded = decodeOperatorMcpAttachments(input);
  const stored: StoredOperatorMcpAttachment[] = [];
  try {
    for (const attachment of decoded) {
      const contents = new ArrayBuffer(attachment.bytes.byteLength);
      new Uint8Array(contents).set(attachment.bytes);
      const fileId = await ctx.storage.store(
        new Blob([contents], { type: attachment.contentType }),
      );
      stored.push({
        fileId,
        filename: attachment.filename,
        contentType: attachment.contentType,
        size: attachment.bytes.byteLength,
      });
    }
    return stored;
  } catch (error) {
    await deleteOperatorMcpAttachments(ctx, stored);
    throw error;
  }
}

async function handleOperatorMcpToolCall(
  ctx: McpToolContext,
  identity: OperatorMcpIdentity,
  name: string,
  args: Record<string, unknown>,
) {
  const operatorUserId = identity.userId as Id<"users">;
  const suppliedIdempotencyKey =
    typeof args.idempotency_key === "string" ? args.idempotency_key.trim() : "";
  if (suppliedIdempotencyKey.length > 200) {
    throw new Error("idempotency_key must be at most 200 characters");
  }
  const requestKey = `mcp:${identity.userId}:${
    suppliedIdempotencyKey || crypto.randomUUID()
  }`;

  if (name in OPERATOR_AGENT_TOOL_REGISTRY) {
    const spec =
      OPERATOR_AGENT_TOOL_REGISTRY[
        name as keyof typeof OPERATOR_AGENT_TOOL_REGISTRY
      ];
    if (spec.effect !== "read") requireMcpWriteScope(identity);
    const result = await ctx.runAction(
      (internal as any).operatorAgent.invokeRegisteredToolInternal,
      {
        operatorUserId,
        conversationKey: `mcp:${identity.tokenId ?? identity.userId}`,
        channel: "mcp",
        toolName: name,
        input: args,
        idempotencyKey: requestKey,
      },
    );
    return mcpTextResult(result);
  }

  if (name === "run_operator_task") {
    requireMcpWriteScope(identity);
    const objective =
      typeof args.objective === "string" ? args.objective.trim() : "";
    if (!objective) throw new Error("Missing objective parameter");
    const attachments = await storeOperatorMcpAttachments(
      ctx,
      args.attachments,
    );
    try {
      let threadId =
        typeof args.thread_id === "string"
          ? (args.thread_id as Id<"operatorAgentThreads">)
          : undefined;
      if (!threadId) {
        const conversationKey =
          typeof args.conversation_key === "string" &&
          args.conversation_key.trim()
            ? args.conversation_key.trim()
            : `mcp:${identity.tokenId ?? identity.userId}`;
        threadId = await ctx.runMutation(
          (internal as any).operatorAgent.createOrGetChannelThreadInternal,
          {
            operatorUserId,
            channel: "mcp",
            conversationKey,
            title: "External operator agent",
          },
        );
      }
      const queued = await ctx.runMutation(
        (internal as any).operatorAgent.enqueueMessageInternal,
        {
          operatorUserId,
          threadId,
          channel: "mcp",
          content: objective,
          dedupeKey: requestKey,
          attachments: attachments.length ? attachments : undefined,
        },
      );
      if (queued.duplicate) {
        await deleteOperatorMcpAttachments(ctx, attachments);
      }
      return mcpTextResult({ threadId, ...queued });
    } catch (error) {
      await deleteOperatorMcpAttachments(ctx, attachments);
      throw error;
    }
  }

  if (name === "get_operator_run") {
    const runId =
      typeof args.run_id === "string"
        ? (args.run_id as Id<"operatorAgentRuns">)
        : undefined;
    if (!runId) throw new Error("Missing run_id parameter");
    const result = await ctx.runQuery(
      (internal as any).operatorAgent.getRunResultForOperatorInternal,
      { operatorUserId, runId },
    );
    return mcpTextResult(result);
  }

  if (name === "cancel_operator_run") {
    requireMcpWriteScope(identity);
    const runId =
      typeof args.run_id === "string"
        ? (args.run_id as Id<"operatorAgentRuns">)
        : undefined;
    if (!runId) throw new Error("Missing run_id parameter");
    const current = await ctx.runQuery(
      (internal as any).operatorAgent.getRunResultForOperatorInternal,
      { operatorUserId, runId },
    );
    const threadId = current?.run?.threadId as
      | Id<"operatorAgentThreads">
      | undefined;
    if (!threadId) throw new Error("Operator run not found");
    const result = await ctx.runMutation(
      (internal as any).operatorAgent.cancelRunInternal,
      { operatorUserId, threadId },
    );
    return mcpTextResult({ runId, threadId, ...result });
  }

  if (name === "confirm_operator_action") {
    requireMcpWriteScope(identity);
    const threadId =
      typeof args.thread_id === "string"
        ? (args.thread_id as Id<"operatorAgentThreads">)
        : undefined;
    const confirmationId =
      typeof args.confirmation_id === "string"
        ? (args.confirmation_id as Id<"operatorAgentConfirmations">)
        : undefined;
    const decision = args.decision;
    if (!threadId || !confirmationId) {
      throw new Error("thread_id and confirmation_id are required");
    }
    if (decision !== "approve" && decision !== "reject") {
      throw new Error("decision must be approve or reject");
    }
    const result = await ctx.runMutation(
      (internal as any).operatorAgent.confirmActionInternal,
      {
        operatorUserId,
        threadId,
        confirmationId,
        decision,
        channel: "mcp",
      },
    );
    return mcpTextResult(result);
  }

  throw new Error(`Unknown operator tool: ${name}`);
}

async function handleToolCall(
  ctx: McpToolContext,
  identity: McpIdentity,
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  if (identity.principalKind === "operator") {
    return handleOperatorMcpToolCall(ctx, identity, name, args);
  }
  const orgId = identity.orgId as Id<"organizations">;
  const userId = identity.userId as Id<"users">;

  switch (name) {
    case "list_client_files": {
      const scope = await ctx.runQuery(
        internal.lib.agentScope.resolveForAction,
        {
          orgId,
          userId,
          surface: "mcp",
        },
      );
      const requestedOrgId =
        typeof args.client_org_id === "string" ? args.client_org_id : undefined;
      const orgIds = requestedOrgId
        ? scope.readOrgIds.filter(
            (readOrgId: Id<"organizations">) =>
              String(readOrgId) === requestedOrgId,
          )
        : scope.readOrgIds;
      if (requestedOrgId && orgIds.length === 0) {
        throw new Error("Client organization is not in the readable scope");
      }
      const files = await ctx.runQuery(
        internal.clientFiles.listVisibleInternal,
        {
          orgIds,
          query: typeof args.query === "string" ? args.query : undefined,
          limit: typeof args.limit === "number" ? args.limit : undefined,
        },
      );
      return mcpTextResult(files);
    }
    case "get_client_file": {
      if (typeof args.client_file_id !== "string") {
        throw new Error("Missing client_file_id parameter");
      }
      const scope = await ctx.runQuery(
        internal.lib.agentScope.resolveForAction,
        {
          orgId,
          userId,
          surface: "mcp",
        },
      );
      const file = await ctx.runQuery(internal.clientFiles.getVisibleInternal, {
        clientFileId: args.client_file_id as Id<"clientFiles">,
        orgIds: scope.readOrgIds,
      });
      if (!file) throw new Error("Client file not found");
      return mcpTextResult(file);
    }
    case "read_company_wiki": {
      const wiki = await ctx.runQuery(internal.orgWiki.getForMcp, {
        orgId,
        userId,
      });
      return mcpTextResult(wiki);
    }
    case "write_company_wiki_section": {
      if (typeof args.section !== "string" || typeof args.body !== "string") {
        throw new Error("section and body are required");
      }
      if (!isOrgWikiSectionKey(args.section)) {
        throw new Error("Unknown company wiki section");
      }
      const wiki = await ctx.runMutation(internal.orgWiki.upsertSectionForMcp, {
        orgId,
        userId,
        key: args.section,
        body: args.body,
      });
      return mcpTextResult(wiki);
    }
    case "list_policies": {
      const policies = (await ctx.runQuery(
        internal.policies.listAllPreviewReadableInternal,
        { orgId },
      )) as McpPolicySummarySource[];
      const filtered = policies.filter((policy) =>
        policyMatchesMcpFilters(policy, {
          carrier: typeof args.carrier === "string" ? args.carrier : null,
          year: typeof args.year === "string" ? args.year : null,
          type: typeof args.type === "string" ? args.type : null,
        }),
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(filtered.map(toMcpPolicySummaryDto), null, 2),
          },
        ],
      };
    }
    case "get_policy": {
      if (!args.id) throw new Error("Missing id parameter");
      const policies = await ctx.runQuery(
        internal.policies.listAllPreviewReadableInternal,
        { orgId },
      );
      const found = policies.find((p: any) => p._id === args.id);
      if (!found) throw new Error("Not found");

      return {
        content: [{ type: "text", text: JSON.stringify(found, null, 2) }],
      };
    }
    case "get_policy_pdf": {
      if (!args.id) throw new Error("Missing id parameter");
      const policies = await ctx.runQuery(
        internal.policies.listAllPreviewReadableInternal,
        { orgId },
      );
      const found = policies.find((p: any) => p._id === args.id);
      if (!found) throw new Error("Not found");
      if (!policyFileIsAvailable(found as Record<string, unknown>)) {
        throw new Error(
          policyFileUnavailableMessage(found as Record<string, unknown>),
        );
      }
      if (!found.fileId)
        throw new Error("Original policy PDF is not available");
      const url = await ctx.storage.getUrl(found.fileId as Id<"_storage">);
      if (!url) throw new Error("Original policy PDF is not available");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(toPolicyFileDto(found, url), null, 2),
          },
        ],
      };
    }
    case "search_policies": {
      if (!args.q) throw new Error("Missing q parameter");
      const policies = (await ctx.runQuery(
        internal.policies.listAllPreviewReadableInternal,
        { orgId },
      )) as McpPolicySummarySource[];
      const results = policies.filter((policy) =>
        policyMatchesSearch(policy, args.q as string),
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              results.map(toMcpPolicySearchResultDto),
              null,
              2,
            ),
          },
        ],
      };
    }
    case "get_policy_stats": {
      const policies = (await ctx.runQuery(
        internal.policies.listAllPreviewReadableInternal,
        { orgId },
      )) as McpPolicySummarySource[];
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(toPolicyStatsDto(policies), null, 2),
          },
        ],
      };
    }
    case "list_policy_certificates": {
      const policyId = args.policyId ?? args.policy_id;
      if (typeof policyId !== "string" || !policyId)
        throw new Error("Missing policyId parameter");
      const certificates = await ctx.runQuery(
        internal.certificates.listByPolicyInternal,
        {
          orgId,
          policyId: policyId as Id<"policies">,
        },
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(certificates.map(toCertificateDto), null, 2),
          },
        ],
      };
    }
    case "list_certificate_holders": {
      const holders = await ctx.runQuery(
        internal.certificateHolders.listForOrgInternal,
        {
          orgId,
          query:
            typeof args.query === "string"
              ? args.query
              : typeof args.q === "string"
                ? args.q
                : undefined,
        },
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(holders.map(toCertificateHolderDto), null, 2),
          },
        ],
      };
    }
    case "list_policy_versions": {
      const policyId = args.policyId ?? args.policy_id;
      const versions = await ctx.runQuery(
        internal.policyVersions.listForOrgInternal,
        {
          orgId,
          policyId:
            typeof policyId === "string" && policyId
              ? (policyId as Id<"policies">)
              : undefined,
        },
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(versions.map(toPolicyVersionDto), null, 2),
          },
        ],
      };
    }
    case "list_certificate_versions": {
      const policyId = args.policyId ?? args.policy_id;
      const certificateId = args.certificateId ?? args.certificate_id;
      const holderId =
        args.holderId ??
        args.holder_id ??
        args.certificateHolderId ??
        args.certificate_holder_id;
      const versions = await ctx.runQuery(
        internal.certificateLifecycle.listVersionsInternal,
        {
          orgId,
          policyId:
            typeof policyId === "string" && policyId
              ? (policyId as Id<"policies">)
              : undefined,
          certificateId:
            typeof certificateId === "string" && certificateId
              ? (certificateId as Id<"policyCertificates">)
              : undefined,
          holderId:
            typeof holderId === "string" && holderId
              ? (holderId as Id<"certificateHolders">)
              : undefined,
        },
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              versions.map(toCertificateVersionDto),
              null,
              2,
            ),
          },
        ],
      };
    }
    case "list_certificate_review_jobs": {
      const policyId = args.policyId ?? args.policy_id;
      const jobs = await ctx.runQuery(
        internal.certificateWorkflowJobs.listForOrgInternal,
        {
          orgId,
          policyId:
            typeof policyId === "string" && policyId
              ? (policyId as Id<"policies">)
              : undefined,
          status: certificateWorkflowJobStatusParam(
            typeof args.status === "string" ? args.status : null,
          ),
        },
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              jobs.map(toCertificateWorkflowJobDto),
              null,
              2,
            ),
          },
        ],
      };
    }
    case "generate_policy_certificate": {
      requireMcpWriteScope(identity);
      const policyId = args.policyId ?? args.policy_id;
      const certificate = normalizeCertificateRequest(args);
      const requirementsMode = Boolean(
        certificate.requirementSourceDocumentId || certificate.requirementId,
      );
      if (Boolean(policyId) === requirementsMode)
        throw new Error("Choose either policyId or a requirement source");
      if (!requirementsMode && !certificate.holderName)
        throw new Error("Missing certificate holder");
      const result = await ctx.runAction(
        internal.certificates.generateBatchForOrg,
        {
          orgId,
          primaryPolicyId: policyId as Id<"policies"> | undefined,
          ...certificate,
          source: "mcp",
          createdByUserId: userId,
        },
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              compatibleCertificateGenerationResponse(result, requirementsMode),
              null,
              2,
            ),
          },
        ],
      };
    }
    case "list_threads": {
      const threads = await ctx.runQuery(internal.threads.listByOrg, {
        orgId,
        userId,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(threads.map(toMcpThreadSummaryDto), null, 2),
          },
        ],
      };
    }
    case "get_thread_messages": {
      if (!args.threadId) throw new Error("Missing threadId parameter");
      const thread = await ctx.runQuery(internal.threads.getInternal, {
        id: args.threadId as Id<"threads">,
      });
      if (
        !thread ||
        !canAccessThread({
          userId,
          userOrgId: orgId,
          thread,
          clientOrg: null,
        })
      )
        throw new Error("Not found");
      const messages = await ctx.runQuery(internal.threads.messagesInternal, {
        threadId: args.threadId as Id<"threads">,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(messages.map(toMcpThreadMessageDto), null, 2),
          },
        ],
      };
    }
    case "get_org_info": {
      const org = await ctx.runQuery(internal.orgs.getInternal, { id: orgId });
      if (!org) throw new Error("Not found");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                _id: org._id,
                name: org.name,
                website: org.website,
                industry: org.industry,
                industryVertical: org.industryVertical,
                context: org.context,
              },
              null,
              2,
            ),
          },
        ],
      };
    }
    case "ask_glass":
    case "ask_spot": {
      if (!args.message) throw new Error("Missing message");
      const result = await ctx.runAction(internal.actions.mcpChat.run, {
        orgId,
        userId,
        message: args.message as string,
        threadId:
          typeof args.threadId === "string"
            ? (args.threadId as Id<"threads">)
            : undefined,
        canWrite: mcpCanWrite(identity),
      });
      return {
        content: [
          {
            type: "text",
            text: `**Thread:** ${result.threadId}\n\n${result.response}`,
          },
        ],
      };
    }
    case "list_email_drafts": {
      const drafts = await ctx.runQuery(
        internal.pendingEmails.listDraftsInternal,
        {
          orgId,
          threadId:
            typeof args.threadId === "string" && args.threadId
              ? (args.threadId as Id<"threads">)
              : undefined,
        },
      );
      const showAll = args.showAll === true;
      const summary =
        drafts.length > 0
          ? buildEmailDraftTextSummary(drafts, {
              sampleSize: showAll ? drafts.length : 3,
              includeIds: true,
              commands: "mcp",
            })
          : "No email drafts found.";
      return { content: [{ type: "text", text: summary }] };
    }
    case "draft_email":
    case "update_email_draft": {
      requireMcpWriteScope(identity);
      if (name === "update_email_draft" && !args.draftId)
        throw new Error("Missing draftId parameter");
      if (!args.to || !args.subject || !args.body)
        throw new Error("Missing to, subject, or body parameter");
      const draft = await ctx.runAction(
        internal.actions.emailDrafts.upsertForMcp,
        {
          orgId,
          userId,
          draftId:
            typeof args.draftId === "string"
              ? (args.draftId as Id<"pendingEmails">)
              : undefined,
          threadId:
            typeof args.threadId === "string"
              ? (args.threadId as Id<"threads">)
              : undefined,
          to: args.to as string,
          subject: args.subject as string,
          body: args.body as string,
          cc: Array.isArray(args.cc)
            ? args.cc.filter(
                (value): value is string => typeof value === "string",
              )
            : undefined,
          bcc: Array.isArray(args.bcc)
            ? args.bcc.filter(
                (value): value is string => typeof value === "string",
              )
            : undefined,
          originalPolicyIds: Array.isArray(args.originalPolicyIds)
            ? (args.originalPolicyIds.filter(
                (value): value is Id<"policies"> => typeof value === "string",
              ) as Id<"policies">[])
            : undefined,
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(draft, null, 2) }],
      };
    }
    case "send_email_draft": {
      requireMcpWriteScope(identity);
      if (typeof args.draftId !== "string" || !args.draftId)
        throw new Error("Missing draftId parameter");
      const draft = await ctx.runAction(
        internal.actions.emailDrafts.sendForMcp,
        {
          orgId,
          draftId: args.draftId as Id<"pendingEmails">,
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(draft, null, 2) }],
      };
    }
    case "send_email_drafts": {
      requireMcpWriteScope(identity);
      const draftIds = Array.isArray(args.draftIds)
        ? (args.draftIds.filter(
            (value): value is Id<"pendingEmails"> => typeof value === "string",
          ) as Id<"pendingEmails">[])
        : [];
      if (draftIds.length === 0) throw new Error("Missing draftIds parameter");
      const result = await ctx.runAction(
        internal.actions.emailDrafts.sendManyForMcp,
        {
          orgId,
          draftIds,
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
    case "cancel_email_draft": {
      requireMcpWriteScope(identity);
      if (typeof args.draftId !== "string" || !args.draftId)
        throw new Error("Missing draftId parameter");
      const draft = await ctx.runAction(
        internal.actions.emailDrafts.cancelForMcp,
        {
          orgId,
          draftId: args.draftId as Id<"pendingEmails">,
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(draft, null, 2) }],
      };
    }
    case "list_connected_vendors": {
      const vendors = await ctx.runQuery(
        (internal as any).connectedOrgs.listActiveVendorsInternal,
        { clientOrgId: orgId },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(vendors, null, 2) }],
      };
    }
    case "get_connected_vendor": {
      const vendorOrgId = args.vendor_org_id as Id<"organizations">;
      if (!vendorOrgId) throw new Error("Missing vendor_org_id");
      const allowed = await ctx.runQuery(
        (internal as any).connectedOrgs.hasActiveConnectionInternal,
        {
          clientOrgId: orgId,
          vendorOrgId,
        },
      );
      if (!allowed) throw new Error("Connected vendor not found");
      const org = await ctx.runQuery(internal.orgs.getInternal, {
        id: vendorOrgId,
      });
      const policies = await ctx.runQuery(
        internal.policies.listAllPreviewReadableInternal,
        { orgId: vendorOrgId },
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { org, policy_count: policies.length },
              null,
              2,
            ),
          },
        ],
      };
    }
    case "list_connected_vendor_policies": {
      const vendorOrgId = args.vendor_org_id as Id<"organizations">;
      if (!vendorOrgId) throw new Error("Missing vendor_org_id");
      const allowed = await ctx.runQuery(
        (internal as any).connectedOrgs.hasActiveConnectionInternal,
        {
          clientOrgId: orgId,
          vendorOrgId,
        },
      );
      if (!allowed) throw new Error("Connected vendor not found");
      const policies = (await ctx.runQuery(
        internal.policies.listAllPreviewReadableInternal,
        { orgId: vendorOrgId },
      )) as McpPolicySummarySource[];
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              policies.map(toMcpConnectedVendorPolicyDto),
              null,
              2,
            ),
          },
        ],
      };
    }
    case "list_my_policies": {
      const policies = (await ctx.runQuery(
        internal.policies.listAllPreviewReadableInternal,
        { orgId },
      )) as McpPolicySummarySource[];
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(policies.map(toMcpMyPolicyDto), null, 2),
          },
        ],
      };
    }
    case "list_insurance_requirements": {
      const requirements = await ctx.runQuery(
        (internal as any).compliance.listRequirementsInternal,
        { orgId },
      );
      return {
        content: [
          { type: "text", text: JSON.stringify(requirements, null, 2) },
        ],
      };
    }
    case "create_insurance_requirement": {
      requireMcpWriteScope(identity);
      if (!args.kind || !args.scope || !args.title || !args.requirement_text)
        throw new Error("Missing kind, scope, title, or requirement_text");
      const requirementId = await ctx.runMutation(
        (internal as any).compliance.upsertRequirementInternal,
        {
          orgId,
          userId,
          kind: String(args.kind),
          scope: String(args.scope),
          title: String(args.title),
          requirementText: String(args.requirement_text),
          lineOfBusiness: args.line_of_business
            ? String(args.line_of_business)
            : undefined,
          limits: Array.isArray(args.limits) ? args.limits : undefined,
          sourceDocumentName: args.source_document_name
            ? String(args.source_document_name)
            : undefined,
          sourceType:
            args.source_document_name || args.source_excerpt
              ? "other"
              : "manual",
          sourceExcerpt: args.source_excerpt
            ? String(args.source_excerpt)
            : undefined,
        },
      );
      return {
        content: [
          { type: "text", text: JSON.stringify({ requirementId }, null, 2) },
        ],
      };
    }
    case "list_vendor_compliance": {
      const compliance = await ctx.runQuery(
        (internal as any).compliance.listVendorComplianceInternal,
        { clientOrgId: orgId },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(compliance, null, 2) }],
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

http.route({
  path: "/mcp",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request, {
        allowOperator: true,
      });
      const body = await request.json();

      // Handle JSON-RPC 2.0
      const { jsonrpc, id, method, params } = body;
      if (jsonrpc !== "2.0") {
        return jsonRpcError(
          id ?? null,
          -32600,
          "Invalid Request: must be JSON-RPC 2.0",
        );
      }

      // Notifications (no id) return 202
      if (id === undefined || id === null) {
        if (
          method === "notifications/initialized" ||
          method === "notifications/cancelled"
        ) {
          return new Response(null, { status: 202 });
        }
        // Unknown notification
        return new Response(null, { status: 202 });
      }

      switch (method) {
        case "initialize": {
          const siteUrl = getClientPortalUrl();
          return jsonRpcResponse(id, {
            protocolVersion: negotiateMcpProtocolVersion(
              params?.protocolVersion,
            ),
            capabilities: { tools: {} },
            serverInfo: {
              name: "Spot",
              version: "2.0.0",
              icons: [
                {
                  src: `${siteUrl}/spot-icon.svg`,
                  mimeType: "image/svg+xml",
                  sizes: ["any"],
                },
              ],
            },
            instructions:
              identity.principalKind === "operator"
                ? "This is Spot's authenticated internal operator agent. Use typed tools for exact reads and changes, or run_operator_task for durable multi-step work. Protected writes pause for exact confirmation and can be resumed from another internal channel."
                : "Spot is an insurance intelligence platform. Use Spot tools to look up bound policies, renewals, threads, and org info. Use ask_spot for complex insurance questions.",
          });
        }
        case "tools/list": {
          return jsonRpcResponse(id, {
            tools:
              identity.principalKind === "operator"
                ? operatorMcpTools(identity)
                : AUTHENTICATED_TENANT_MCP_TOOLS,
          });
        }
        case "tools/call": {
          const toolName = params?.name;
          const toolArgs = params?.arguments ?? {};
          if (!toolName) {
            return jsonRpcError(id, -32602, "Missing tool name");
          }
          try {
            if (identity.principalKind === "organization") {
              const access = tenantMcpToolAccess(toolName);
              if (!access) throw new Error(`Unknown tool: ${toolName}`);
              if (access.effect === "write") requireMcpWriteScope(identity);
            }
            const result = await handleToolCall(
              ctx,
              identity,
              toolName,
              toolArgs,
            );
            return jsonRpcResponse(id, result);
          } catch (toolErr: unknown) {
            const message =
              toolErr instanceof Error ? toolErr.message : String(toolErr);
            return jsonRpcResponse(id, {
              content: [
                {
                  type: "text",
                  text: `Error: ${message}`,
                },
              ],
              isError: true,
              ...(message.startsWith("insufficient_scope:")
                ? {
                    _meta: {
                      "mcp/www_authenticate": [
                        `Bearer error="insufficient_scope", scope="write", resource_metadata="${new URL(request.url).origin}/.well-known/oauth-protected-resource"`,
                      ],
                    },
                  }
                : {}),
            });
          }
        }
        default:
          return jsonRpcError(id, -32601, `Method not found: ${method}`);
      }
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonRpcError(null, -32603, `Internal error: ${String(e)}`);
    }
  }),
});

// Streamable HTTP clients may probe GET /mcp for an optional server-to-client SSE stream.
// Spot is stateless and responds to MCP requests directly over POST.
http.route({
  path: "/mcp",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 405,
      headers: {
        Allow: "POST, DELETE",
      },
    });
  }),
});

// Allow DELETE /mcp for session termination (return 200 OK)
http.route({
  path: "/mcp",
  method: "DELETE",
  handler: httpAction(async () => {
    return new Response(null, { status: 200 });
  }),
});

// POST /mcp/ask
http.route({
  path: "/mcp/ask",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request, {
        allowOperator: true,
      });
      const body = await request.json();
      const { message, threadId, attachments: attachmentInputs } = body;

      if (identity.principalKind === "operator") {
        requireMcpWriteScope(identity);
        const operatorUserId = identity.userId as Id<"users">;
        const attachments = await storeOperatorMcpAttachments(
          ctx,
          attachmentInputs,
        );
        const operatorMessage =
          typeof message === "string" ? message.trim() : "";
        if (!operatorMessage && attachments.length === 0) {
          return jsonResponse({ error: "Missing message or attachments" }, 400);
        }
        try {
          const operatorThreadId = threadId
            ? (threadId as Id<"operatorAgentThreads">)
            : await ctx.runMutation(
                (internal as any).operatorAgent
                  .createOrGetChannelThreadInternal,
                {
                  operatorUserId,
                  channel: "mcp",
                  conversationKey: `mcp:${identity.tokenId ?? identity.userId}`,
                  title: "External operator agent",
                },
              );
          const queued = await ctx.runMutation(
            (internal as any).operatorAgent.enqueueMessageInternal,
            {
              operatorUserId,
              threadId: operatorThreadId,
              channel: "mcp",
              content: operatorMessage || "(attached files)",
              dedupeKey: `mcp-ask:${crypto.randomUUID()}`,
              attachments: attachments.length ? attachments : undefined,
            },
          );
          return jsonResponse({ threadId: operatorThreadId, ...queued }, 202);
        } catch (error) {
          await deleteOperatorMcpAttachments(ctx, attachments);
          throw error;
        }
      }

      if (!message) return jsonResponse({ error: "Missing message" }, 400);

      const result = await ctx.runAction(internal.actions.mcpChat.run, {
        orgId: identity.orgId as Id<"organizations">,
        userId: identity.userId as Id<"users">,
        message,
        threadId: threadId ?? undefined,
        canWrite: mcpCanWrite(identity),
      });

      return jsonResponse(result);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// GET /mcp/email/drafts/list
http.route({
  path: "/mcp/email/drafts/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      const url = new URL(request.url);
      const threadId = url.searchParams.get("threadId");
      const showAll = url.searchParams.get("showAll") === "true";
      const drafts = await ctx.runQuery(
        internal.pendingEmails.listDraftsInternal,
        {
          orgId: identity.orgId as Id<"organizations">,
          threadId: threadId ? (threadId as Id<"threads">) : undefined,
        },
      );
      return jsonResponse({
        summary:
          drafts.length > 0
            ? buildEmailDraftTextSummary(drafts, {
                sampleSize: showAll ? drafts.length : 3,
                includeIds: true,
                commands: "mcp",
              })
            : "No email drafts found.",
        drafts,
      });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// POST /mcp/email/drafts/upsert
http.route({
  path: "/mcp/email/drafts/upsert",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      requireMcpWriteScope(identity);
      const body = await request.json();
      if (!body.to || !body.subject || !body.body) {
        return jsonResponse({ error: "Missing to, subject, or body" }, 400);
      }
      const draft = await ctx.runAction(
        internal.actions.emailDrafts.upsertForMcp,
        {
          orgId: identity.orgId as Id<"organizations">,
          userId: identity.userId as Id<"users">,
          draftId: body.draftId
            ? (body.draftId as Id<"pendingEmails">)
            : undefined,
          threadId: body.threadId
            ? (body.threadId as Id<"threads">)
            : undefined,
          to: body.to,
          subject: body.subject,
          body: body.body,
          cc: Array.isArray(body.cc) ? body.cc : undefined,
          bcc: Array.isArray(body.bcc) ? body.bcc : undefined,
          originalPolicyIds: Array.isArray(body.originalPolicyIds)
            ? body.originalPolicyIds
            : undefined,
        },
      );
      return jsonResponse(draft);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// POST /mcp/email/drafts/send
http.route({
  path: "/mcp/email/drafts/send",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      requireMcpWriteScope(identity);
      const body = await request.json();
      if (!body.draftId) return jsonResponse({ error: "Missing draftId" }, 400);
      const draft = await ctx.runAction(
        internal.actions.emailDrafts.sendForMcp,
        {
          orgId: identity.orgId as Id<"organizations">,
          draftId: body.draftId as Id<"pendingEmails">,
        },
      );
      return jsonResponse(draft);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// POST /mcp/email/drafts/send-batch
http.route({
  path: "/mcp/email/drafts/send-batch",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      requireMcpWriteScope(identity);
      const body = await request.json();
      const draftIds = Array.isArray(body.draftIds)
        ? body.draftIds.filter(
            (value: unknown): value is Id<"pendingEmails"> =>
              typeof value === "string",
          )
        : [];
      if (draftIds.length === 0)
        return jsonResponse({ error: "Missing draftIds" }, 400);
      const result = await ctx.runAction(
        internal.actions.emailDrafts.sendManyForMcp,
        {
          orgId: identity.orgId as Id<"organizations">,
          draftIds,
        },
      );
      return jsonResponse(result);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// POST /mcp/email/drafts/cancel
http.route({
  path: "/mcp/email/drafts/cancel",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireMcpAuth(ctx, request);
      requireMcpWriteScope(identity);
      const body = await request.json();
      if (!body.draftId) return jsonResponse({ error: "Missing draftId" }, 400);
      const draft = await ctx.runAction(
        internal.actions.emailDrafts.cancelForMcp,
        {
          orgId: identity.orgId as Id<"organizations">,
          draftId: body.draftId as Id<"pendingEmails">,
        },
      );
      return jsonResponse(draft);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: String(e) }, 500);
    }
  }),
});

// ── REST API v1 helpers ──

function extractBearerToken(request: Request): string {
  const auth = request.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return "";
  return auth.slice(7);
}

async function requireApiAuth(
  ctx: {
    runQuery: (...args: any[]) => Promise<any>;
    runMutation: (...args: any[]) => Promise<any>;
  },
  request: Request,
): Promise<{
  userId: Id<"users">;
  orgId: Id<"organizations">;
  scopes: ("read" | "write")[];
  tokenId: Id<"oauthTokens">;
  requestId: string;
}> {
  const requestId = crypto.randomUUID();
  const rawToken = extractBearerToken(request);
  if (!rawToken) {
    throw jsonResponse(
      {
        error: {
          code: "unauthorized",
          message: "Missing bearer token",
          request_id: requestId,
        },
      },
      401,
    );
  }
  const orgIdHeader =
    request.headers.get("x-org-id") ?? request.headers.get("X-Org-Id") ?? "";

  async function assertMembership(
    userId: Id<"users">,
    orgId: Id<"organizations">,
  ) {
    const hasMembership = await ctx.runQuery(
      (internal as any).orgs.hasMembershipInternal,
      {
        orgId,
        userId,
      },
    );
    if (!hasMembership) {
      throw jsonResponse(
        {
          error: {
            code: "forbidden",
            message: "User does not have access to the requested org",
            request_id: requestId,
          },
        },
        403,
      );
    }
  }

  const tokenHash = await sha256Hex(rawToken);
  const tokenData = await ctx.runQuery(
    (internal as any).oauth.validateAccessTokenWithScopes,
    { tokenHash },
  );
  if (!tokenData) {
    throw jsonResponse(
      {
        error: {
          code: "unauthorized",
          message: "Invalid or expired token",
          request_id: requestId,
        },
      },
      401,
    );
  }

  if (tokenData.principalKind === "operator" || !tokenData.orgId) {
    throw jsonResponse(
      {
        error: {
          code: "forbidden",
          message:
            "Operator access tokens are only valid for the MCP protocol endpoint",
          request_id: requestId,
        },
      },
      403,
    );
  }
  if (tokenData.resource) {
    throw jsonResponse(
      {
        error: {
          code: "forbidden",
          message:
            "Resource-bound access tokens are only valid for their MCP endpoint",
          request_id: requestId,
        },
      },
      403,
    );
  }

  const orgId = (orgIdHeader || tokenData.orgId) as Id<"organizations">;
  await assertMembership(tokenData.userId as Id<"users">, orgId);

  return {
    userId: tokenData.userId as Id<"users">,
    orgId,
    scopes: tokenData.scopes ?? ["read"],
    tokenId: tokenData.tokenId as Id<"oauthTokens">,
    requestId,
  };
}

// ── Task 7: GET /api/v1/me ──
http.route({
  path: "/api/v1/me",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const user = await ctx.runQuery(internal.users.getInternal, {
        id: identity.userId,
      });
      const orgs = await ctx
        .runQuery((internal as any).orgs.getOrgsByUserId, {
          userId: identity.userId,
        })
        .catch(() => null);
      return jsonResponse({
        user: { id: identity.userId, name: user?.name, email: user?.email },
        accessible_orgs: Array.isArray(orgs) ? orgs.map(toOrgDto) : [],
      });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse(
        { error: { code: "internal_error", message: String(e) } },
        500,
      );
    }
  }),
});

// ── GET /api/v1/org ──
http.route({
  path: "/api/v1/org",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const org = await ctx.runQuery(internal.orgs.getInternal, {
        id: identity.orgId,
      });
      if (!org)
        return jsonResponse(
          { error: { code: "not_found", message: "Org not found" } },
          404,
        );
      return jsonResponse(toOrgDto(org));
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse(
        { error: { code: "internal_error", message: String(e) } },
        500,
      );
    }
  }),
});

// ── GET /api/v1/policies ──
http.route({
  path: "/api/v1/policies",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const policies = await ctx.runQuery(internal.policies.listAllInternal, {
        orgId: identity.orgId,
      });
      return jsonResponse({
        data: policies.map(toPolicyDto),
      });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse(
        { error: { code: "internal_error", message: String(e) } },
        500,
      );
    }
  }),
});

async function handlePolicyRestGet(ctx: ActionCtx, request: Request) {
  try {
    const identity = await requireApiAuth(ctx, request);
    const parts = new URL(request.url).pathname.split("/").filter(Boolean);
    const policyId = parts[3] as Id<"policies"> | undefined;
    const child = parts[4];
    if (
      !policyId ||
      parts[0] !== "api" ||
      parts[1] !== "v1" ||
      parts[2] !== "policies" ||
      parts.length > 5
    ) {
      return jsonResponse(
        { error: { code: "not_found", message: "Policy route not found" } },
        404,
      );
    }

    if (!child) {
      const policies = await ctx.runQuery(internal.policies.listAllInternal, {
        orgId: identity.orgId,
      });
      const policy = policies.find((p: any) => p._id === policyId);
      if (!policy)
        return jsonResponse(
          { error: { code: "not_found", message: "Policy not found" } },
          404,
        );
      return jsonResponse(toPolicyDto(policy));
    }

    if (child === "file") {
      const policies = await ctx.runQuery(internal.policies.listAllInternal, {
        orgId: identity.orgId,
      });
      const policy = policies.find((p: any) => p._id === policyId);
      if (!policy)
        return jsonResponse(
          { error: { code: "not_found", message: "Policy not found" } },
          404,
        );
      if (!policy.fileId)
        return jsonResponse(
          {
            error: {
              code: "not_found",
              message: "Original policy PDF is not available",
            },
          },
          404,
        );
      const url = await ctx.storage.getUrl(policy.fileId as Id<"_storage">);
      if (!url)
        return jsonResponse(
          {
            error: {
              code: "not_found",
              message: "Original policy PDF is not available",
            },
          },
          404,
        );
      return jsonResponse({ data: toPolicyFileDto(policy, url) });
    }

    if (child === "certificates") {
      const certificates = await ctx.runQuery(
        internal.certificates.listByPolicyInternal,
        {
          orgId: identity.orgId,
          policyId,
        },
      );
      return jsonResponse({
        data: certificates.map(toCertificateDto),
        next_cursor: null,
      });
    }

    if (child === "versions") {
      const versions = await ctx.runQuery(
        internal.policyVersions.listForOrgInternal,
        {
          orgId: identity.orgId,
          policyId,
        },
      );
      return jsonResponse({
        data: versions.map(toPolicyVersionDto),
        next_cursor: null,
      });
    }

    if (child === "certificate-versions") {
      const versions = await ctx.runQuery(
        internal.certificateLifecycle.listVersionsInternal,
        {
          orgId: identity.orgId,
          policyId,
        },
      );
      return jsonResponse({
        data: versions.map(toCertificateVersionDto),
        next_cursor: null,
      });
    }

    return jsonResponse(
      { error: { code: "not_found", message: "Policy route not found" } },
      404,
    );
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonResponse(
      { error: { code: "internal_error", message: String(e) } },
      500,
    );
  }
}

async function handlePolicyRestPost(ctx: ActionCtx, request: Request) {
  try {
    const identity = await requireApiAuth(ctx, request);
    if (!identity.scopes.includes("write")) {
      return jsonResponse(
        {
          error: {
            code: "insufficient_scope",
            message: "Write scope required",
            request_id: identity.requestId,
          },
        },
        403,
      );
    }

    const parts = new URL(request.url).pathname.split("/").filter(Boolean);
    const policyId = parts[3] as Id<"policies"> | undefined;
    const child = parts[4];
    if (
      !policyId ||
      parts[0] !== "api" ||
      parts[1] !== "v1" ||
      parts[2] !== "policies" ||
      child !== "certificates" ||
      parts.length !== 5
    ) {
      return jsonResponse(
        { error: { code: "not_found", message: "Policy route not found" } },
        404,
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const certificate = normalizeCertificateRequest(body);
    if (certificate.requirementSourceDocumentId || certificate.requirementId) {
      return jsonResponse(
        {
          error: {
            code: "bad_request",
            message:
              "Use POST /api/v1/certificates/generate for requirement-source generation",
          },
        },
        400,
      );
    }
    if (!certificate.holderName) {
      return jsonResponse(
        {
          error: {
            code: "bad_request",
            message: "Missing certificate_holder_name",
          },
        },
        400,
      );
    }

    const result = await ctx.runAction(
      internal.certificates.generateBatchForOrg,
      {
        orgId: identity.orgId,
        primaryPolicyId: policyId,
        ...certificate,
        source: "api",
        createdByUserId: identity.userId,
      },
    );
    return jsonResponse(
      {
        data: compatibleCertificateGenerationResponse(
          result,
          Boolean(
            certificate.requirementSourceDocumentId ||
            certificate.requirementId,
          ),
        ),
      },
      201,
    );
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonResponse(
      { error: { code: "internal_error", message: String(e) } },
      500,
    );
  }
}

http.route({
  pathPrefix: "/api/v1/policies/",
  method: "GET",
  handler: httpAction(handlePolicyRestGet),
});

http.route({
  pathPrefix: "/api/v1/policies/",
  method: "POST",
  handler: httpAction(handlePolicyRestPost),
});

http.route({
  path: "/api/v1/certificates/generate",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      if (!identity.scopes.includes("write")) {
        return jsonResponse(
          {
            error: {
              code: "insufficient_scope",
              message: "Write scope required",
              request_id: identity.requestId,
            },
          },
          403,
        );
      }
      const body = (await request.json()) as Record<string, unknown>;
      const policyId = body.policyId ?? body.policy_id;
      const certificate = normalizeCertificateRequest(body);
      const requirementsMode = Boolean(
        certificate.requirementSourceDocumentId || certificate.requirementId,
      );
      if (Boolean(policyId) === requirementsMode) {
        return jsonResponse(
          {
            error: {
              code: "bad_request",
              message: "Choose either policy_id or a requirement source",
            },
          },
          400,
        );
      }
      if (!requirementsMode && !certificate.holderName) {
        return jsonResponse(
          {
            error: {
              code: "bad_request",
              message: "Missing certificate_holder_name",
            },
          },
          400,
        );
      }
      const result = await ctx.runAction(
        internal.certificates.generateBatchForOrg,
        {
          orgId: identity.orgId,
          primaryPolicyId: policyId as Id<"policies"> | undefined,
          ...certificate,
          source: "api",
          createdByUserId: identity.userId,
        },
      );
      return jsonResponse(
        {
          data: compatibleCertificateGenerationResponse(
            result,
            requirementsMode,
          ),
        },
        201,
      );
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse(
        { error: { code: "internal_error", message: String(e) } },
        500,
      );
    }
  }),
});

// ── GET /api/v1/certificate-holders ──
http.route({
  path: "/api/v1/certificate-holders",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const holders = await ctx.runQuery(
        internal.certificateHolders.listForOrgInternal,
        {
          orgId: identity.orgId,
          query:
            getQueryParam(request, "q") ??
            getQueryParam(request, "query") ??
            undefined,
        },
      );
      return jsonResponse({
        data: holders.map(toCertificateHolderDto),
        next_cursor: null,
      });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse(
        { error: { code: "internal_error", message: String(e) } },
        500,
      );
    }
  }),
});

// ── GET /api/v1/certificate-review-jobs ──
http.route({
  path: "/api/v1/certificate-review-jobs",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const jobs = await ctx.runQuery(
        internal.certificateWorkflowJobs.listForOrgInternal,
        {
          orgId: identity.orgId,
          policyId: (getQueryParam(request, "policy_id") ??
            getQueryParam(request, "policyId") ??
            undefined) as Id<"policies"> | undefined,
          status: certificateWorkflowJobStatusParam(
            getQueryParam(request, "status"),
          ),
        },
      );
      return jsonResponse({
        data: jobs.map(toCertificateWorkflowJobDto),
        next_cursor: null,
      });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse(
        { error: { code: "internal_error", message: String(e) } },
        500,
      );
    }
  }),
});

// ── GET /api/v1/vendors ──
http.route({
  path: "/api/v1/vendors",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const vendors = await ctx.runQuery(
        (internal as any).connectedOrgs.listActiveVendorsInternal,
        {
          clientOrgId: identity.orgId,
        },
      );
      return jsonResponse({ data: vendors, next_cursor: null });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse(
        { error: { code: "internal_error", message: String(e) } },
        500,
      );
    }
  }),
});

// ── GET /api/v1/vendors/:id ──
http.route({
  path: "/api/v1/vendors/:id",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const vendorOrgId = new URL(request.url).pathname
        .split("/")
        .pop() as Id<"organizations">;
      const allowed = await ctx.runQuery(
        (internal as any).connectedOrgs.hasActiveConnectionInternal,
        {
          clientOrgId: identity.orgId,
          vendorOrgId,
        },
      );
      if (!allowed)
        return jsonResponse(
          { error: { code: "not_found", message: "Vendor not found" } },
          404,
        );
      const [org, policies] = await Promise.all([
        ctx.runQuery(internal.orgs.getInternal, { id: vendorOrgId }),
        ctx.runQuery(internal.policies.listAllInternal, { orgId: vendorOrgId }),
      ]);
      return jsonResponse({ org, policy_count: policies.length });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse(
        { error: { code: "internal_error", message: String(e) } },
        500,
      );
    }
  }),
});

// ── GET /api/v1/vendors/:id/policies ──
http.route({
  path: "/api/v1/vendors/:id/policies",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const parts = new URL(request.url).pathname.split("/");
      const vendorOrgId = parts[parts.length - 2] as Id<"organizations">;
      const allowed = await ctx.runQuery(
        (internal as any).connectedOrgs.hasActiveConnectionInternal,
        {
          clientOrgId: identity.orgId,
          vendorOrgId,
        },
      );
      if (!allowed)
        return jsonResponse(
          { error: { code: "not_found", message: "Vendor not found" } },
          404,
        );
      const policies = await ctx.runQuery(internal.policies.listAllInternal, {
        orgId: vendorOrgId,
      });
      return jsonResponse({
        data: policies.map(toPolicyDto),
        next_cursor: null,
      });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse(
        { error: { code: "internal_error", message: String(e) } },
        500,
      );
    }
  }),
});

// ── GET /api/v1/compliance/requirements ──
http.route({
  path: "/api/v1/compliance/requirements",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const requirements = await ctx.runQuery(
        (internal as any).compliance.listRequirementsInternal,
        { orgId: identity.orgId },
      );
      return jsonResponse({ data: requirements, next_cursor: null });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse(
        { error: { code: "internal_error", message: String(e) } },
        500,
      );
    }
  }),
});

// ── POST /api/v1/compliance/requirements ──
http.route({
  path: "/api/v1/compliance/requirements",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      if (!identity.scopes.includes("write")) {
        return jsonResponse(
          {
            error: {
              code: "insufficient_scope",
              message: "Write scope required",
              request_id: identity.requestId,
            },
          },
          403,
        );
      }
      const body = await request.json();
      const requirementId = await ctx.runMutation(
        (internal as any).compliance.upsertRequirementInternal,
        {
          orgId: identity.orgId,
          userId: identity.userId,
          kind: String(body.kind ?? ""),
          scope: String(body.scope ?? "vendors"),
          title: String(body.title ?? ""),
          requirementText: String(
            body.requirement_text ?? body.requirementText ?? "",
          ),
          lineOfBusiness: body.line_of_business
            ? String(body.line_of_business)
            : body.lineOfBusiness
              ? String(body.lineOfBusiness)
              : undefined,
          limits: Array.isArray(body.limits) ? body.limits : undefined,
          maxDeductible: body.max_deductible ?? body.maxDeductible,
          provisions: Array.isArray(body.provisions)
            ? body.provisions
            : undefined,
          requiredForms: Array.isArray(body.required_forms)
            ? body.required_forms
            : Array.isArray(body.requiredForms)
              ? body.requiredForms
              : undefined,
          sourceDocumentName: body.source_document_name
            ? String(body.source_document_name)
            : body.sourceDocumentName
              ? String(body.sourceDocumentName)
              : undefined,
          sourceType:
            body.source_document_name ||
            body.sourceDocumentName ||
            body.source_excerpt ||
            body.sourceExcerpt
              ? "other"
              : "manual",
          sourceExcerpt: body.source_excerpt
            ? String(body.source_excerpt)
            : body.sourceExcerpt
              ? String(body.sourceExcerpt)
              : undefined,
        },
      );
      return jsonResponse({ id: requirementId }, 201);
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse(
        { error: { code: "internal_error", message: String(e) } },
        500,
      );
    }
  }),
});

// ── GET /api/v1/compliance/vendors ──
http.route({
  path: "/api/v1/compliance/vendors",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const rows = await ctx.runQuery(
        (internal as any).compliance.listVendorComplianceInternal,
        { clientOrgId: identity.orgId },
      );
      return jsonResponse({ data: rows, next_cursor: null });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse(
        { error: { code: "internal_error", message: String(e) } },
        500,
      );
    }
  }),
});

// ── GET /api/v1/notifications ──
http.route({
  path: "/api/v1/notifications",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const identity = await requireApiAuth(ctx, request);
      const notifs = await ctx
        .runQuery((internal as any).notifications.listInternal, {
          orgId: identity.orgId,
          userId: identity.userId,
        })
        .catch(() => []);
      return jsonResponse({
        data: (Array.isArray(notifs) ? notifs : []).map(toNotificationDto),
      });
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse(
        { error: { code: "internal_error", message: String(e) } },
        500,
      );
    }
  }),
});

// ── Task 13: GET /api/v1/openapi.json ──
http.route({
  path: "/api/v1/openapi.json",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const baseUrl = url.origin;
    return jsonResponse({
      openapi: "3.1.0",
      info: {
        title: "Spot API",
        version: "1.0.0",
        description: "Spot insurance intelligence platform REST API",
      },
      servers: [{ url: baseUrl, description: "Spot API" }],
      security: [{ bearerAuth: [] }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "OAuth2",
          },
        },
      },
      paths: {
        "/api/v1/me": {
          get: {
            tags: ["User"],
            summary: "Current user + accessible orgs",
            responses: { "200": { description: "User and org list" } },
          },
        },
        "/api/v1/org": {
          get: {
            tags: ["Org"],
            summary: "Current org detail",
            responses: { "200": { description: "Org detail" } },
          },
        },
        "/api/v1/policies": {
          get: {
            tags: ["Policies"],
            summary: "List policies",
            responses: { "200": { description: "Policies" } },
          },
        },
        "/api/v1/policies/{id}": {
          get: {
            tags: ["Policies"],
            summary: "Get policy",
            responses: { "200": { description: "Policy" } },
          },
        },
        "/api/v1/policies/{id}/certificates": {
          get: {
            tags: ["Certificates"],
            summary:
              "List generated Certificates of Insurance for a policy, including lifecycle IDs when available",
            responses: { "200": { description: "Certificates" } },
          },
          post: {
            tags: ["Certificates"],
            summary:
              "Generate or retrieve a Certificate of Insurance for a policy (write). Same holder/current policy version returns an existing certificate unless explicit_reissue=true.",
            responses: {
              "201": {
                description:
                  "Certificate generated, retrieved, or held for broker follow-up",
              },
            },
          },
        },
        "/api/v1/certificates/generate": {
          post: {
            tags: ["Certificates"],
            summary:
              "Generate certificates from either one policy with all coverages or one requirement source with requirement-specific coverages (write)",
            responses: {
              "201": {
                description:
                  "One policy certificate or a source-linked certificate batch",
              },
            },
          },
        },
        "/api/v1/certificate-holders": {
          get: {
            tags: ["Certificates"],
            summary: "List/search certificate holders",
            responses: { "200": { description: "Certificate holders" } },
          },
        },
        "/api/v1/policies/{id}/versions": {
          get: {
            tags: ["Policies"],
            summary: "List policy document-event versions",
            responses: { "200": { description: "Policy versions" } },
          },
        },
        "/api/v1/policies/{id}/certificate-versions": {
          get: {
            tags: ["Certificates"],
            summary: "List certificate issue/reissue versions for a policy",
            responses: { "200": { description: "Certificate versions" } },
          },
        },
        "/api/v1/certificate-review-jobs": {
          get: {
            tags: ["Certificates"],
            summary: "List certificate renewal/post-endorsement review jobs",
            responses: { "200": { description: "Certificate review jobs" } },
          },
        },
        "/api/v1/vendors": {
          get: {
            tags: ["Vendors"],
            summary: "List connected vendors",
            responses: { "200": { description: "Connected vendors" } },
          },
        },
        "/api/v1/vendors/{id}": {
          get: {
            tags: ["Vendors"],
            summary: "Get connected vendor detail",
            responses: { "200": { description: "Connected vendor" } },
          },
        },
        "/api/v1/vendors/{id}/policies": {
          get: {
            tags: ["Vendors"],
            summary: "List connected vendor policies",
            responses: { "200": { description: "Vendor policies" } },
          },
        },
        "/api/v1/notifications": {
          get: {
            tags: ["Notifications"],
            summary: "List notifications",
            responses: { "200": { description: "Notifications" } },
          },
        },
      },
    });
  }),
});

// ── GET /.well-known/mcp.json ──
http.route({
  path: "/.well-known/mcp.json",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    return jsonResponse({
      mcpServers: {
        spot: {
          uri: `${url.origin}/mcp`,
          instructions:
            "Spot is an insurance intelligence platform. Use Spot tools to look up bound policies, renewals, threads, and compliance workflows.",
        },
      },
    });
  }),
});

// ── Brand icon ──
// Served from the MCP host itself: clients that ignore `serverInfo.icons` fall
// back to the icon at the server origin, and a Convex site answers only the
// routes it declares.
http.route({
  path: "/icon.svg",
  method: "GET",
  handler: httpAction(async () => spotIconResponse()),
});

http.route({
  path: "/favicon.ico",
  method: "GET",
  handler: httpAction(async () => spotIconResponse()),
});

export default http;
