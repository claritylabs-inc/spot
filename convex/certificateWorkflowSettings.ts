import dayjs from "dayjs";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assertClientOrg,
  requireCurrentOrgAccess,
  requireCurrentOrgAdminWrite,
  type CurrentOrgAccess,
} from "./lib/access";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";

export const DEFAULT_CERTIFICATE_WORKFLOW_SETTINGS = {
  renewalReissueEnabled: true,
};

type ReadCtx = QueryCtx | MutationCtx;

const settingsArgs = {
  renewalReissueEnabled: v.boolean(),
};

function valuesFromRow(row?: Doc<"certificateWorkflowSettings"> | null) {
  return {
    renewalReissueEnabled:
      row?.renewalReissueEnabled ??
      DEFAULT_CERTIFICATE_WORKFLOW_SETTINGS.renewalReissueEnabled,
  };
}

async function getClientOverride(
  ctx: ReadCtx,
  clientOrgId?: Id<"organizations"> | null,
) {
  if (!clientOrgId) return null;
  return await ctx.db
    .query("certificateWorkflowSettings")
    .withIndex("client", (q) => q.eq("clientOrgId", clientOrgId))
    .first();
}

async function resolveEffectiveForOrg(
  ctx: ReadCtx,
  orgId: Id<"organizations">,
) {
  const org = await ctx.db.get(orgId);
  if (!org) throw new Error("Organization not found");
  const orgType = (org.type ?? "client") as "broker" | "client" | "partner";
  const clientOrgId = orgType === "client" ? orgId : null;
  const clientOverride = await getClientOverride(ctx, clientOrgId);
  const row = clientOverride;
  const source = clientOverride ? "client_override" : "platform_default";
  const values = valuesFromRow(row);
  return {
    ...values,
    source,
    row,
    clientOverride,
    clientOrgId,
  };
}

function assertClientAdmin(access: CurrentOrgAccess) {
  if ((access.org.type ?? "client") !== "client") {
    throwUserFacingError(
      userFacingErrorCodes.orgAccessRequired,
      "Switch to a client organization to manage client certificate settings.",
    );
  }
  if (access.role !== "admin") {
    throwUserFacingError(userFacingErrorCodes.clientAdminRequired);
  }
}

export const getEffectiveForCurrentOrg = query({
  args: {},
  handler: async (ctx) => {
    const access = await requireCurrentOrgAccess(ctx);
    assertClientOrg(access);
    return await resolveEffectiveForOrg(ctx, access.orgId);
  },
});

export const updateClientOverride = mutation({
  args: settingsArgs,
  handler: async (ctx, args) => {
    const access = await requireCurrentOrgAdminWrite(ctx);
    assertClientAdmin(access);
    const now = dayjs().valueOf();
    const patch = {
      clientOrgId: access.orgId,
      renewalReissueEnabled: args.renewalReissueEnabled,
      updatedByUserId: access.userId,
      updatedAt: now,
    };
    const existing = await getClientOverride(ctx, access.orgId);
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("certificateWorkflowSettings", {
      ...patch,
      createdAt: now,
    });
  },
});
