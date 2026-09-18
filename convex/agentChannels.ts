import dayjs from "dayjs";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getOrgAccess, requireCurrentOrgAdminWrite } from "./lib/access";
import {
  getActiveOperatorImpersonation,
  requireOperator,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";
import {
  getOperatorImessageContactPhone,
  getOperatorImessageWorkerUrl,
  isOperatorImessageInboundEnabled,
  isOperatorImessageTerminalEnabled,
} from "./lib/imessageConfig";
import { getSlackHostConfiguration } from "./lib/slackConfig";
import { missingSlackCustomerScopes } from "./lib/slackOAuthPolicy";

const internalApi = internal as any;

export const DEFAULT_AGENT_CHANNEL_SETTINGS = {
  emailEnabled: true,
  imessageEnabled: true,
  slackEnabled: false,
  slackSafeAlertsEnabled: true,
  slackVendorAlertsEnabled: false,
} as const;

const OPERATOR_SLACK_ROSTER_LIMIT = 250;

const slackSetupStepValidator = v.union(
  v.literal("install"),
  v.literal("support"),
  v.literal("channels"),
  v.literal("automations"),
);
const deferrableSlackSetupStepValidator = v.union(
  v.literal("install"),
  v.literal("support"),
  v.literal("channels"),
);

type SlackSetupStep = "install" | "support" | "channels" | "automations";
type DeferrableSlackSetupStep = Exclude<SlackSetupStep, "automations">;

type AgentChannelSettingsInput = {
  emailEnabled: boolean;
  imessageEnabled: boolean;
  slackEnabled: boolean;
  slackSafeAlertsEnabled: boolean;
  slackVendorAlertsEnabled: boolean;
};

function normalizeAgentHandle(value: string | undefined) {
  const raw = value?.trim().toLowerCase() ?? "";
  const withoutDomain = raw.includes("@") ? raw.split("@")[0] : raw;
  const normalized = withoutDomain
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");
  return normalized || undefined;
}

function validateAgentHandle(handle: string | undefined) {
  if (handle === "operator")
    throw new Error("This address is reserved for the operator agent");
  if (!handle) return;
  if (handle.length < 3 || handle.length > 30) {
    throw new Error("Agent email address must be 3-30 characters");
  }
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(handle)) {
    throw new Error(
      "Agent email address must start with a letter and end with a letter or number",
    );
  }
}

const settingsArgs = {
  emailEnabled: v.boolean(),
  imessageEnabled: v.boolean(),
  slackEnabled: v.boolean(),
  slackSafeAlertsEnabled: v.boolean(),
  slackVendorAlertsEnabled: v.boolean(),
};

function randomState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function readSettings(
  ctx: QueryCtx | MutationCtx,
  clientOrgId: Id<"organizations">,
) {
  const settings = await ctx.db
    .query("agentChannelSettings")
    .withIndex("client", (q) => q.eq("clientOrgId", clientOrgId))
    .first();
  const org = await ctx.db.get(clientOrgId);
  if (!org || org.deletedAt !== undefined)
    return {
      clientOrgId,
      ...DEFAULT_AGENT_CHANNEL_SETTINGS,
      emailEnabled: false,
      imessageEnabled: false,
      slackEnabled: false,
      slackSafeAlertsEnabled: false,
      slackVendorAlertsEnabled: false,
    };
  return settings ?? { clientOrgId, ...DEFAULT_AGENT_CHANNEL_SETTINGS };
}

async function activeConnection(
  ctx: QueryCtx | MutationCtx,
  clientOrgId: Id<"organizations">,
) {
  return await ctx.db
    .query("slackWorkspaceConnections")
    .withIndex("client_status", (q) =>
      q.eq("clientOrgId", clientOrgId).eq("status", "active"),
    )
    .first();
}

async function retainedConnection(
  ctx: QueryCtx | MutationCtx,
  clientOrgId: Id<"organizations">,
) {
  for (const status of ["active", "revoked", "disconnected"] as const) {
    const connection = await ctx.db
      .query("slackWorkspaceConnections")
      .withIndex("client_status", (q) =>
        q.eq("clientOrgId", clientOrgId).eq("status", status),
      )
      .order("desc")
      .first();
    if (connection) return connection;
  }
  return null;
}

async function requireWritableOperator(ctx: MutationCtx) {
  const operator = await requireOperator(ctx);
  if (await getActiveOperatorImpersonation(ctx)) {
    throw new Error(
      "Stop impersonating the client before changing Slack setup",
    );
  }
  return operator;
}

async function slackSetupState(
  ctx: QueryCtx | MutationCtx,
  clientOrgId: Id<"organizations">,
) {
  return await ctx.db
    .query("slackSetupStates")
    .withIndex("client", (q) => q.eq("clientOrgId", clientOrgId))
    .first();
}

async function invalidateSlackSetupOAuthStates(
  ctx: MutationCtx,
  clientOrgId: Id<"organizations">,
  now: number,
) {
  for (const purpose of ["customer", "customer_install_invite"] as const) {
    const states = await ctx.db
      .query("slackOAuthStates")
      .withIndex("client_purpose", (q) =>
        q.eq("clientOrgId", clientOrgId).eq("purpose", purpose),
      )
      .collect();
    for (const state of states) {
      if (!state.usedAt && !state.invalidatedAt) {
        await ctx.db.patch(state._id, { invalidatedAt: now });
      }
    }
  }
}

async function channelOverview(
  ctx: QueryCtx | MutationCtx,
  clientOrgId: Id<"organizations">,
  includeLifecycleHistory = false,
) {
  const [client, settings, connection] = await Promise.all([
    ctx.db.get(clientOrgId),
    readSettings(ctx, clientOrgId),
    retainedConnection(ctx, clientOrgId),
  ]);
  if (!client || (client.type ?? "client") !== "client") {
    throw new Error("Client organization not found");
  }
  const agentEmailAddress = {
    handle: client.agentHandle ?? "agent",
    configuredHandle: client.agentHandle ?? null,
    source: client.agentHandle ? ("client" as const) : ("shared" as const),
    ownerOrgId: client._id,
    ownerName: client.name,
  };
  let supportChannel: Doc<"slackChannelBindings"> | null = null;
  for (const status of ["active", "unavailable", "archived"] as const) {
    supportChannel = await ctx.db
      .query("slackChannelBindings")
      .withIndex("client_status", (q) =>
        q.eq("clientOrgId", clientOrgId).eq("status", status),
      )
      .order("desc")
      .first();
    if (supportChannel) break;
  }
  const [setup, lifecycleEvents] = await Promise.all([
    slackSetupState(ctx, clientOrgId),
    includeLifecycleHistory
      ? ctx.db
          .query("slackLifecycleEvents")
          .withIndex("client_received", (q) => q.eq("clientOrgId", clientOrgId))
          .order("desc")
          .take(10)
      : [],
  ]);
  const joinedChannels = connection
    ? await ctx.db
        .query("slackChannelMemberships")
        .withIndex("connection_status", (q) =>
          q.eq("connectionId", connection._id).eq("status", "active"),
        )
        .collect()
    : [];
  const slackHealth = (() => {
    if (!connection) {
      return {
        status: "not_connected" as const,
        reasonSummary: "Slack has not been connected.",
        recoveryAction: null,
        lastVerifiedAt: null,
        lastHealthyAt: null,
      };
    }
    if (connection.status === "revoked") {
      return {
        status: "revoked" as const,
        reasonCode: connection.healthReason ?? "authorization_revoked",
        reasonSummary:
          connection.healthReason === "app_uninstalled"
            ? "The Spot app was uninstalled from this workspace."
            : "Spot no longer has valid Slack authorization for this workspace.",
        recoveryAction: "reinstall" as const,
        lastVerifiedAt: connection.lastVerifiedAt ?? null,
        lastHealthyAt: connection.lastHealthyAt ?? null,
      };
    }
    if (connection.status === "disconnected") {
      return {
        status: "disconnected" as const,
        reasonCode: "operator_disconnected",
        reasonSummary: "Slack was disconnected in Spot.",
        recoveryAction: "reinstall" as const,
        lastVerifiedAt: connection.lastVerifiedAt ?? null,
        lastHealthyAt: connection.lastHealthyAt ?? null,
      };
    }
    const missingScopes = missingSlackCustomerScopes(connection.grantedScopes);
    if (missingScopes.length > 0) {
      return {
        status: "degraded" as const,
        reasonCode: "missing_required_scopes",
        reasonSummary: `Reinstall Spot in Slack to authorize ${missingScopes.join(", ")}.`,
        recoveryAction: "reinstall" as const,
        lastVerifiedAt: connection.lastVerifiedAt ?? null,
        lastHealthyAt: connection.lastHealthyAt ?? null,
      };
    }
    if (connection.healthStatus === "degraded") {
      return {
        status: "degraded" as const,
        reasonCode: connection.healthReason ?? "verification_failed",
        reasonSummary:
          connection.providerErrorSummary ??
          "Spot could not verify the Slack connection. Delivery is paused while verification retries.",
        recoveryAction: null,
        lastVerifiedAt: connection.lastVerifiedAt ?? null,
        lastHealthyAt: connection.lastHealthyAt ?? null,
      };
    }
    if (
      (supportChannel && supportChannel.status !== "active") ||
      supportChannel?.healthStatus === "degraded"
    ) {
      return {
        status: "channel_unavailable" as const,
        reasonCode:
          supportChannel?.unavailableReason ?? "channel_verification_failed",
        reasonSummary:
          supportChannel?.providerErrorSummary ??
          `The primary Slack channel #${supportChannel?.channelName ?? "unknown"} is unavailable.`,
        recoveryAction: "rebind" as const,
        lastVerifiedAt: supportChannel?.lastVerifiedAt ?? null,
        lastHealthyAt: supportChannel?.lastHealthyAt ?? null,
      };
    }
    return {
      status: "healthy" as const,
      reasonSummary:
        "Slack authorization and the primary channel are available.",
      recoveryAction: null,
      lastVerifiedAt: connection.lastVerifiedAt ?? null,
      lastHealthyAt: connection.lastHealthyAt ?? null,
    };
  })();
  return {
    settings: settingsInput(settings),
    agentEmailAddress,
    connection,
    primaryChannel: supportChannel,
    supportChannel,
    joinedChannels,
    slackMode: getSlackHostConfiguration().mode,
    setup,
    slackHealth,
    lifecycleEvents: lifecycleEvents.map((event) => ({
      id: event._id,
      source: event.source,
      eventType: event.eventType,
      status: event.status,
      summary: event.resultSummary ?? event.lastError ?? event.eventType,
      receivedAt: event.receivedAt,
      processedAt: event.processedAt,
    })),
  };
}

async function setupActorKind(
  ctx: QueryCtx,
  clientOrgId: Id<"organizations">,
  userId: Id<"users">,
) {
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("organization_user", (q) =>
      q.eq("orgId", clientOrgId).eq("userId", userId),
    )
    .first();
  if (membership?.role === "admin") return "client_admin" as const;
  const profile = await ctx.db
    .query("operatorProfiles")
    .withIndex("user", (q) => q.eq("userId", userId))
    .first();
  return profile?.status === "active" ? ("operator" as const) : null;
}

function settingsInput(
  settings: AgentChannelSettingsInput,
): AgentChannelSettingsInput {
  return {
    emailEnabled: settings.emailEnabled,
    imessageEnabled: settings.imessageEnabled,
    slackEnabled: settings.slackEnabled,
    slackSafeAlertsEnabled: settings.slackSafeAlertsEnabled,
    slackVendorAlertsEnabled: settings.slackVendorAlertsEnabled,
  };
}

async function deactivateConnection(
  ctx: MutationCtx,
  connection: Doc<"slackWorkspaceConnections">,
  status: "disconnected" | "revoked",
  actor: {
    updatedByUserId?: Id<"users">;
    updatedByOperatorUserId?: Id<"users">;
  },
  reason = status === "disconnected"
    ? "operator_disconnected"
    : "authorization_revoked",
) {
  const now = dayjs().valueOf();
  if (connection.nativeInstallationId) {
    const installation = await ctx.db.get(connection.nativeInstallationId);
    if (installation) {
      await ctx.db.patch(installation._id, {
        status,
        encryptedBotToken: undefined,
        encryptedRefreshToken: undefined,
        botTokenExpiresAt: undefined,
        updatedAt: now,
      });
    }
  }
  await ctx.db.patch(connection._id, {
    status,
    healthStatus: "degraded",
    healthReason: reason,
    healthSource: status === "revoked" ? "provider" : undefined,
    lastVerifiedAt: now,
    nextReconciliationAt: undefined,
    disconnectedAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internalApi.slackLifecycle.suspendOutbound, {
    connectionId: connection._id,
    reason:
      status === "disconnected"
        ? "Slack was disconnected in Spot"
        : "Slack authorization is revoked",
  });
  if (status === "disconnected") {
    const bindings = (
      await Promise.all(
        (["active", "unavailable"] as const).map((bindingStatus) =>
          ctx.db
            .query("slackChannelBindings")
            .withIndex("connection_status", (q) =>
              q.eq("connectionId", connection._id).eq("status", bindingStatus),
            )
            .collect(),
        ),
      )
    ).flat();
    for (const binding of bindings) {
      await ctx.db.patch(binding._id, {
        status: "archived",
        unavailableReason: "operator_disconnected",
        updatedAt: now,
      });
    }
    const settings = settingsInput(
      await readSettings(ctx, connection.clientOrgId),
    );
    await upsertSettings(
      ctx,
      connection.clientOrgId,
      { ...settings, slackEnabled: false },
      actor,
    );
  }
}

export const get = query({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.clientOrgId);
    if (access.orgType !== "client") {
      throwUserFacingError(
        userFacingErrorCodes.orgAccessRequired,
        "Agent channels are available only to client organizations.",
      );
    }
    const impersonation = await getActiveOperatorImpersonation(ctx);
    const { setup, ...overview } = await channelOverview(ctx, args.clientOrgId);
    return {
      ...overview,
      setup: setup ? { status: setup.status } : null,
      permissions: {
        canManage:
          !impersonation &&
          access.accessType === "member" &&
          access.role === "admin",
        canRecover:
          !impersonation &&
          access.accessType === "member" &&
          access.role === "admin",
        canDisconnect:
          !impersonation &&
          access.accessType === "member" &&
          access.role === "admin",
        canViewAudit: false,
      },
    };
  },
});

export const getForOperator = query({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const impersonation = await getActiveOperatorImpersonation(ctx);
    return {
      ...(await channelOverview(ctx, args.clientOrgId, true)),
      permissions: {
        canManage: !impersonation,
        canRecover: !impersonation,
        canDisconnect: !impersonation,
        canViewAudit: !impersonation,
      },
    };
  },
});

export const update = mutation({
  args: settingsArgs,
  handler: async (ctx, args) => {
    const access = await requireCurrentOrgAdminWrite(ctx);
    if ((access.org.type ?? "client") !== "client") {
      throwUserFacingError(
        userFacingErrorCodes.orgAccessRequired,
        "Slack is owned by the client organization.",
      );
    }
    return await upsertSettings(ctx, access.orgId, args, {
      updatedByUserId: access.userId,
    });
  },
});

export const updateForOperator = mutation({
  args: { clientOrgId: v.id("organizations"), ...settingsArgs },
  handler: async (ctx, args) => {
    const operator = await requireWritableOperator(ctx);
    const org = await ctx.db.get(args.clientOrgId);
    if (
      !org ||
      org.deletedAt !== undefined ||
      (org.type ?? "client") !== "client"
    ) {
      throw new Error("Client organization not found");
    }
    const { clientOrgId, ...settings } = args;
    const id = await upsertSettings(ctx, clientOrgId, settings, {
      updatedByOperatorUserId: operator.userId,
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: clientOrgId,
      summary: "Updated client agent channel settings",
      metadata: settings,
    });
    return id;
  },
});

export const updateStandaloneAgentEmailHandleForOperator = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    handle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const client = await ctx.db.get(args.clientOrgId);
    if (!client || (client.type ?? "client") !== "client") {
      throw new Error("Client organization not found");
    }
    const handle = normalizeAgentHandle(args.handle);
    validateAgentHandle(handle);
    if (handle) {
      const existing = await ctx.db
        .query("organizations")
        .withIndex("handle", (q) => q.eq("agentHandle", handle))
        .unique();
      if (existing && existing._id !== client._id) {
        throw new Error("Agent email address is already taken");
      }
    }

    await ctx.db.patch(client._id, { agentHandle: handle });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: client._id,
      summary: `Updated agent email address for ${client.name}`,
      metadata: {
        previousHandle: client.agentHandle,
        nextHandle: handle,
      },
    });
    return handle ?? null;
  },
});

export const startSlackSetup = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    mode: v.union(v.literal("initial"), v.literal("reinstall")),
  },
  handler: async (ctx, args) => {
    const operator = await requireWritableOperator(ctx);
    const org = await ctx.db.get(args.clientOrgId);
    if (
      !org ||
      org.deletedAt !== undefined ||
      (org.type ?? "client") !== "client"
    ) {
      throw new Error("Client organization not found");
    }
    const connection = await retainedConnection(ctx, args.clientOrgId);
    if (args.mode === "reinstall" && !connection) {
      throw new Error("Connect Slack before starting a reinstall");
    }
    if (args.mode === "initial" && connection?.status === "active") {
      throw new Error("Slack is already connected for this client");
    }

    const existing = await slackSetupState(ctx, args.clientOrgId);
    if (existing?.status === "in_progress" && existing.mode === args.mode) {
      return existing._id;
    }

    const now = dayjs().valueOf();
    if (existing) {
      await invalidateSlackSetupOAuthStates(ctx, args.clientOrgId, now);
    }
    const setup = {
      version: 1 as const,
      mode: args.mode,
      status: "in_progress" as const,
      currentStep: "install" as const,
      deferredSteps: [] as DeferrableSlackSetupStep[],
      inviteRecipientEmail: undefined,
      inviteSentAt: undefined,
      inviteExpiresAt: undefined,
      installationCompletedAt: undefined,
      supportOmittedOperators: undefined,
      supportOperatorInvitesSucceeded: undefined,
      supportOperatorInviteError: undefined,
      supportInviteSentAt: undefined,
      supportInviteError: undefined,
      startedByOperatorUserId: operator.userId,
      completedByOperatorUserId: undefined,
      startedAt: now,
      completedAt: undefined,
      cancelledAt: undefined,
      updatedAt: now,
    };
    let setupId: Id<"slackSetupStates">;
    if (existing) {
      await ctx.db.patch(existing._id, setup);
      setupId = existing._id;
    } else {
      setupId = await ctx.db.insert("slackSetupStates", {
        clientOrgId: args.clientOrgId,
        ...setup,
        createdAt: now,
      });
    }
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: args.clientOrgId,
      summary:
        args.mode === "reinstall"
          ? "Started client Slack reinstall"
          : "Started client Slack setup",
      metadata: { setupId, mode: args.mode },
    });
    return setupId;
  },
});

export const setSlackSetupStep = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    step: slackSetupStepValidator,
    deferredStep: v.optional(deferrableSlackSetupStepValidator),
  },
  handler: async (ctx, args) => {
    const operator = await requireWritableOperator(ctx);
    const setup = await slackSetupState(ctx, args.clientOrgId);
    if (!setup || setup.status !== "in_progress") {
      throw new Error("Slack setup is not in progress");
    }
    const deferredSteps = args.deferredStep
      ? Array.from(new Set([...setup.deferredSteps, args.deferredStep]))
      : setup.deferredSteps;
    await ctx.db.patch(setup._id, {
      currentStep: args.step,
      deferredSteps,
      updatedAt: dayjs().valueOf(),
    });
    if (args.deferredStep) {
      await writeOperatorAudit(ctx, {
        operatorUserId: operator.userId,
        type: "setup_write",
        targetOrgId: args.clientOrgId,
        summary: `Deferred ${args.deferredStep} during client Slack setup`,
        metadata: { setupId: setup._id, nextStep: args.step },
      });
    }
    return setup._id;
  },
});

export const finishSlackSetup = mutation({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const operator = await requireWritableOperator(ctx);
    const [setup, connection, supportChannel] = await Promise.all([
      slackSetupState(ctx, args.clientOrgId),
      activeConnection(ctx, args.clientOrgId),
      ctx.db
        .query("slackChannelBindings")
        .withIndex("client_status", (q) =>
          q.eq("clientOrgId", args.clientOrgId).eq("status", "active"),
        )
        .first(),
    ]);
    if (!setup || setup.status !== "in_progress") {
      throw new Error("Slack setup is not in progress");
    }
    if (
      !connection ||
      missingSlackCustomerScopes(connection.grantedScopes).length > 0
    ) {
      throw new Error("Install or update Spot in Slack before finishing setup");
    }
    if (
      setup.mode === "reinstall" &&
      (!setup.installationCompletedAt ||
        setup.installationCompletedAt < setup.startedAt)
    ) {
      throw new Error("Finish the Slack reinstall before completing setup");
    }
    const now = dayjs().valueOf();
    const deferredSteps = setup.deferredSteps.filter((step) => {
      if (step === "install") return false;
      if (step === "support") return !supportChannel;
      return !connection.automaticChannelId;
    });
    await invalidateSlackSetupOAuthStates(ctx, args.clientOrgId, now);
    await ctx.db.patch(setup._id, {
      status: "completed",
      currentStep: "automations",
      deferredSteps,
      completedByOperatorUserId: operator.userId,
      completedAt: now,
      cancelledAt: undefined,
      updatedAt: now,
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: args.clientOrgId,
      summary:
        setup.mode === "reinstall"
          ? "Completed client Slack reinstall"
          : "Completed client Slack setup",
      metadata: { setupId: setup._id, deferredSteps },
    });
    return setup._id;
  },
});

export const cancelSlackSetup = mutation({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const operator = await requireWritableOperator(ctx);
    const setup = await slackSetupState(ctx, args.clientOrgId);
    if (!setup || setup.status !== "in_progress") return null;
    if (setup.mode !== "reinstall") {
      throw new Error("Initial Slack setup can be closed and resumed later");
    }
    const now = dayjs().valueOf();
    await invalidateSlackSetupOAuthStates(ctx, args.clientOrgId, now);
    await ctx.db.patch(setup._id, {
      status: "cancelled",
      cancelledAt: now,
      updatedAt: now,
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: args.clientOrgId,
      summary: "Cancelled client Slack reinstall",
      metadata: { setupId: setup._id },
    });
    return setup._id;
  },
});

export const setOperatorSlackIdentity = mutation({
  args: { teamId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    const operator = await requireWritableOperator(ctx);
    const teamId = args.teamId.trim();
    const slackUserId = args.userId.trim();
    if (!teamId || !slackUserId)
      throw new Error("Slack team and user IDs are required");
    const configuration = getSlackHostConfiguration();
    const hostTeamId = process.env.SLACK_CLARITY_TEAM_ID?.trim();
    if (!configuration.configured || !hostTeamId) {
      throw new Error("The Clarity Slack workspace is not configured");
    }
    if (teamId !== hostTeamId) {
      throw new Error(
        "The operator identity must belong to the configured Clarity Slack workspace",
      );
    }
    if (configuration.mode === "slack") {
      const installation = await ctx.db
        .query("slackInstallations")
        .withIndex("team_status", (q) =>
          q.eq("teamId", hostTeamId).eq("status", "active"),
        )
        .first();
      if (installation?.kind !== "host") {
        throw new Error("Connect the Clarity Slack workspace first");
      }
    }
    const collision = await ctx.db
      .query("operatorProfiles")
      .withIndex("slack_user", (q) =>
        q.eq("slackTeamId", teamId).eq("slackUserId", slackUserId),
      )
      .first();
    if (collision && collision._id !== operator.profile._id) {
      throw new Error("This Slack identity belongs to another Spot operator");
    }
    await ctx.db.patch(operator.profile._id, {
      slackTeamId: teamId,
      slackUserId,
      updatedAt: dayjs().valueOf(),
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      summary: "Connected operator Slack identity",
      metadata: { teamId, slackUserId },
    });
  },
});

export const listOperatorSlackIdentities = query({
  args: {},
  handler: async (ctx) => {
    const current = await requireOperator(ctx);
    const profiles = await ctx.db
      .query("operatorProfiles")
      .take(OPERATOR_SLACK_ROSTER_LIMIT);
    const operators = await Promise.all(
      profiles.map(async (profile) => {
        const user = await ctx.db.get(profile.userId);
        return {
          userId: profile.userId,
          name: user?.name ?? null,
          email: profile.email,
          role: profile.role,
          status: profile.status,
          slackTeamId: profile.slackTeamId ?? null,
          slackUserId: profile.slackUserId ?? null,
          isCurrent: profile._id === current.profile._id,
        };
      }),
    );
    return operators.sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return a.email.localeCompare(b.email);
    });
  },
});

export const getOperatorSlackRecipientForAction = internalQuery({
  args: { recipientEmail: v.string() },
  handler: async (ctx, args) => {
    const recipientEmail = args.recipientEmail.trim().toLowerCase();
    const profile = await ctx.db
      .query("operatorProfiles")
      .withIndex("email", (query) => query.eq("email", recipientEmail))
      .unique();
    if (!profile || profile.status !== "active") {
      throw new Error("Active Spot operator not found for recipient email");
    }
    const hostTeamId = process.env.SLACK_CLARITY_TEAM_ID?.trim();
    if (
      !hostTeamId ||
      profile.slackTeamId !== hostTeamId ||
      !profile.slackUserId?.trim()
    ) {
      throw new Error(
        "Recipient is not linked to the configured operator Slack workspace",
      );
    }
    const user = await ctx.db.get(profile.userId);
    return {
      operatorUserId: profile.userId,
      name: user?.name?.trim() || profile.email,
      email: profile.email,
      teamId: hostTeamId,
      slackUserId: profile.slackUserId,
    };
  },
});

async function upsertSettings(
  ctx: MutationCtx,
  clientOrgId: Id<"organizations">,
  settings: AgentChannelSettingsInput,
  actor: {
    updatedByUserId?: Id<"users">;
    updatedByOperatorUserId?: Id<"users">;
  },
) {
  const existing = await ctx.db
    .query("agentChannelSettings")
    .withIndex("client", (q) => q.eq("clientOrgId", clientOrgId))
    .first();
  const now = dayjs().valueOf();
  if (existing) {
    await ctx.db.patch(existing._id, { ...settings, ...actor, updatedAt: now });
    return existing._id;
  }
  return await ctx.db.insert("agentChannelSettings", {
    clientOrgId,
    ...settings,
    ...actor,
    createdAt: now,
    updatedAt: now,
  });
}

export const authorizeSetup = internalQuery({
  args: { clientOrgId: v.id("organizations"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.clientOrgId);
    if (
      !org ||
      org.deletedAt !== undefined ||
      (org.type ?? "client") !== "client"
    ) {
      throw new Error("Client organization not found");
    }
    const kind = await setupActorKind(ctx, args.clientOrgId, args.userId);
    if (!kind) throwUserFacingError(userFacingErrorCodes.clientAdminRequired);
    if (kind === "operator" && (await getActiveOperatorImpersonation(ctx))) {
      throw new Error(
        "Stop impersonating the client before changing Slack setup",
      );
    }
    return { kind, org, userId: args.userId };
  },
});

export const authorizeSlackInstallInvite = internalQuery({
  args: { clientOrgId: v.id("organizations"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.clientOrgId);
    if (
      !org ||
      org.deletedAt !== undefined ||
      (org.type ?? "client") !== "client"
    ) {
      throw new Error("Client organization not found");
    }
    const profile = await ctx.db
      .query("operatorProfiles")
      .withIndex("user", (q) => q.eq("userId", args.userId))
      .first();
    if (!profile || profile.status !== "active") {
      throwUserFacingError(userFacingErrorCodes.operatorRequired);
    }
    const [connection, setup] = await Promise.all([
      retainedConnection(ctx, args.clientOrgId),
      slackSetupState(ctx, args.clientOrgId),
    ]);
    if (!setup || setup.status !== "in_progress") {
      throw new Error(
        "Start Slack setup before sending an installation invite",
      );
    }
    if (setup.mode === "reinstall" && !connection) {
      throw new Error("The existing Slack connection could not be found");
    }
    return {
      clientName: org.name,
      connection,
      setupStateId: setup._id,
      setupMode: setup.mode,
    };
  },
});

export const getSlackSetupForAction = internalQuery({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => await slackSetupState(ctx, args.clientOrgId),
});

export const getActiveSlackConnectionByTeamId = internalQuery({
  args: { teamId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("slackWorkspaceConnections")
      .withIndex("team_status", (q) =>
        q.eq("teamId", args.teamId).eq("status", "active"),
      )
      .first(),
});

export const getSlackSupportSetupContext = internalQuery({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.clientOrgId);
    if (
      !org ||
      org.deletedAt !== undefined ||
      (org.type ?? "client") !== "client"
    ) {
      throw new Error("Client organization not found");
    }
    const hostTeamId = process.env.SLACK_CLARITY_TEAM_ID?.trim();
    if (!hostTeamId) {
      throw new Error("The Clarity Slack workspace is not configured");
    }
    const profiles = await ctx.db
      .query("operatorProfiles")
      .take(OPERATOR_SLACK_ROSTER_LIMIT);
    const operators = await Promise.all(
      profiles.map(async (profile) => {
        const user = await ctx.db.get(profile.userId);
        const displayName = user?.name?.trim() || profile.email;
        if (profile.status !== "active") {
          return {
            displayName,
            email: profile.email,
            slackUserId: null,
            omissionReason: "Operator is disabled" as const,
          };
        }
        if (!profile.slackUserId) {
          return {
            displayName,
            email: profile.email,
            slackUserId: null,
            omissionReason: "Not linked to Slack" as const,
          };
        }
        if (profile.slackTeamId !== hostTeamId) {
          return {
            displayName,
            email: profile.email,
            slackUserId: null,
            omissionReason: "Linked to a different workspace" as const,
          };
        }
        return {
          displayName,
          email: profile.email,
          slackUserId: profile.slackUserId,
          omissionReason: null,
        };
      }),
    );
    return {
      hostTeamId,
      linkedOperatorUserIds: Array.from(
        new Set(
          operators.flatMap((operator) =>
            operator.slackUserId ? [operator.slackUserId] : [],
          ),
        ),
      ),
      omittedOperators: operators
        .filter((operator) => operator.omissionReason)
        .map(({ displayName, email, omissionReason }) => ({
          displayName,
          email,
          reason: omissionReason!,
        })),
    };
  },
});

export const recordSlackSupportSetupOutcome = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    operatorUserId: v.id("users"),
    omittedOperators: v.array(
      v.object({
        displayName: v.string(),
        email: v.string(),
        reason: v.string(),
      }),
    ),
    operatorInvitesSucceeded: v.boolean(),
    operatorInviteError: v.optional(v.string()),
    supportInviteSucceeded: v.boolean(),
    supportInviteError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const setup = await slackSetupState(ctx, args.clientOrgId);
    if (!setup) {
      return await ctx.db.insert("slackSetupStates", {
        clientOrgId: args.clientOrgId,
        version: 1,
        mode: "initial",
        status: "completed",
        currentStep: "automations",
        deferredSteps: [],
        supportOmittedOperators: args.omittedOperators,
        supportOperatorInvitesSucceeded: args.operatorInvitesSucceeded,
        supportOperatorInviteError: args.operatorInviteError,
        supportInviteSentAt: args.supportInviteSucceeded ? now : undefined,
        supportInviteError: args.supportInviteError,
        startedByOperatorUserId: args.operatorUserId,
        completedByOperatorUserId: args.operatorUserId,
        startedAt: now,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(setup._id, {
      supportOmittedOperators: args.omittedOperators,
      supportOperatorInvitesSucceeded: args.operatorInvitesSucceeded,
      supportOperatorInviteError: args.operatorInviteError,
      supportInviteSentAt: args.supportInviteSucceeded ? now : undefined,
      supportInviteError: args.supportInviteError,
      updatedAt: now,
    });
    return setup._id;
  },
});

export const getSlackConnectionForMockSetup = internalQuery({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) =>
    (await activeConnection(ctx, args.clientOrgId)) ??
    (await ctx.db
      .query("slackWorkspaceConnections")
      .withIndex("client_status", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("status", "disconnected"),
      )
      .first()) ??
    (await ctx.db
      .query("slackWorkspaceConnections")
      .withIndex("client_status", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("status", "revoked"),
      )
      .first()),
});

export const getPrimarySlackBindingForSetup = internalQuery({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("slackChannelBindings")
      .withIndex("client_status", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("status", "active"),
      )
      .first(),
});

export const createOAuthState = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    userId: v.id("users"),
    actorKind: v.union(v.literal("client_admin"), v.literal("operator")),
    setupStateId: v.optional(v.id("slackSetupStates")),
  },
  handler: async (ctx, args) => {
    const state = randomState();
    const now = dayjs().valueOf();
    await ctx.db.insert("slackOAuthStates", {
      stateHash: await sha256(state),
      purpose: "customer",
      clientOrgId: args.clientOrgId,
      setupStateId: args.setupStateId,
      ...(args.actorKind === "operator"
        ? { initiatedByOperatorUserId: args.userId }
        : { initiatedByUserId: args.userId }),
      expiresAt: dayjs(now).add(10, "minute").valueOf(),
      createdAt: now,
    });
    return state;
  },
});

export const createSlackInstallInviteOAuthState = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    setupStateId: v.id("slackSetupStates"),
    operatorUserId: v.id("users"),
    recipientEmail: v.string(),
    expiresInDays: v.number(),
  },
  handler: async (ctx, args) => {
    if (
      !Number.isInteger(args.expiresInDays) ||
      args.expiresInDays < 1 ||
      args.expiresInDays > 14
    ) {
      throw new Error("Slack install invitation expiration must be 1-14 days");
    }
    const setup = await ctx.db.get(args.setupStateId);
    if (
      !setup ||
      setup.clientOrgId !== args.clientOrgId ||
      setup.status !== "in_progress"
    ) {
      throw new Error("Slack setup is not in progress");
    }
    const state = randomState();
    const now = dayjs().valueOf();
    const existingStates = await ctx.db
      .query("slackOAuthStates")
      .withIndex("client_purpose", (q) =>
        q
          .eq("clientOrgId", args.clientOrgId)
          .eq("purpose", "customer_install_invite"),
      )
      .collect();
    for (const existing of existingStates) {
      if (!existing.usedAt && !existing.invalidatedAt) {
        await ctx.db.patch(existing._id, { invalidatedAt: now });
      }
    }
    const expiresAt = dayjs(now).add(args.expiresInDays, "day").valueOf();
    const stateId = await ctx.db.insert("slackOAuthStates", {
      stateHash: await sha256(state),
      purpose: "customer_install_invite",
      clientOrgId: args.clientOrgId,
      setupStateId: args.setupStateId,
      recipientEmail: args.recipientEmail,
      initiatedByOperatorUserId: args.operatorUserId,
      expiresAt,
      createdAt: now,
    });
    return { state, stateId, expiresAt };
  },
});

export const recordSlackInstallInviteSent = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    setupStateId: v.id("slackSetupStates"),
    operatorUserId: v.id("users"),
    recipientEmail: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("operatorProfiles")
      .withIndex("user", (q) => q.eq("userId", args.operatorUserId))
      .first();
    if (!profile || profile.status !== "active") {
      throwUserFacingError(userFacingErrorCodes.operatorRequired);
    }
    const org = await ctx.db.get(args.clientOrgId);
    if (
      !org ||
      org.deletedAt !== undefined ||
      (org.type ?? "client") !== "client"
    ) {
      throw new Error("Client organization not found");
    }
    const setup = await ctx.db.get(args.setupStateId);
    if (
      !setup ||
      setup.clientOrgId !== args.clientOrgId ||
      setup.status !== "in_progress"
    ) {
      throw new Error("Slack setup is not in progress");
    }
    const now = dayjs().valueOf();
    await ctx.db.patch(setup._id, {
      inviteRecipientEmail: args.recipientEmail,
      inviteSentAt: now,
      inviteExpiresAt: args.expiresAt,
      updatedAt: now,
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "setup_write",
      targetOrgId: args.clientOrgId,
      summary:
        setup.mode === "reinstall"
          ? "Sent client Slack app update invitation"
          : "Sent client Slack app install invitation",
      metadata: {
        recipientEmail: args.recipientEmail,
        expiresAt: args.expiresAt,
        setupId: setup._id,
      },
    });
  },
});

export const invalidateSlackOAuthState = internalMutation({
  args: { stateId: v.id("slackOAuthStates") },
  handler: async (ctx, args) => {
    const state = await ctx.db.get(args.stateId);
    if (!state || state.usedAt || state.invalidatedAt) return;
    await ctx.db.patch(state._id, { invalidatedAt: dayjs().valueOf() });
  },
});

export const createHostOAuthState = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const state = randomState();
    const now = dayjs().valueOf();
    await ctx.db.insert("slackOAuthStates", {
      stateHash: await sha256(state),
      purpose: "host",
      initiatedByOperatorUserId: args.userId,
      expiresAt: dayjs(now).add(10, "minute").valueOf(),
      createdAt: now,
    });
    return state;
  },
});

export const claimOAuthState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const stateHash = await sha256(args.state);
    const row = await ctx.db
      .query("slackOAuthStates")
      .withIndex("state", (q) => q.eq("stateHash", stateHash))
      .first();
    const now = dayjs().valueOf();
    if (!row || row.usedAt || row.invalidatedAt || row.expiresAt < now) {
      return null;
    }
    await ctx.db.patch(row._id, { usedAt: now });
    return row;
  },
});

export const markSlackSetupInstallationComplete = internalMutation({
  args: { setupStateId: v.id("slackSetupStates") },
  handler: async (ctx, args) => {
    const setup = await ctx.db.get(args.setupStateId);
    if (!setup || setup.status !== "in_progress") return null;
    const now = dayjs().valueOf();
    await ctx.db.patch(setup._id, {
      installationCompletedAt: now,
      updatedAt: now,
    });
    return setup._id;
  },
});

async function upsertNativeSlackInstallation(
  ctx: MutationCtx,
  args: {
    teamId: string;
    teamName: string;
    kind: "customer" | "host";
    appId?: string;
    botUserId?: string;
    encryptedBotToken: string;
    encryptedRefreshToken?: string;
    botTokenExpiresAt?: number;
    grantedScopes: string[];
  },
) {
  const active = await ctx.db
    .query("slackInstallations")
    .withIndex("team_status", (q) =>
      q.eq("teamId", args.teamId).eq("status", "active"),
    )
    .first();
  if (active && active.kind !== args.kind) {
    throw new Error("This Slack workspace already has a different Spot role");
  }
  const reusable =
    active ??
    (await ctx.db
      .query("slackInstallations")
      .withIndex("team_status", (q) =>
        q.eq("teamId", args.teamId).eq("status", "disconnected"),
      )
      .first()) ??
    (await ctx.db
      .query("slackInstallations")
      .withIndex("team_status", (q) =>
        q.eq("teamId", args.teamId).eq("status", "revoked"),
      )
      .first());
  if (reusable && reusable.kind !== args.kind) {
    throw new Error("This Slack workspace already has a different Spot role");
  }
  const now = dayjs().valueOf();
  if (reusable) {
    await ctx.db.patch(reusable._id, {
      teamName: args.teamName,
      appId: args.appId,
      botUserId: args.botUserId,
      encryptedBotToken: args.encryptedBotToken,
      encryptedRefreshToken: args.encryptedRefreshToken,
      botTokenExpiresAt: args.botTokenExpiresAt,
      grantedScopes: args.grantedScopes,
      status: "active",
      updatedAt: now,
    });
    return reusable._id;
  }
  return await ctx.db.insert("slackInstallations", {
    ...args,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

export const upsertSlackConnection = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    teamId: v.string(),
    teamName: v.string(),
    appId: v.optional(v.string()),
    encryptedBotToken: v.optional(v.string()),
    encryptedRefreshToken: v.optional(v.string()),
    botTokenExpiresAt: v.optional(v.number()),
    installationId: v.optional(v.string()),
    botUserId: v.optional(v.string()),
    grantedScopes: v.array(v.string()),
    installedByUserId: v.optional(v.id("users")),
    installedByOperatorUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const teamConnection = await ctx.db
      .query("slackWorkspaceConnections")
      .withIndex("team_status", (q) =>
        q.eq("teamId", args.teamId).eq("status", "active"),
      )
      .first();
    if (teamConnection && teamConnection.clientOrgId !== args.clientOrgId) {
      throw new Error(
        "This Slack workspace is already connected to another client",
      );
    }
    const clientConnection = await activeConnection(ctx, args.clientOrgId);
    if (clientConnection && clientConnection.teamId !== args.teamId) {
      throw new Error("This client already has an active Slack workspace");
    }

    const now = dayjs().valueOf();
    const nativeInstallationId = args.encryptedBotToken
      ? await upsertNativeSlackInstallation(ctx, {
          teamId: args.teamId,
          teamName: args.teamName,
          kind: "customer",
          appId: args.appId,
          botUserId: args.botUserId,
          encryptedBotToken: args.encryptedBotToken,
          encryptedRefreshToken: args.encryptedRefreshToken,
          botTokenExpiresAt: args.botTokenExpiresAt,
          grantedScopes: args.grantedScopes,
        })
      : undefined;
    const reusableConnection =
      clientConnection ??
      (await ctx.db
        .query("slackWorkspaceConnections")
        .withIndex("client_status", (q) =>
          q.eq("clientOrgId", args.clientOrgId).eq("status", "disconnected"),
        )
        .first()) ??
      (await ctx.db
        .query("slackWorkspaceConnections")
        .withIndex("client_status", (q) =>
          q.eq("clientOrgId", args.clientOrgId).eq("status", "revoked"),
        )
        .first());
    if (reusableConnection && reusableConnection.teamId !== args.teamId) {
      throw new Error(
        "This client already has a Slack workspace history; disconnect it before changing workspaces",
      );
    }

    let connectionId = reusableConnection?._id;
    if (reusableConnection) {
      await ctx.db.patch(reusableConnection._id, {
        teamName: args.teamName,
        appId: args.appId,
        ...(nativeInstallationId ? { nativeInstallationId } : {}),
        installationId: args.installationId,
        botUserId: args.botUserId,
        grantedScopes: args.grantedScopes,
        status: "active",
        healthStatus: "healthy",
        healthReason: undefined,
        healthSource: undefined,
        healthSourceEventKey: undefined,
        providerErrorCode: undefined,
        providerErrorSummary: undefined,
        authorizationUpdatedAt: now,
        lastVerifiedAt: now,
        lastHealthyAt: now,
        reconciliationFailureCount: 0,
        nextReconciliationAt: dayjs(now).add(15, "minute").valueOf(),
        installedByUserId: args.installedByUserId,
        installedByOperatorUserId: args.installedByOperatorUserId,
        thirdPartyVisibilityAcknowledged: true,
        updatedAt: now,
        disconnectedAt: undefined,
      });
    } else {
      const serviceUserId = await ctx.db.insert("users", {
        name: `Spot Slack (${args.teamName})`,
        accountKind: "customer",
        serviceAccountKind: "slack",
        onboardingComplete: true,
      });
      await ctx.db.insert("orgMemberships", {
        orgId: args.clientOrgId,
        userId: serviceUserId,
        role: "admin",
      });
      connectionId = await ctx.db.insert("slackWorkspaceConnections", {
        clientOrgId: args.clientOrgId,
        teamId: args.teamId,
        teamName: args.teamName,
        appId: args.appId,
        nativeInstallationId,
        installationId: args.installationId,
        botUserId: args.botUserId,
        grantedScopes: args.grantedScopes,
        status: "active",
        healthStatus: "healthy",
        authorizationUpdatedAt: now,
        lastVerifiedAt: now,
        lastHealthyAt: now,
        reconciliationFailureCount: 0,
        nextReconciliationAt: dayjs(now).add(15, "minute").valueOf(),
        serviceUserId,
        installedByUserId: args.installedByUserId,
        installedByOperatorUserId: args.installedByOperatorUserId,
        thirdPartyVisibilityAcknowledged: true,
        automaticChannelRoutingConfiguredAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    const current = await readSettings(ctx, args.clientOrgId);
    await upsertSettings(
      ctx,
      args.clientOrgId,
      {
        emailEnabled: current.emailEnabled,
        imessageEnabled: current.imessageEnabled,
        slackEnabled: true,
        slackSafeAlertsEnabled: current.slackSafeAlertsEnabled,
        slackVendorAlertsEnabled: current.slackVendorAlertsEnabled,
      },
      {
        updatedByUserId: args.installedByUserId,
        updatedByOperatorUserId: args.installedByOperatorUserId,
      },
    );
    const activeBinding = await ctx.db
      .query("slackChannelBindings")
      .withIndex("client_status", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("status", "active"),
      )
      .first();
    if (activeBinding && connectionId && !activeBinding.connectionId) {
      await ctx.db.patch(activeBinding._id, { connectionId, updatedAt: now });
    }
    if (args.installedByOperatorUserId) {
      await writeOperatorAudit(ctx, {
        operatorUserId: args.installedByOperatorUserId,
        type: "setup_write",
        targetOrgId: args.clientOrgId,
        summary: "Installed or refreshed the client Slack workspace connection",
        metadata: { teamId: args.teamId, teamName: args.teamName },
      });
    }
    return connectionId;
  },
});

export const upsertSlackHostInstallation = internalMutation({
  args: {
    teamId: v.string(),
    teamName: v.string(),
    appId: v.optional(v.string()),
    botUserId: v.optional(v.string()),
    encryptedBotToken: v.string(),
    encryptedRefreshToken: v.optional(v.string()),
    botTokenExpiresAt: v.optional(v.number()),
    grantedScopes: v.array(v.string()),
    installedByOperatorUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const installationId = await upsertNativeSlackInstallation(ctx, {
      teamId: args.teamId,
      teamName: args.teamName,
      kind: "host",
      appId: args.appId,
      botUserId: args.botUserId,
      encryptedBotToken: args.encryptedBotToken,
      encryptedRefreshToken: args.encryptedRefreshToken,
      botTokenExpiresAt: args.botTokenExpiresAt,
      grantedScopes: args.grantedScopes,
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: args.installedByOperatorUserId,
      type: "setup_write",
      summary: "Installed or refreshed the Clarity Slack host workspace",
      metadata: { teamId: args.teamId, teamName: args.teamName },
    });
    return installationId;
  },
});

export const bindPrimaryChannelForOperator = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    hostTeamId: v.string(),
    hostChannelId: v.string(),
    customerChannelId: v.optional(v.string()),
    channelName: v.string(),
  },
  handler: async (ctx, args) => {
    const operator = await requireWritableOperator(ctx);
    const connection = await activeConnection(ctx, args.clientOrgId);
    if (args.customerChannelId && !connection) {
      throw new Error(
        "Connect the customer Slack workspace before linking its support-channel mirror",
      );
    }
    const existing =
      (await ctx.db
        .query("slackChannelBindings")
        .withIndex("client_status", (q) =>
          q.eq("clientOrgId", args.clientOrgId).eq("status", "active"),
        )
        .first()) ??
      (await ctx.db
        .query("slackChannelBindings")
        .withIndex("client_status", (q) =>
          q.eq("clientOrgId", args.clientOrgId).eq("status", "unavailable"),
        )
        .first());
    const now = dayjs().valueOf();
    const sameChannel =
      existing?.hostTeamId === args.hostTeamId &&
      existing.hostChannelId === args.hostChannelId &&
      existing.customerChannelId === args.customerChannelId;
    let bindingId: Id<"slackChannelBindings">;
    if (existing && sameChannel) {
      await ctx.db.patch(existing._id, {
        connectionId: connection?._id,
        channelName: args.channelName,
        status: "active",
        healthStatus: "healthy",
        unavailableReason: undefined,
        healthSource: undefined,
        healthSourceEventKey: undefined,
        providerErrorCode: undefined,
        providerErrorSummary: undefined,
        boundAt: now,
        lastVerifiedAt: now,
        lastHealthyAt: now,
        reconciliationFailureCount: 0,
        updatedAt: now,
      });
      bindingId = existing._id;
    } else {
      if (existing) {
        await ctx.db.patch(existing._id, {
          status: "archived",
          unavailableReason: "operator_rebound",
          updatedAt: now,
        });
      }
      bindingId = await ctx.db.insert("slackChannelBindings", {
        connectionId: connection?._id,
        clientOrgId: args.clientOrgId,
        kind: "primary",
        hostTeamId: args.hostTeamId,
        hostChannelId: args.hostChannelId,
        customerChannelId: args.customerChannelId,
        channelName: args.channelName,
        status: "active",
        healthStatus: "healthy",
        boundAt: now,
        lastVerifiedAt: now,
        lastHealthyAt: now,
        reconciliationFailureCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: args.clientOrgId,
      summary: `Set #${args.channelName} as the primary Slack service channel`,
      metadata: {
        hostTeamId: args.hostTeamId,
        hostChannelId: args.hostChannelId,
        customerChannelId: args.customerChannelId,
      },
    });
    return bindingId;
  },
});

export const bindPrimaryChannelInternal = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    connectionId: v.optional(v.id("slackWorkspaceConnections")),
    operatorUserId: v.id("users"),
    hostTeamId: v.string(),
    hostChannelId: v.string(),
    channelName: v.string(),
  },
  handler: async (ctx, args) => {
    const existing =
      (await ctx.db
        .query("slackChannelBindings")
        .withIndex("client_status", (q) =>
          q.eq("clientOrgId", args.clientOrgId).eq("status", "active"),
        )
        .first()) ??
      (await ctx.db
        .query("slackChannelBindings")
        .withIndex("client_status", (q) =>
          q.eq("clientOrgId", args.clientOrgId).eq("status", "unavailable"),
        )
        .first());
    const now = dayjs().valueOf();
    const sameChannel =
      existing?.hostTeamId === args.hostTeamId &&
      existing.hostChannelId === args.hostChannelId;
    let bindingId: Id<"slackChannelBindings">;
    if (existing && sameChannel) {
      await ctx.db.patch(existing._id, {
        connectionId: args.connectionId,
        channelName: args.channelName,
        status: "active",
        healthStatus: "healthy",
        unavailableReason: undefined,
        healthSource: undefined,
        healthSourceEventKey: undefined,
        providerErrorCode: undefined,
        providerErrorSummary: undefined,
        boundAt: now,
        lastVerifiedAt: now,
        lastHealthyAt: now,
        reconciliationFailureCount: 0,
        updatedAt: now,
      });
      bindingId = existing._id;
    } else {
      if (existing) {
        await ctx.db.patch(existing._id, {
          status: "archived",
          unavailableReason: "operator_rebound",
          updatedAt: now,
        });
      }
      bindingId = await ctx.db.insert("slackChannelBindings", {
        connectionId: args.connectionId,
        clientOrgId: args.clientOrgId,
        kind: "primary",
        hostTeamId: args.hostTeamId,
        hostChannelId: args.hostChannelId,
        channelName: args.channelName,
        status: "active",
        healthStatus: "healthy",
        boundAt: now,
        lastVerifiedAt: now,
        lastHealthyAt: now,
        reconciliationFailureCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "setup_write",
      targetOrgId: args.clientOrgId,
      summary: `Created #${args.channelName} as the primary Slack service channel`,
      metadata: {
        hostTeamId: args.hostTeamId,
        hostChannelId: args.hostChannelId,
      },
    });
    return bindingId;
  },
});

export const syncSlackChannelMembershipsInternal = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    connectionId: v.id("slackWorkspaceConnections"),
    channels: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        isPrivate: v.boolean(),
        isShared: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (
      !connection ||
      connection.status !== "active" ||
      connection.clientOrgId !== args.clientOrgId
    ) {
      throw new Error("The Slack workspace is not connected");
    }
    const now = dayjs().valueOf();
    const activeIds = new Set(args.channels.map((channel) => channel.id));
    const existing = await ctx.db
      .query("slackChannelMemberships")
      .withIndex("connection_status", (q) =>
        q.eq("connectionId", args.connectionId).eq("status", "active"),
      )
      .collect();
    for (const channel of args.channels) {
      const membership = await ctx.db
        .query("slackChannelMemberships")
        .withIndex("connection_channel", (q) =>
          q.eq("connectionId", args.connectionId).eq("channelId", channel.id),
        )
        .first();
      if (membership) {
        await ctx.db.patch(membership._id, {
          channelName: channel.name,
          isPrivate: channel.isPrivate,
          isShared: channel.isShared,
          status: "active",
          lastSyncedAt: now,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("slackChannelMemberships", {
          connectionId: args.connectionId,
          clientOrgId: args.clientOrgId,
          channelId: channel.id,
          channelName: channel.name,
          isPrivate: channel.isPrivate,
          isShared: channel.isShared,
          status: "active",
          lastSyncedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    for (const membership of existing) {
      if (!activeIds.has(membership.channelId)) {
        await ctx.db.patch(membership._id, {
          status: "removed",
          lastSyncedAt: now,
          updatedAt: now,
        });
      }
    }
    const supportChannel =
      (await ctx.db
        .query("slackChannelBindings")
        .withIndex("client_status", (q) =>
          q.eq("clientOrgId", args.clientOrgId).eq("status", "active"),
        )
        .first()) ??
      (await ctx.db
        .query("slackChannelBindings")
        .withIndex("client_status", (q) =>
          q.eq("clientOrgId", args.clientOrgId).eq("status", "unavailable"),
        )
        .first());
    const supportChannelId = supportChannel?.customerChannelId;
    let supportChannelReachable = supportChannel?.status === "active";
    if (supportChannel && supportChannelId) {
      const mappedChannel = args.channels.find(
        (channel) => channel.id === supportChannelId,
      );
      if (!mappedChannel?.isShared) {
        supportChannelReachable = false;
        await ctx.db.patch(supportChannel._id, {
          status: "unavailable",
          healthStatus: "degraded",
          unavailableReason: mappedChannel
            ? "channel_unshared"
            : "channel_not_found",
          healthSource: "reconciliation",
          providerErrorSummary: mappedChannel
            ? "The selected customer channel is no longer shared."
            : "The selected customer channel is no longer visible to Spot.",
          lastVerifiedAt: now,
          updatedAt: now,
        });
      } else if (supportChannel.status === "unavailable") {
        supportChannelReachable = true;
        await ctx.db.patch(supportChannel._id, {
          status: "active",
          healthStatus: "healthy",
          unavailableReason: undefined,
          healthSource: "reconciliation",
          providerErrorCode: undefined,
          providerErrorSummary: undefined,
          lastVerifiedAt: now,
          lastHealthyAt: now,
          reconciliationFailureCount: 0,
          updatedAt: now,
        });
      }
    }
    return {
      supportChannelId: supportChannelReachable ? supportChannelId : undefined,
    };
  },
});

export const selectAutomaticSlackChannelInternal = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    connectionId: v.id("slackWorkspaceConnections"),
    channelId: v.string(),
    channelName: v.string(),
    actorUserId: v.id("users"),
    actorKind: v.union(v.literal("client_admin"), v.literal("operator")),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (
      !connection ||
      connection.status !== "active" ||
      connection.clientOrgId !== args.clientOrgId
    ) {
      throw new Error("The Slack workspace is not connected");
    }
    const membership = await ctx.db
      .query("slackChannelMemberships")
      .withIndex("connection_channel", (q) =>
        q.eq("connectionId", args.connectionId).eq("channelId", args.channelId),
      )
      .first();
    if (!membership || membership.status !== "active") {
      throw new Error("Select a Slack channel that Spot has joined");
    }
    const now = dayjs().valueOf();
    await ctx.db.patch(connection._id, {
      automaticChannelId: args.channelId,
      automaticChannelName: args.channelName,
      automaticChannelRoutingConfiguredAt: now,
      updatedAt: now,
    });
    if (args.actorKind === "operator") {
      await writeOperatorAudit(ctx, {
        operatorUserId: args.actorUserId,
        type: "setup_write",
        targetOrgId: args.clientOrgId,
        summary: `Selected #${args.channelName} for automatic Slack messages`,
        metadata: {
          connectionId: args.connectionId,
          previousChannelId: connection.automaticChannelId,
          channelId: args.channelId,
          previousChannelName: connection.automaticChannelName,
          channelName: args.channelName,
        },
      });
    }
    return connection._id;
  },
});

export const recordSlackChannelJoinedInternal = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    connectionId: v.id("slackWorkspaceConnections"),
    channelId: v.string(),
    channelName: v.string(),
    actorUserId: v.id("users"),
    actorKind: v.union(v.literal("client_admin"), v.literal("operator")),
  },
  handler: async (ctx, args) => {
    if (args.actorKind !== "operator") return;
    await writeOperatorAudit(ctx, {
      operatorUserId: args.actorUserId,
      type: "setup_write",
      targetOrgId: args.clientOrgId,
      summary: `Added Spot to #${args.channelName}`,
      metadata: {
        connectionId: args.connectionId,
        channelId: args.channelId,
      },
    });
  },
});

export const recordSlackChannelLeftInternal = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    connectionId: v.id("slackWorkspaceConnections"),
    channelId: v.string(),
    channelName: v.string(),
    actorUserId: v.id("users"),
    actorKind: v.union(v.literal("client_admin"), v.literal("operator")),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (
      connection?.automaticChannelId === args.channelId &&
      connection.clientOrgId === args.clientOrgId
    ) {
      await ctx.db.patch(connection._id, {
        automaticChannelId: undefined,
        automaticChannelName: undefined,
        updatedAt: dayjs().valueOf(),
      });
    }
    if (args.actorKind !== "operator") return;
    await writeOperatorAudit(ctx, {
      operatorUserId: args.actorUserId,
      type: "setup_write",
      targetOrgId: args.clientOrgId,
      summary: `Removed Spot from #${args.channelName}`,
      metadata: {
        connectionId: args.connectionId,
        channelId: args.channelId,
      },
    });
  },
});

export const disconnectInternal = internalMutation({
  args: {
    connectionId: v.id("slackWorkspaceConnections"),
    actorUserId: v.id("users"),
    actorKind: v.union(v.literal("client_admin"), v.literal("operator")),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.status === "disconnected") return null;
    await deactivateConnection(
      ctx,
      connection,
      "disconnected",
      args.actorKind === "operator"
        ? { updatedByOperatorUserId: args.actorUserId }
        : { updatedByUserId: args.actorUserId },
    );
    if (args.actorKind === "operator") {
      await writeOperatorAudit(ctx, {
        operatorUserId: args.actorUserId,
        type: "setup_write",
        targetOrgId: connection.clientOrgId,
        summary: "Disconnected the client Slack workspace",
        metadata: { teamId: connection.teamId },
      });
    }
    return connection;
  },
});

export const getSlackCredentialsByTeamId = internalQuery({
  args: { teamId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("slackInstallations")
      .withIndex("team_status", (q) =>
        q.eq("teamId", args.teamId).eq("status", "active"),
      )
      .first(),
});

export const updateSlackCredentials = internalMutation({
  args: {
    installationId: v.id("slackInstallations"),
    encryptedBotToken: v.string(),
    encryptedRefreshToken: v.optional(v.string()),
    botTokenExpiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const installation = await ctx.db.get(args.installationId);
    if (!installation || installation.status !== "active") {
      throw new Error("Slack installation is not active");
    }
    await ctx.db.patch(installation._id, {
      encryptedBotToken: args.encryptedBotToken,
      encryptedRefreshToken: args.encryptedRefreshToken,
      botTokenExpiresAt: args.botTokenExpiresAt,
      refreshLeaseExpiresAt: undefined,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const claimSlackCredentialRefresh = internalMutation({
  args: { installationId: v.id("slackInstallations") },
  handler: async (ctx, args) => {
    const installation = await ctx.db.get(args.installationId);
    if (!installation || installation.status !== "active") {
      throw new Error("Slack installation is not active");
    }
    const now = dayjs().valueOf();
    if (
      installation.botTokenExpiresAt &&
      installation.botTokenExpiresAt > dayjs(now).add(5, "minute").valueOf()
    ) {
      return {
        claimed: false as const,
        reason: "fresh" as const,
        installation,
      };
    }
    if (
      installation.refreshLeaseExpiresAt &&
      installation.refreshLeaseExpiresAt > now
    ) {
      return {
        claimed: false as const,
        reason: "in_progress" as const,
        installation,
      };
    }
    await ctx.db.patch(installation._id, {
      refreshLeaseExpiresAt: dayjs(now).add(45, "second").valueOf(),
      updatedAt: now,
    });
    return { claimed: true as const, installation };
  },
});

export const releaseSlackCredentialRefresh = internalMutation({
  args: { installationId: v.id("slackInstallations") },
  handler: async (ctx, args) => {
    const installation = await ctx.db.get(args.installationId);
    if (!installation) return;
    await ctx.db.patch(installation._id, {
      refreshLeaseExpiresAt: undefined,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const getActiveSlackHostInstallation = internalQuery({
  args: {},
  handler: async (ctx) => {
    const teamId = process.env.SLACK_CLARITY_TEAM_ID?.trim();
    if (!teamId) return null;
    const installation = await ctx.db
      .query("slackInstallations")
      .withIndex("team_status", (q) =>
        q.eq("teamId", teamId).eq("status", "active"),
      )
      .first();
    return installation?.kind === "host" ? installation : null;
  },
});

export const getSlackHostStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const configuration = getSlackHostConfiguration();
    const hostTeamId = process.env.SLACK_CLARITY_TEAM_ID?.trim();
    if (configuration.mode === "mock") {
      return { ...configuration, hostTeamId, installation: null };
    }
    if (!configuration.configured || !hostTeamId) {
      return { ...configuration, hostTeamId, installation: null };
    }
    const installation = await ctx.db
      .query("slackInstallations")
      .withIndex("team_status", (q) =>
        q.eq("teamId", hostTeamId).eq("status", "active"),
      )
      .first();
    return {
      ...configuration,
      hostTeamId,
      installation:
        installation?.kind === "host"
          ? {
              teamId: installation.teamId,
              teamName: installation.teamName,
              botUserId: installation.botUserId,
              grantedScopes: installation.grantedScopes,
              updatedAt: installation.updatedAt,
            }
          : null,
    };
  },
});

export const getOperatorImessageStatus = query({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    const enabled = isOperatorImessageInboundEnabled();
    const terminalEnabled = isOperatorImessageTerminalEnabled();
    const contactPhone = getOperatorImessageContactPhone();
    const workerConfigured = Boolean(
      getOperatorImessageWorkerUrl() &&
      process.env.OPERATOR_IMESSAGE_WORKER_SECRET?.trim(),
    );

    return {
      enabled,
      mode: terminalEnabled ? ("terminal" as const) : ("imessage" as const),
      configured:
        enabled &&
        workerConfigured &&
        (terminalEnabled || Boolean(contactPhone)),
      contactPhone: terminalEnabled ? null : (contactPhone ?? null),
      senderPhone: operator.user.phone ?? null,
    };
  },
});

export const getOperatorMcpStatus = query({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    const siteUrl = process.env.CONVEX_SITE_URL?.trim();

    return {
      endpoint: siteUrl ? `${new URL(siteUrl).origin}/mcp` : null,
      environment: process.env.SPOT_ENV?.trim() || null,
      role: operator.profile.role,
    };
  },
});

export const revokeByTeamId = internalMutation({
  args: { teamId: v.string() },
  handler: async (ctx, args) => {
    const installation = await ctx.db
      .query("slackInstallations")
      .withIndex("team_status", (q) =>
        q.eq("teamId", args.teamId).eq("status", "active"),
      )
      .first();
    if (installation) {
      await ctx.db.patch(installation._id, {
        status: "revoked",
        encryptedBotToken: undefined,
        encryptedRefreshToken: undefined,
        botTokenExpiresAt: undefined,
        updatedAt: dayjs().valueOf(),
      });
    }
    const connection = await ctx.db
      .query("slackWorkspaceConnections")
      .withIndex("team_status", (q) =>
        q.eq("teamId", args.teamId).eq("status", "active"),
      )
      .first();
    if (!connection) return installation?._id ?? null;
    await deactivateConnection(ctx, connection, "revoked", {});
    return connection._id;
  },
});

export const authorizeDisconnect = internalQuery({
  args: { clientOrgId: v.id("organizations"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.clientOrgId);
    if (
      !org ||
      org.deletedAt !== undefined ||
      (org.type ?? "client") !== "client"
    ) {
      throw new Error("Client organization not found");
    }
    const actorKind = await setupActorKind(ctx, args.clientOrgId, args.userId);
    if (!actorKind)
      throwUserFacingError(userFacingErrorCodes.clientAdminRequired);
    if (
      actorKind === "operator" &&
      (await getActiveOperatorImpersonation(ctx))
    ) {
      throw new Error(
        "Stop impersonating the client before disconnecting Slack",
      );
    }
    const connection = await retainedConnection(ctx, args.clientOrgId);
    if (!connection) return null;
    return { actorKind, connection };
  },
});

export const authorizeSlackHostSetup = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("operatorProfiles")
      .withIndex("user", (q) => q.eq("userId", args.userId))
      .first();
    return profile?.status === "active";
  },
});
