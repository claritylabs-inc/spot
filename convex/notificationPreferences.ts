// convex/notificationPreferences.ts
import { v } from "convex/values";
import dayjs from "dayjs";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireCurrentOrgAccess as requireOrgAccess } from "./lib/access";
import type { Id } from "./_generated/dataModel";
import {
  getEffectiveChannelDefault,
  isProactiveNotificationType,
  PROACTIVE_PREFERENCE_TYPE,
  type NotificationChannel,
  type NotificationSeverity,
} from "./lib/notificationTypes";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";

const channelValidator = v.union(
  v.literal("email"),
  v.literal("imessage"),
);

const ALL_PREFERENCE_TYPE = "__all__";

// ── Shared helpers ──────────────────────────────────────────────────────────

async function upsertPref(
  ctx: MutationCtx,
  userId: Id<"users">,
  orgId: Id<"organizations">,
  type: string,
  channel: NotificationChannel,
  enabled: boolean,
) {
  const existing = await ctx.db
    .query("notificationPreferences")
    .withIndex("preference_scope", (q) =>
      q
        .eq("userId", userId)
        .eq("orgId", orgId)
        .eq("type", type)
        .eq("channel", channel),
    )
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, { enabled, updatedAt: dayjs().valueOf() });
  } else {
    await ctx.db.insert("notificationPreferences", {
      userId,
      orgId,
      type,
      channel,
      enabled,
      updatedAt: dayjs().valueOf(),
    });
  }
}

type PreferenceCtx = MutationCtx | QueryCtx;

async function preferenceForType(
  ctx: PreferenceCtx,
  args: {
    userId: Id<"users">;
    orgId: Id<"organizations">;
    type: string;
    channel: NotificationChannel;
  },
) {
  return await ctx.db
    .query("notificationPreferences")
    .withIndex("preference_scope", (q) =>
      q
        .eq("userId", args.userId)
        .eq("orgId", args.orgId)
        .eq("type", args.type)
        .eq("channel", args.channel),
    )
    .first();
}

export async function findChannelPreferenceOverride(
  ctx: PreferenceCtx,
  args: {
    userId: Id<"users">;
    orgId: Id<"organizations">;
    type: string;
    channel: NotificationChannel;
  },
): Promise<boolean | null> {
  const preferenceTypes = [args.type];
  if (isProactiveNotificationType(args.type)) {
    preferenceTypes.push(PROACTIVE_PREFERENCE_TYPE);
  }
  preferenceTypes.push(ALL_PREFERENCE_TYPE);

  for (const type of new Set(preferenceTypes)) {
    const preference = await preferenceForType(ctx, { ...args, type });
    if (preference) return preference.enabled;
  }
  return null;
}

export async function resolveChannelPreference(
  ctx: PreferenceCtx,
  args: {
    userId: Id<"users">;
    orgId: Id<"organizations">;
    type: string;
    channel: NotificationChannel;
    severity: NotificationSeverity;
  },
): Promise<boolean> {
  const override = await findChannelPreferenceOverride(ctx, args);
  return override ?? getEffectiveChannelDefault(args.channel, args.severity);
}

function assertCurrentOrg(
  currentOrgId: Id<"organizations">,
  requestedOrgId: Id<"organizations">,
) {
  if (currentOrgId !== requestedOrgId) {
    throwUserFacingError(userFacingErrorCodes.orgAccessRequired);
  }
}

// ── Public mutations ────────────────────────────────────────────────────────

export const setChannels = mutation({
  args: {
    orgId: v.id("organizations"),
    type: v.string(),
    email: v.boolean(),
    imessage: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireOrgAccess(ctx);
    assertCurrentOrg(orgId, args.orgId);
    await upsertPref(
      ctx,
      userId,
      args.orgId,
      args.type,
      "email",
      args.email,
    );
    await upsertPref(
      ctx,
      userId,
      args.orgId,
      args.type,
      "imessage",
      args.imessage,
    );
  },
});

export const resetChannels = mutation({
  args: {
    orgId: v.id("organizations"),
    type: v.string(),
    channel: v.optional(channelValidator),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireOrgAccess(ctx);
    assertCurrentOrg(orgId, args.orgId);
    const channels: NotificationChannel[] = args.channel
      ? [args.channel]
      : ["email", "imessage"];
    for (const channel of channels) {
      const preference = await preferenceForType(ctx, {
        userId, orgId, type: args.type, channel,
      });
      if (preference) await ctx.db.delete(preference._id);
    }
  },
});

export const setAllEmail = mutation({
  args: {
    orgId: v.id("organizations"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireOrgAccess(ctx);
    assertCurrentOrg(orgId, args.orgId);
    await upsertPref(
      ctx,
      userId,
      args.orgId,
      ALL_PREFERENCE_TYPE,
      "email",
      args.enabled,
    );
  },
});

export const setAllChannel = mutation({
  args: {
    orgId: v.id("organizations"),
    channel: channelValidator,
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireOrgAccess(ctx);
    assertCurrentOrg(orgId, args.orgId);
    await upsertPref(
      ctx,
      userId,
      args.orgId,
      ALL_PREFERENCE_TYPE,
      args.channel,
      args.enabled,
    );
  },
});

export const setProactiveChannels = mutation({
  args: {
    orgId: v.id("organizations"),
    email: v.boolean(),
    imessage: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireOrgAccess(ctx);
    assertCurrentOrg(orgId, args.orgId);
    if (!args.email && !args.imessage) {
      throw new Error("Choose at least one proactive contact method");
    }
    if (args.imessage) {
      const user = await ctx.db.get(userId);
      if (!user?.phone) {
        throw new Error("Add a mobile number before choosing iMessage");
      }
    }
    await upsertPref(
      ctx,
      userId,
      args.orgId,
      PROACTIVE_PREFERENCE_TYPE,
      "email",
      args.email,
    );
    await upsertPref(
      ctx,
      userId,
      args.orgId,
      PROACTIVE_PREFERENCE_TYPE,
      "imessage",
      args.imessage,
    );
  },
});

export const getForUser = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireOrgAccess(ctx);
    assertCurrentOrg(orgId, args.orgId);
    return await ctx.db
      .query("notificationPreferences")
      .withIndex("user_organization", (q) => q.eq("userId", userId).eq("orgId", args.orgId))
      .collect();
  },
});

export const getProactiveChannels = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireOrgAccess(ctx);
    assertCurrentOrg(orgId, args.orgId);
    const [emailPreference, imessagePreference, email, imessage] = await Promise.all([
      preferenceForType(ctx, {
        userId,
        orgId: args.orgId,
        type: PROACTIVE_PREFERENCE_TYPE,
        channel: "email",
      }),
      preferenceForType(ctx, {
        userId,
        orgId: args.orgId,
        type: PROACTIVE_PREFERENCE_TYPE,
        channel: "imessage",
      }),
      resolveChannelPreference(ctx, {
        userId,
        orgId: args.orgId,
        type: "mailbox_attention",
        channel: "email",
        severity: "warning",
      }),
      resolveChannelPreference(ctx, {
        userId,
        orgId: args.orgId,
        type: "mailbox_attention",
        channel: "imessage",
        severity: "warning",
      }),
    ]);
    return {
      email,
      imessage,
      configured: Boolean(emailPreference || imessagePreference),
    };
  },
});

export const resolveChannelForUser = internalQuery({
  args: {
    userId: v.id("users"),
    orgId: v.id("organizations"),
    type: v.string(),
    channel: channelValidator,
    severity: v.optional(v.union(v.literal("info"), v.literal("warning"), v.literal("critical"))),
  },
  handler: async (ctx, args): Promise<boolean> => {
    return await resolveChannelPreference(ctx, {
      ...args,
      severity: args.severity ?? "info",
    });
  },
});
