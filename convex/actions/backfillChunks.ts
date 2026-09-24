"use node";

/**
 * One-time migration: embed and chunk all existing policies for vector search.
 *
 * Run via: npx convex run actions/backfillChunks:backfill --args '{"orgId": "..."}'
 * Or schedule for all orgs: npx convex run actions/backfillChunks:backfillAll
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { chunkDocument } from "@claritylabs/cl-sdk";
import { policyToInsuranceDoc } from "../lib/documentMapping";
import { makeEmbedText } from "../lib/sdkCallbacks";

/**
 * Backfill chunks for all complete policies in an organization.
 * Skips policies that already have chunks.
 */
export const backfill = internalAction({
  args: {
    orgId: v.id("organizations"),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 10;
    const embed = makeEmbedText(ctx, args.orgId);

    // Load all complete, non-deleted policies for this org
    const policies = await ctx.runQuery(internal.policies.listAllInternal, {
      orgId: args.orgId,
    });

    const allDocs = policies;
    console.log(`Backfill: ${allDocs.length} documents to process for org ${args.orgId}`);

    let processed = 0;
    let chunked = 0;
    let skipped = 0;

    for (const policy of allDocs) {
      // Check if chunks already exist
      const existingChunks = await ctx.runQuery(
        internal.documentChunks.listByPolicy,
        { policyId: policy._id },
      );
      if (existingChunks.length > 0) {
        skipped++;
        continue;
      }

      try {
        // Convert to InsuranceDocument
        const doc = policyToInsuranceDoc(policy);

        // Generate chunks
        const chunks = chunkDocument(doc);
        if (chunks.length === 0) {
          skipped++;
          continue;
        }

        // Embed and store each chunk
        for (const chunk of chunks) {
          const embedding = await embed(chunk.text);
          await ctx.runMutation(internal.documentChunks.insert, {
            orgId: args.orgId,
            policyId: policy._id,
            chunkId: chunk.id,
            chunkType: chunk.type,
            text: chunk.text,
            metadata: chunk.metadata,
            embedding,
            createdAt: Date.now(),
          });
        }

        chunked += chunks.length;
        processed++;
        console.log(`Backfill: ${processed}/${allDocs.length} — ${policy.carrier} #${policy.policyNumber} → ${chunks.length} chunks`);
      } catch (err: unknown) {
        console.error(`Backfill: failed for ${policy._id}: ${err instanceof Error ? err.message : String(err)}`);
        skipped++;
      }

      // Rate limiting: pause between batches to avoid API quota issues
      if (processed > 0 && processed % batchSize === 0) {
        console.log(`Backfill: batch pause after ${processed} documents...`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    console.log(`Backfill complete: ${processed} processed, ${chunked} chunks created, ${skipped} skipped`);
    return { processed, chunked, skipped };
  },
});
