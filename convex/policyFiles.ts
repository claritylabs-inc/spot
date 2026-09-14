import dayjs from "dayjs";
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { makePipelineMutations } from "./lib/pipelineMutations";

export const listByPolicyInternal = internalQuery({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("policyFiles")
      .withIndex("policy", (idx) => idx.eq("policyId", args.policyId))
      .collect();
  },
});

export const insert = internalMutation({
  args: {
    policyId: v.id("policies"),
    fileId: v.id("_storage"),
    emailId: v.optional(v.id("emails")),
    fileName: v.string(),
    fileType: v.union(
      v.literal("declaration"),
      v.literal("wording"),
      v.literal("endorsement"),
      v.literal("schedule"),
      v.literal("renewal"),
      v.literal("certificate"),
      v.literal("unknown"),
    ),
    pageCount: v.optional(v.number()),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("policyFiles", {
      ...args,
      createdAt: dayjs().valueOf(),
    });
  },
});

export const remove = internalMutation({
  args: { id: v.id("policyFiles") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

// ── cl-pipelines contract mutations for policyFiles ────────────────────────────
const _policyFilesPipeline = makePipelineMutations("policyFiles");
export const pipelineGetJob = _policyFilesPipeline.getJob;
export const pipelineSetStatus = _policyFilesPipeline.setStatus;
export const pipelineSetCheckpoint = _policyFilesPipeline.setCheckpoint;
export const pipelineAppendLog = _policyFilesPipeline.appendLog;
export const pipelineClearLog = _policyFilesPipeline.clearLog;
