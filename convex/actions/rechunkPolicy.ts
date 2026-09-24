"use node";

/**
 * Re-chunk existing policies using the latest cl-sdk chunking logic.
 * Does NOT re-extract — uses already-extracted data from the policies table.
 *
 * Single policy: npx convex run actions/rechunkPolicy:rechunkOne --args '{"policyId": "..."}'
 * All in org:    npx convex run actions/rechunkPolicy:rechunkAll --args '{"orgId": "..."}'
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { chunkDocument } from "@claritylabs/cl-sdk";
import type { Doc, Id } from "../_generated/dataModel";
import { policyToInsuranceDoc } from "../lib/documentMapping";
import { makeEmbedText } from "../lib/sdkCallbacks";

/**
 * Re-chunk a single policy: delete old chunks, generate new ones, embed & store.
 */
export const rechunkOne = internalAction({
  args: {
    policyId: v.id("policies"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args): Promise<{ policyId: string; oldChunks: number; newChunks: number }> => {
    const policy = await ctx.runQuery(internal.policies.getInternal, {
      id: args.policyId,
    });
    if (!policy) throw new Error("Policy not found");

    // Convert to InsuranceDocument and re-chunk
    const doc = policyToInsuranceDoc(policy);
    const chunks = chunkDocument(doc);

    // Delete all existing chunks for this policy
    const existing = await ctx.runQuery(
      internal.documentChunks.listByPolicy,
      { policyId: args.policyId },
    ) as Array<{ _id: Id<"documentChunks"> }>;
    for (const chunk of existing) {
      await ctx.runMutation(internal.documentChunks.deleteOne, { id: chunk._id });
    }

    // Embed and store new chunks
    if (chunks.length > 0) {
      const embed = makeEmbedText(ctx, args.orgId);
      for (const chunk of chunks) {
        const embedding = await embed(chunk.text);
        await ctx.runMutation(internal.documentChunks.insert, {
          orgId: args.orgId,
          policyId: args.policyId,
          chunkId: chunk.id,
          chunkType: chunk.type,
          text: chunk.text,
          metadata: chunk.metadata,
          embedding,
          createdAt: Date.now(),
        });
      }
    }

    return { policyId: args.policyId as string, oldChunks: existing.length, newChunks: chunks.length };
  },
});

/**
 * Re-chunk all complete policies in an organization.
 */
export const rechunkAll = internalAction({
  args: {
    orgId: v.id("organizations"),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 10;

    const policies = await ctx.runQuery(internal.policies.listAllInternal, {
      orgId: args.orgId,
    });
    const allDocs = policies.filter(
      (p: Doc<"policies">) => p.pipelineStatus === "complete",
    );

    console.log(`Re-chunk: ${allDocs.length} policies to process for org ${args.orgId}`);

    let processed = 0;
    let totalOld = 0;
    let totalNew = 0;

    for (const policy of allDocs) {
      try {
        const result = await ctx.runAction(internal.actions.rechunkPolicy.rechunkOne, {
          policyId: policy._id,
          orgId: args.orgId,
        }) as { oldChunks: number; newChunks: number };
        processed++;
        totalOld += result.oldChunks;
        totalNew += result.newChunks;
        console.log(
          `Re-chunk: ${processed}/${allDocs.length} — ${policy.carrier} #${policy.policyNumber}: ${result.oldChunks} → ${result.newChunks} chunks`,
        );
      } catch (err: unknown) {
        console.error(`Re-chunk: failed for ${policy._id}: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (processed > 0 && processed % batchSize === 0) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    console.log(`Re-chunk complete: ${processed} processed, ${totalOld} old → ${totalNew} new chunks`);
    return { processed, totalOld, totalNew };
  },
});
