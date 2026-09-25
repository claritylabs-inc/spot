"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, type ActionCtx } from "../_generated/server";
import { buildAgentToolExecutors } from "../lib/agentToolExecutors";
import {
  isTenantMcpEmailTool,
  resolveTenantMcpToolCall,
} from "../lib/tenantMcpToolCatalog";
import { executeMcpEmailTool } from "./emailDrafts";
import type { Id } from "../_generated/dataModel";
import {
  toCertificateDto,
  toCertificateHolderDto,
  toCertificateVersionDto,
  toMcpMyPolicyDto,
  toPolicyStatsDto,
  type McpPolicySummarySource,
} from "../lib/apiDto";

export async function executeTenantMcpTool(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    userId: Id<"users">;
    name: string;
    input: Record<string, unknown>;
    canWrite: boolean;
  },
): Promise<unknown> {
  const call = resolveTenantMcpToolCall(args.name, args.input, args.canWrite);
  const input = call.input as Record<string, unknown>;
  if (call.compatibility || !call.sharedName) {
    throw new Error(`Unknown shared tenant tool: ${args.name}`);
  }
  if (isTenantMcpEmailTool(args.name)) {
    return await executeMcpEmailTool(ctx, args);
  }
  const scope = await ctx.runQuery(internal.lib.agentScope.resolveForAction, {
    orgId: args.orgId,
    userId: args.userId,
    surface: "mcp",
  });
  const tools = buildAgentToolExecutors(ctx, {
    surface: "mcp",
    orgId: args.orgId,
    userId: args.userId,
    scope,
    canWrite: args.canWrite,
    mailboxCoordinator: { routingParentId: crypto.randomUUID() },
    webResearch: true,
  });
  if (call.retiredAlias) {
    if (args.name === "get_policy_stats" || args.name === "list_my_policies") {
      const policies = await ctx.runQuery(
        internal.policies.listAllPreviewReadableInternal,
        { orgId: args.orgId },
      );
      return args.name === "get_policy_stats"
        ? toPolicyStatsDto(policies as McpPolicySummarySource[])
        : (policies as McpPolicySummarySource[]).map(toMcpMyPolicyDto);
    }
    if (args.name === "get_org_info") {
      const org = await ctx.runQuery(internal.orgs.getInternal, {
        id: args.orgId,
      });
      if (!org) throw new Error("Not found");
      return { _id: org._id, name: org.name, website: org.website };
    }
    if (args.name === "read_company_wiki")
      return await ctx.runQuery(internal.orgWiki.getForMcp, {
        orgId: args.orgId,
        userId: args.userId,
      });
    if (args.name === "list_client_files") {
      const requestedOrgId = input.orgId as string | undefined;
      const orgIds = requestedOrgId
        ? scope.readOrgIds.filter((orgId) => String(orgId) === requestedOrgId)
        : scope.readOrgIds;
      if (requestedOrgId && orgIds.length === 0)
        throw new Error("Client organization is not in the readable scope");
      return await ctx.runQuery(internal.clientFiles.listVisibleInternal, {
        orgIds,
        query: input.query as string | undefined,
        limit: input.limit as number | undefined,
      });
    }
    if (args.name === "get_client_file") {
      const file = await ctx.runQuery(internal.clientFiles.getVisibleInternal, {
        clientFileId: args.input.client_file_id as Id<"clientFiles">,
        orgIds: scope.readOrgIds,
      });
      if (!file) throw new Error("Client file not found");
      return file;
    }
    if (args.name === "list_insurance_requirements")
      return await ctx.runQuery(internal.compliance.listRequirementsInternal, {
        orgId: args.orgId,
      });
    if (args.name === "list_policy_certificates") {
      const policyId = input.policyId;
      if (typeof policyId !== "string" || !policyId)
        throw new Error("Missing policyId parameter");
      const rows = await ctx.runQuery(
        internal.certificates.listByPolicyInternal,
        {
          orgId: args.orgId,
          policyId: policyId as Id<"policies">,
        },
      );
      return rows.map(toCertificateDto);
    }
    if (args.name === "list_certificate_holders") {
      const holders = await ctx.runQuery(
        internal.certificateHolders.listForOrgInternal,
        {
          orgId: args.orgId,
          query: input.holderQuery as string | undefined,
        },
      );
      return holders.map(toCertificateHolderDto);
    }
    if (args.name === "list_certificate_versions") {
      const versions = await ctx.runQuery(
        internal.certificateLifecycle.listVersionsInternal,
        {
          orgId: args.orgId,
          policyId: input.policyId as Id<"policies"> | undefined,
          certificateId: input.certificateId as
            | Id<"policyCertificates">
            | undefined,
          holderId: input.holderId as Id<"certificateHolders"> | undefined,
        },
      );
      return versions.map(toCertificateVersionDto);
    }
    if (args.name === "generate_policy_certificate") {
      const requirementsMode = Boolean(
        input.requirementSourceDocumentId || input.requirementId,
      );
      if (Boolean(input.policyId) === requirementsMode)
        throw new Error("Choose either policyId or a requirement source");
      if (!requirementsMode && !input.certificateHolder)
        throw new Error("Missing certificate holder");
      const batch = await ctx.runAction(
        internal.certificates.generateBatchForOrg,
        {
          orgId: args.orgId,
          primaryPolicyId: input.policyId as Id<"policies"> | undefined,
          requirementSourceDocumentId: input.requirementSourceDocumentId as
            | Id<"requirementSourceDocuments">
            | undefined,
          requirementId: input.requirementId as
            | Id<"insuranceRequirements">
            | undefined,
          holderName: input.certificateHolder as string,
          holderContactName: input.holderContactName as string | undefined,
          holderEmail: input.holderEmail as string | undefined,
          holderPhone: input.holderPhone as string | undefined,
          addressLine1: input.addressLine1 as string | undefined,
          addressLine2: input.addressLine2 as string | undefined,
          city: input.city as string | undefined,
          state: input.state as string | undefined,
          postalCode: input.postalCode as string | undefined,
          country: input.country as string | undefined,
          requestText: input.requestText as string | undefined,
          descriptionOfOperations: input.descriptionOfOperations as
            | string
            | undefined,
          requestedEndorsements: input.requestedEndorsements as
            | string[]
            | undefined,
          additionalInsuredName: input.additionalInsuredName as
            | string
            | undefined,
          forceReissue: input.explicitReissue === true,
          source: "mcp",
          createdByUserId: args.userId,
        },
      );
      return requirementsMode || batch.results.length !== 1
        ? batch
        : batch.results[0];
    }
  }
  const selected = tools[call.sharedName as keyof typeof tools];
  if (!selected?.execute)
    throw new Error(`Unknown shared tenant tool: ${args.name}`);
  const parsed = (
    selected.inputSchema as { parse: (value: unknown) => unknown }
  ).parse(call.input);
  const result = await selected.execute(parsed as never);
  return result as unknown;
}

export const execute = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    name: v.string(),
    input: v.any(),
    canWrite: v.boolean(),
  },
  handler: executeTenantMcpTool,
});
