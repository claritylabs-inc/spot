"use node";

import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  normalizePublicWebsiteUrl,
  storeWebsiteFavicon,
} from "../lib/websiteBrand";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "../lib/userFacingErrors";

type OrgLogoImportResult =
  | { success: true; iconStorageId: Id<"_storage">; error?: undefined }
  | { success: false; iconStorageId?: undefined; error: string };

type CompanyResearchRequestResult = {
  success: true;
  queued: boolean;
  status: NonNullable<Doc<"organizations">["companyResearch"]>["status"];
};

async function storeFaviconForOrg(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  url: string,
) {
  const iconStorageId = await storeWebsiteFavicon(ctx, url);
  if (!iconStorageId) return null;
  await ctx.runMutation(internal.orgs.setIconInternal, {
    orgId,
    iconStorageId,
  });
  return iconStorageId;
}

async function importOrgLogoForOrg(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  rawUrl: string,
): Promise<OrgLogoImportResult> {
  const url = normalizePublicWebsiteUrl(rawUrl);
  if (!url)
    return { success: false, error: "Website URL is required" } as const;
  const iconStorageId = await storeFaviconForOrg(ctx, orgId, url);
  if (!iconStorageId) {
    return {
      success: false,
      error: "Could not find a logo for this website",
    } as const;
  }
  return { success: true, iconStorageId } as const;
}

async function resolveTargetOrgId(
  ctx: ActionCtx,
  orgId: Id<"organizations"> | undefined,
): Promise<Id<"organizations">> {
  const viewer = await ctx.runQuery(api.users.viewer);
  if (!viewer) throwUserFacingError(userFacingErrorCodes.authRequired);
  const viewerOrg: { org: { _id: Id<"organizations"> } } | null =
    await ctx.runQuery(api.orgs.viewerOrg, {});
  const targetOrgId = orgId ?? viewerOrg?.org?._id;
  if (!targetOrgId) throw new Error("Organization not found");
  if (orgId && orgId !== viewerOrg?.org?._id) {
    const hasMembership = await ctx.runQuery(
      internal.orgs.hasMembershipInternal,
      {
        userId: viewer._id,
        orgId,
      },
    );
    if (!hasMembership) {
      throwUserFacingError(
        userFacingErrorCodes.orgAccessRequired,
        "You don’t have access to update this organization.",
      );
    }
  }
  return targetOrgId;
}

export const extractCompanyInfo = action({
  args: { url: v.optional(v.string()), orgId: v.optional(v.id("organizations")) },
  returns: v.any(),
  handler: async (ctx, args): Promise<CompanyResearchRequestResult> => {
    const targetOrgId = await resolveTargetOrgId(ctx, args.orgId);
    const viewer = await ctx.runQuery(api.users.viewer);
    if (!viewer) throwUserFacingError(userFacingErrorCodes.authRequired);
    return await ctx.runMutation(internal.companyResearch.requestForUser, { orgId: targetOrgId, userId: viewer._id });
  },
});

export const importOrgLogoFromWebsite = action({
  args: { url: v.string(), orgId: v.optional(v.id("organizations")) },
  returns: v.object({
    success: v.boolean(),
    iconStorageId: v.optional(v.id("_storage")),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<OrgLogoImportResult> => {
    const targetOrgId = await resolveTargetOrgId(ctx, args.orgId);
    return await importOrgLogoForOrg(ctx, targetOrgId, args.url);
  },
});

export const importOrgLogoForOrgInternal = internalAction({
  args: { url: v.string(), orgId: v.id("organizations") },
  returns: v.object({
    success: v.boolean(),
    iconStorageId: v.optional(v.id("_storage")),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<OrgLogoImportResult> => {
    return await importOrgLogoForOrg(ctx, args.orgId, args.url);
  },
});

export const extractCompanyInfoForOrgInternal = internalAction({
  args: { url: v.optional(v.string()), orgId: v.id("organizations") },
  returns: v.any(),
  handler: async (ctx, args): Promise<CompanyResearchRequestResult> => {
    return await ctx.runMutation(internal.companyResearch.request, { orgId: args.orgId });
  },
});
