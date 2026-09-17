import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  declarationFactHash,
  extractDeclarationFactsFromPolicy,
} from "./lib/declarationFacts";

type PersistedFactValue = {
  fieldPath: string;
  fieldGroup: string;
  displayValue: string;
  normalizedValue: string;
  structuredValue?: unknown;
  valueKind: string;
  sourceNodeIds?: string[];
  sourceSpanIds?: string[];
  effectiveDate?: string;
  expirationDate?: string;
  policyYear?: number;
  recordHash: string;
};

function persistedFactValue(fact: PersistedFactValue): PersistedFactValue {
  return {
    fieldPath: fact.fieldPath,
    fieldGroup: fact.fieldGroup,
    displayValue: fact.displayValue,
    normalizedValue: fact.normalizedValue,
    valueKind: fact.valueKind,
    recordHash: fact.recordHash,
    ...(fact.structuredValue !== undefined ? { structuredValue: fact.structuredValue } : {}),
    ...(fact.sourceNodeIds !== undefined ? { sourceNodeIds: fact.sourceNodeIds } : {}),
    ...(fact.sourceSpanIds !== undefined ? { sourceSpanIds: fact.sourceSpanIds } : {}),
    ...(fact.effectiveDate !== undefined ? { effectiveDate: fact.effectiveDate } : {}),
    ...(fact.expirationDate !== undefined ? { expirationDate: fact.expirationDate } : {}),
    ...(fact.policyYear !== undefined ? { policyYear: fact.policyYear } : {}),
  };
}

function factSetSignature(facts: PersistedFactValue[]) {
  return JSON.stringify(
    facts
      .map(persistedFactValue)
      .sort((left, right) => left.recordHash.localeCompare(right.recordHash)),
  );
}

export async function replacePolicyDeclarationFacts(
  ctx: MutationCtx,
  policyId: Id<"policies">,
  observedAt = dayjs().valueOf(),
) {
  const policy = await ctx.db.get(policyId);
  if (!policy?.orgId) {
    return { inserted: 0, deactivated: 0, unchanged: true };
  }

  const existingActive = await ctx.db
    .query("policyDeclarationFacts")
    .withIndex("policy_active", (q) => q.eq("policyId", policyId).eq("active", true))
    .collect();
  const facts = policy.deletedAt
    ? []
    : extractDeclarationFactsFromPolicy(policy as unknown as Record<string, unknown>)
      .map((fact) => ({
        ...fact,
        recordHash: declarationFactHash({
          policyId: String(policyId),
          fieldPath: fact.fieldPath,
          normalizedValue: fact.normalizedValue,
        }),
      }));

  const unchanged = factSetSignature(existingActive) === factSetSignature(facts);
  let deactivated = 0;
  let inserted = 0;
  if (!unchanged) {
    for (const fact of existingActive) {
      await ctx.db.patch(fact._id, { active: false });
      deactivated += 1;
    }
    for (const fact of facts) {
      await ctx.db.insert("policyDeclarationFacts", {
        orgId: policy.orgId,
        policyId,
        policyFileId: fact.policyFileId as Id<"policyFiles"> | undefined,
        ...persistedFactValue(fact),
        valueKind: fact.valueKind,
        observedAt,
        active: true,
      });
      inserted += 1;
    }
  }

  return { inserted, deactivated, unchanged };
}

export const syncPolicyInternal = internalMutation({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    return await replacePolicyDeclarationFacts(ctx, args.policyId);
  },
});
