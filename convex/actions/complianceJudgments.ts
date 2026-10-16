"use node";

import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
  computeComplianceJudgmentsRef,
  getContextRef,
  ownersForSubjectRef,
  requirementOwnerRef,
  requirementPageRef,
  saveJudgmentRef,
  subjectPageRef,
  type ComputeComplianceArgs,
} from "../complianceJudgments";
import { complianceJudgmentPlan } from "../lib/complianceCheck";
import { clRouterDecide, runWithPayloadSplitting } from "../lib/clRouterClient";
import { jevChoiceConfidence, jevProceeds } from "../lib/jevThreshold";

const PAGE_SIZE = 25;
const computeArgs = {
  requirementId: v.optional(v.id("insuranceRequirements")),
  policyId: v.optional(v.id("policies")),
  subjectOrgId: v.id("organizations"),
  force: v.optional(v.boolean()),
};
type PolicyPageArgs = ComputeComplianceArgs & {
  requirementId: Id<"insuranceRequirements">;
  cursor: string | null;
};
type OwnerPageArgs = ComputeComplianceArgs & {
  ownerOrgId: Id<"organizations">;
  cursor: string | null;
};
type SubjectPageArgs = {
  requirementId: Id<"insuranceRequirements">;
  cursor: string | null;
  force?: boolean;
};
const policyPageRef = makeFunctionReference<"action", PolicyPageArgs, null>(
  "actions/complianceJudgments:computePolicyPage",
);
const ownerPageRef = makeFunctionReference<"action", OwnerPageArgs, null>(
  "actions/complianceJudgments:dispatchOwnerRequirements",
);
const subjectsRef = makeFunctionReference<"action", SubjectPageArgs, null>(
  "actions/complianceJudgments:dispatchRequirementSubjects",
);
const backfillRef = makeFunctionReference<
  "action",
  { cursor?: string | null },
  null
>("actions/complianceJudgments:backfill");

async function computePage(
  ctx: ActionCtx,
  args: PolicyPageArgs,
): Promise<null> {
  const context = await ctx.runQuery(getContextRef, {
    requirementId: args.requirementId,
    subjectOrgId: args.subjectOrgId,
    ...(args.policyId ? { policyId: args.policyId } : {}),
    paginationOpts: { cursor: args.cursor, numItems: PAGE_SIZE },
  });
  if (!context) return null;
  const abortSignal = AbortSignal.timeout(75_000);
  const traceId = `compliance:${args.requirementId}:${crypto.randomUUID()}`;
  let parentRequestId: string | undefined;
  for (const [index, policy] of context.policies.entries()) {
    const plan = complianceJudgmentPlan(
      context.requirement,
      policy,
      context.expectedNames,
    );
    const previous = context.judgments[index];
    if (
      !args.force &&
      previous?.inputHash === plan.inputHash &&
      previous.judgedAt > 0 &&
      !previous.error
    )
      continue;
    const answers: Record<string, string | boolean> = {};
    let error: string | undefined;
    try {
      // Resolve the coverage row before paying to classify its limit labels.
      for (let pass = 0; pass < 2; pass += 1) {
        const selected =
          answers.coverage ??
          (!args.force && previous?.inputHash === plan.inputHash
            ? previous.answers.coverage
            : undefined);
        const selectedIndex =
          typeof selected === "string" && /^c\d+$/.test(selected)
            ? Number(selected.slice(1))
            : undefined;
        const current =
          pass === 0
            ? plan
            : complianceJudgmentPlan(
                context.requirement,
                policy,
                context.expectedNames,
                selectedIndex,
              );
        const entries = Object.entries(current.questions).filter(
          ([key]) =>
            pass === 0 ||
            (key.startsWith("limit_") && !(key in plan.questions)),
        );
        for (let offset = 0; offset < entries.length; offset += 128) {
          await runWithPayloadSplitting(
            entries.slice(offset, offset + 128),
            async (part) => {
              const result = await clRouterDecide(
                {
                  orgId: String(context.requirement.orgId),
                  task: "compliance_manual_review",
                  state: current.state,
                  questions: Object.fromEntries(part),
                  trace: {
                    traceId,
                    ...(parentRequestId ? { parentRequestId } : {}),
                  },
                },
                { telemetry: ctx, abortSignal },
              );
              parentRequestId = result.requestId;
              for (const [key, answer] of Object.entries(result.answers)) {
                if (answer.type === "noul") {
                  if (jevProceeds(answer.noul)) answers[key] = true;
                  else if (jevProceeds(1 - answer.noul)) answers[key] = false;
                } else if (
                  answer.type === "choice" &&
                  jevProceeds(jevChoiceConfidence(answer))
                )
                  answers[key] = answer.choice;
              }
            },
          );
        }
      }
    } catch (cause) {
      error =
        cause instanceof Error ? cause.message : "Compliance judgment failed";
    }
    await ctx.runMutation(saveJudgmentRef, {
      requirementId: args.requirementId,
      subjectOrgId: args.subjectOrgId,
      policyId: policy._id,
      inputHash: plan.inputHash,
      answers,
      ...(error ? { error } : {}),
      ...(args.force ? { force: true } : {}),
    });
    if (abortSignal.aborted) {
      for (const remaining of context.policies.slice(index + 1))
        await ctx.scheduler.runAfter(0, computeComplianceJudgmentsRef, {
          requirementId: args.requirementId,
          subjectOrgId: args.subjectOrgId,
          policyId: remaining._id,
          ...(args.force ? { force: true } : {}),
        });
      break;
    }
  }
  if (!context.isDone)
    await ctx.scheduler.runAfter(0, policyPageRef, {
      ...args,
      cursor: context.continueCursor,
    });
  return null;
}

export const computePolicyPage = internalAction({
  args: {
    ...computeArgs,
    requirementId: v.id("insuranceRequirements"),
    cursor: v.union(v.string(), v.null()),
  },
  handler: computePage,
});

export async function computeRequirementJudgments(
  ctx: ActionCtx,
  args: ComputeComplianceArgs,
): Promise<null> {
  if (args.requirementId) {
    const owner = await ctx.runQuery(requirementOwnerRef, {
      requirementId: args.requirementId,
    });
    if (!owner) return null;
    if (owner.scope === "vendors" && owner.orgId === args.subjectOrgId) {
      await ctx.scheduler.runAfter(0, subjectsRef, {
        requirementId: args.requirementId,
        cursor: null,
        ...(args.force ? { force: true } : {}),
      });
      return null;
    }
    return computePage(ctx, {
      ...args,
      requirementId: args.requirementId,
      cursor: null,
    });
  }
  const owners = await ctx.runQuery(ownersForSubjectRef, {
    subjectOrgId: args.subjectOrgId,
  });
  for (const ownerOrgId of owners)
    await ctx.scheduler.runAfter(0, ownerPageRef, {
      ...args,
      ownerOrgId,
      cursor: null,
    });
  return null;
}

export const computeForRequirementPolicies = internalAction({
  args: computeArgs,
  handler: computeRequirementJudgments,
});

export const dispatchOwnerRequirements = internalAction({
  args: {
    ...computeArgs,
    ownerOrgId: v.id("organizations"),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args): Promise<null> => {
    const page = await ctx.runQuery(requirementPageRef, {
      ownerOrgId: args.ownerOrgId,
      paginationOpts: { cursor: args.cursor, numItems: PAGE_SIZE },
    });
    for (const requirement of page.page) {
      if (
        requirement.kind !== "coverage" ||
        requirement.scope !==
          (args.ownerOrgId === args.subjectOrgId ? "own_org" : "vendors")
      )
        continue;
      await ctx.scheduler.runAfter(0, computeComplianceJudgmentsRef, {
        requirementId: requirement._id,
        subjectOrgId: args.subjectOrgId,
        ...(args.policyId ? { policyId: args.policyId } : {}),
        ...(args.force ? { force: true } : {}),
      });
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, ownerPageRef, {
        ...args,
        cursor: page.continueCursor,
      });
    return null;
  },
});

export const dispatchRequirementSubjects = internalAction({
  args: {
    requirementId: v.id("insuranceRequirements"),
    cursor: v.union(v.string(), v.null()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<null> => {
    const page = await ctx.runQuery(subjectPageRef, {
      requirementId: args.requirementId,
      paginationOpts: { cursor: args.cursor, numItems: PAGE_SIZE },
    });
    if (!page) return null;
    for (const subjectOrgId of page.subjects)
      await ctx.scheduler.runAfter(0, policyPageRef, {
        requirementId: args.requirementId,
        subjectOrgId,
        cursor: null,
        ...(args.force ? { force: true } : {}),
      });
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, subjectsRef, {
        ...args,
        cursor: page.continueCursor,
      });
    return null;
  },
});

export const backfill = internalAction({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args): Promise<null> => {
    const page = await ctx.runQuery(requirementPageRef, {
      paginationOpts: { cursor: args.cursor ?? null, numItems: PAGE_SIZE },
    });
    for (const requirement of page.page) {
      if (requirement.kind !== "coverage") continue;
      await ctx.scheduler.runAfter(0, computeComplianceJudgmentsRef, {
        requirementId: requirement._id,
        subjectOrgId: requirement.orgId,
      });
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, backfillRef, {
        cursor: page.continueCursor,
      });
    return null;
  },
});
