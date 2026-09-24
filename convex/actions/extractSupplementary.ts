"use node";

/**
 * Run the supplementary extractor on existing policies that were extracted
 * before cl-sdk 0.13. Extracts auxiliary facts for better querying without
 * re-running the full extraction pipeline.
 *
 * NOTE: Intentionally NOT migrated to cl-pipelines. This is a batch backfill
 * operation (not a user-visible upload flow) that runs per-policy in a loop.
 * The UX does not need a live progress banner. Migrating would complicate the
 * backfill scheduling logic without user-visible benefit.
 *
 * Single policy: npx convex run actions/extractSupplementary:extractOne --args '{"policyId": "..."}'
 * All in org:    npx convex run actions/extractSupplementary:extractAll --args '{"orgId": "..."}'
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { chunkDocument, toStrictSchema, withRetry, getPdfPageCount } from "@claritylabs/cl-sdk";
import { policyToInsuranceDoc } from "../lib/documentMapping";
import { makeGenerateObject, makeEmbedText } from "../lib/sdkCallbacks";
import type { Doc, Id } from "../_generated/dataModel";
import { extractPdfPlainText } from "../lib/pdfText";
import { buildSupplementaryPrompt, SupplementarySchema, SUPPLEMENTARY_MAX_TOKENS } from "../lib/supplementaryExtraction";

/**
 * Build a summary of data already captured by structured extractors.
 * Passed to the supplementary prompt so the LLM skips duplicates.
 */

function buildAlreadyExtractedSummary(policy: any): string {
  const lines: string[] = [];

  // Core identity
  if (policy.carrier) lines.push(`carrier: ${policy.carrier}`);
  if (policy.security) lines.push(`security: ${policy.security}`);
  if (policy.insuredName) lines.push(`insured_name: ${policy.insuredName}`);
  if (policy.policyNumber) lines.push(`policy_number: ${policy.policyNumber}`);
  if (policy.effectiveDate) lines.push(`effective_date: ${policy.effectiveDate}`);
  if (policy.expirationDate) lines.push(`expiration_date: ${policy.expirationDate}`);
  if (policy.premium) lines.push(`premium: ${policy.premium}`);

  // Insured details
  if (policy.insuredDba) lines.push(`insured_dba: ${policy.insuredDba}`);
  if (policy.insuredFein) lines.push(`insured_fein: ${policy.insuredFein}`);
  if (policy.insuredAddress) {
    const a = policy.insuredAddress;
    lines.push(`insured_address: ${[a.street1, a.city, a.state, a.zip].filter(Boolean).join(", ")}`);
  }

  // Broker / General Agent
  if (policy.brokerAgency || policy.broker) lines.push(`broker: ${policy.brokerAgency || policy.broker}`);
  if (policy.generalAgent?.agencyName) {
    lines.push(`general_agent: ${policy.generalAgent.agencyName}`);
  } else if (policy.mga) {
    lines.push(`general_agent: ${policy.mga}`);
  }
  if (policy.underwriter) lines.push(`underwriter: ${policy.underwriter}`);

  // Coverages — limits and deductibles
  if (policy.coverages?.length) {
    for (const cov of policy.coverages) {
      const parts = [cov.name];
      if (cov.limit) parts.push(`limit: ${cov.limit}`);
      if (cov.deductible) parts.push(`deductible: ${cov.deductible}`);
      lines.push(`coverage: ${parts.join(", ")}`);
    }
  }

  // Locations
  if (policy.locations?.length) {
    for (const loc of policy.locations) {
      const addr = loc.address;
      if (addr) {
        lines.push(`location: #${loc.number} ${[addr.street1, addr.city, addr.state, addr.zip].filter(Boolean).join(", ")}`);
      }
    }
  }

  if (lines.length === 0) return "";

  return [
    "The following information has ALREADY been extracted by other extractors.",
    "Do NOT include any of these facts in your output — only extract NEW information not listed here:",
    "",
    ...lines,
  ].join("\n");
}

/**
 * Run supplementary extraction on a single policy.
 * Requires the policy to have a stored PDF file.
 */
export const extractOne = internalAction({
  args: {
    policyId: v.id("policies"),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ skipped?: boolean; reason?: string; policyId?: string; facts: number; chunks?: number }> => {

    const policy = await ctx.runQuery(internal.policies.getInternal, {
      id: args.policyId,
    }) as any;
    if (!policy) throw new Error("Policy not found");
    if (!policy.orgId) throw new Error("Policy has no orgId");
    if (!policy.fileId) throw new Error("Policy has no stored PDF");
    if (policy.supplementaryFacts?.length && !args.force) {
      return { skipped: true, reason: "already_has_facts", facts: 0 };
    }

    const blob = await ctx.storage.get(policy.fileId as Id<"_storage">);
    if (!blob) throw new Error("PDF file not found in storage");

    const arrayBuffer = await blob.arrayBuffer();
    const pdfBase64: string = Buffer.from(arrayBuffer).toString("base64");

    const generateObject = makeGenerateObject("extraction", {
      ctx,
      orgId: policy.orgId as Id<"organizations">,
    });
    const parsedPdfText = await extractPdfPlainText({
      pdfBytes: new Uint8Array(arrayBuffer),
      documentId: String(args.policyId),
      sourceKind: "policy_pdf",
    });

    // Build dedup context so the LLM skips already-extracted data
    const alreadyExtracted = buildAlreadyExtractedSummary(policy);
    const prompt = parsedPdfText
      ? `${buildSupplementaryPrompt(alreadyExtracted || undefined)}\n\n[Document text]\n${parsedPdfText}`
      : `${buildSupplementaryPrompt(alreadyExtracted || undefined)}\n\n[Document pages 1-${await getPdfPageCount(pdfBase64)} are provided as a PDF file.]`;
    const strictSchema = toStrictSchema(SupplementarySchema);

    const result: { object: unknown; usage?: unknown } = await withRetry(() =>
      generateObject({
        prompt,
        schema: strictSchema,
        maxTokens: SUPPLEMENTARY_MAX_TOKENS,
        providerOptions: parsedPdfText ? { parsedPdfText } : { pdfBase64 },
      }),
    );

    const facts: unknown[] = (result.object as Record<string, unknown>)?.auxiliaryFacts as unknown[] ?? [];
    if (facts.length === 0) {
      return { policyId: args.policyId, facts: 0 };
    }

    // Store supplementary facts on the policy
    await ctx.runMutation(internal.policies.updateExtractionInternal, {
      id: args.policyId,
      fields: { supplementaryFacts: facts },
    });

    // Re-chunk to include supplementary chunks in vector search
    if (policy.orgId) {
      // Delete existing supplementary chunks (if any from a prior run)
      const existingChunks = await ctx.runQuery(
        internal.documentChunks.listByPolicy,
        { policyId: args.policyId },
      );
      const supplementaryChunkIds = existingChunks
        .filter((c: { chunkType?: string }) => c.chunkType === "supplementary")
        .map((c: { _id: Id<"documentChunks"> }) => c._id);
      for (const id of supplementaryChunkIds) {
        await ctx.runMutation(internal.documentChunks.deleteOne, { id });
      }

      // Generate and embed new supplementary chunks
      const doc = policyToInsuranceDoc({
        ...policy,
        supplementaryFacts: facts,

      } as any);
      const allChunks = chunkDocument(doc);
      const newChunks = allChunks.filter((c) => c.type === "supplementary");

      if (newChunks.length > 0) {
        const embed = makeEmbedText(ctx, policy.orgId as Id<"organizations">);
        for (const chunk of newChunks) {
          const embedding = await embed(chunk.text);
          await ctx.runMutation(internal.documentChunks.insert, {
            orgId: policy.orgId as Id<"organizations">,
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

      return { policyId: args.policyId, facts: facts.length, chunks: newChunks.length };
    }

    return { policyId: args.policyId, facts: facts.length, chunks: 0 };
  },
});

/**
 * Backfill supplementary extraction for all policies in an organization.
 * Skips policies that already have supplementary facts or have no stored PDF.
 */
export const extractAll = internalAction({
  args: {
    orgId: v.id("organizations"),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 5;

    const policies = await ctx.runQuery(internal.policies.listAllInternal, {
      orgId: args.orgId,
    });
    const allDocs = policies.filter(
      (p: Doc<"policies">) =>
        p.fileId && !p.supplementaryFacts?.length && p.pipelineStatus === "complete",
    );

    console.log(`Supplementary backfill: ${allDocs.length} policies to process for org ${args.orgId}`);

    let processed = 0;
    let totalFacts = 0;
    let skipped = 0;

    for (const policy of allDocs) {
      try {
        const result = await ctx.runAction(internal.actions.extractSupplementary.extractOne, {
          policyId: policy._id,
        });
        const r = result as { skipped?: boolean; facts?: number };
        if (r.skipped) {
          skipped++;
        } else {
          processed++;
          totalFacts += r.facts ?? 0;
          console.log(
            `Supplementary: ${processed}/${allDocs.length} — ${policy.carrier} #${policy.policyNumber} → ${r.facts} facts`,
          );
        }
      } catch (err: unknown) {
        console.error(`Supplementary: failed for ${policy._id}: ${err instanceof Error ? err.message : String(err)}`);
        skipped++;
      }

      if (processed > 0 && processed % batchSize === 0) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    console.log(`Supplementary backfill complete: ${processed} processed, ${totalFacts} facts, ${skipped} skipped`);
    return { processed, totalFacts, skipped };
  },
});
