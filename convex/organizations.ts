import { v } from "convex/values";
import { mutation, internalQuery } from "./_generated/server";
import { getOrgAccess, type OrgAccess } from "./lib/access";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";

function assertCanManageOwnOrg(access: OrgAccess) {
  if (access.accessType !== "member" || access.role !== "admin") {
    throwUserFacingError(userFacingErrorCodes.orgAdminRequired);
  }
}

export const updateOrgLogo = mutation({
  args: {
    orgId: v.id("organizations"),
    logoStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.orgId);
    assertCanManageOwnOrg(access);
    if (
      access.org.iconStorageId &&
      access.org.iconStorageId !== args.logoStorageId
    ) {
      await ctx.storage.delete(access.org.iconStorageId).catch(() => {});
    }
    await ctx.db.patch(args.orgId, { iconStorageId: args.logoStorageId });
  },
});

export const generateOrgLogoUploadUrl = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.orgId);
    assertCanManageOwnOrg(access);
    return ctx.storage.generateUploadUrl();
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("organizations") },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.id);
    return org?.deletedAt === undefined ? org : null;
  },
});

export const listMembershipsForOrg = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) =>
    ctx.db
      .query("orgMemberships")
      .withIndex("organization", (q) => q.eq("orgId", args.orgId))
      .collect(),
});
