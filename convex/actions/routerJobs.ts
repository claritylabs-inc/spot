"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  cancelDurableRouterRequest,
  executeDurableRouterRequest,
  RouterJobPending,
} from "../lib/routerJobClient";

export const cancel = internalAction({
  args: { invocationKey: v.string() },
  handler: (ctx, args) => cancelDurableRouterRequest(ctx, args.invocationKey),
});

export const worker = internalAction({
  args: {
    jobKind: v.union(
      v.literal("policy"),
      v.literal("preview"),
      v.literal("proposal"),
    ),
    jobId: v.string(),
    leaseId: v.string(),
    orgId: v.id("organizations"),
    invocationKey: v.string(),
    payload: v.any(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { pending: true }
    | { result: unknown }
    | { status: "failed"; error: string; statusCode: 403 | 422 }
  > => {
    const { jobKind, jobId, leaseId, orgId } = args;
    const lease = await ctx.runQuery(
      internal.routerAssets.validateWorkerLease,
      { jobKind, jobId, leaseId, orgId },
    );
    if (lease.leaseExpiresAt === null)
      return {
        status: "failed",
        error: "Inactive extraction lease",
        statusCode: 403,
      };
    if (
      !args.invocationKey ||
      args.invocationKey.length > 300 ||
      !args.payload ||
      args.payload.orgId !== orgId
    )
      return {
        status: "failed",
        error: "Invalid worker router invocation",
        statusCode: 422,
      };
    try {
      const result = await executeDurableRouterRequest(
        ctx,
        "generate",
        args.payload,
        `worker:${jobKind}:${jobId}:${args.invocationKey}`,
      );
      const current = await ctx.runQuery(
        internal.routerAssets.validateWorkerLease,
        { jobKind, jobId, leaseId, orgId },
      );
      if (current.leaseExpiresAt === null)
        return {
          status: "failed",
          error: "Inactive extraction lease",
          statusCode: 403,
        };
      return { result };
    } catch (error) {
      if (error instanceof RouterJobPending) return { pending: true };
      const row = await ctx.runQuery(internal.routerJobs.get, {
        invocationKey: `worker:${jobKind}:${jobId}:${args.invocationKey}`,
      });
      return {
        status: "failed",
        error: row?.error ?? "Router request could not be completed",
        statusCode: 422,
      };
    }
  },
});
