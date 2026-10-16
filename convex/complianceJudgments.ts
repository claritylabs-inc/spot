import dayjs from "dayjs";
import { makeFunctionReference, paginationOptsValidator } from "convex/server";
import type { ApiFromModules, FunctionReturnType } from "convex/server";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  complianceJudgmentInputHash,
  policyReadableForCompliance,
} from "./lib/complianceCheck";

export type ComputeComplianceArgs = {
  requirementId?: Id<"insuranceRequirements">;
  policyId?: Id<"policies">;
  subjectOrgId: Id<"organizations">;
  force?: boolean;
};

export const computeComplianceJudgmentsRef = makeFunctionReference<
  "action",
  ComputeComplianceArgs,
  null
>("actions/complianceJudgments:computeForRequirementPolicies");

export async function loadComplianceJudgments(
  ctx: QueryCtx,
  requirementId: Id<"insuranceRequirements">,
  subjectOrgId: Id<"organizations">,
) {
  return ctx.db
    .query("complianceJudgments")
    .withIndex("requirement_subject_policy", (q) =>
      q.eq("requirementId", requirementId).eq("subjectOrgId", subjectOrgId),
    )
    .collect();
}

async function subjectAllowed(
  ctx: QueryCtx,
  requirement: Doc<"insuranceRequirements">,
  subjectOrgId: Id<"organizations">,
) {
  if (requirement.scope === "own_org")
    return requirement.orgId === subjectOrgId;
  return !!(
    await ctx.db
      .query("connectedOrgRelationships")
      .withIndex("client_vendor", (q) =>
        q.eq("clientOrgId", requirement.orgId).eq("vendorOrgId", subjectOrgId),
      )
      .collect()
  ).find((relationship) => relationship.status === "active");
}

export const getContext = internalQuery({
  args: {
    requirementId: v.id("insuranceRequirements"),
    subjectOrgId: v.id("organizations"),
    policyId: v.optional(v.id("policies")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const requirement = await ctx.db.get(args.requirementId);
    if (
      !requirement ||
      requirement.status !== "active" ||
      requirement.kind !== "coverage" ||
      !(await subjectAllowed(ctx, requirement, args.subjectOrgId))
    )
      return null;
    const org = await ctx.db.get(args.subjectOrgId);
    if (!org) return null;
    const page = args.policyId
      ? {
          page: [await ctx.db.get(args.policyId)].filter(
            (policy): policy is Doc<"policies"> =>
              !!policy && policy.orgId === args.subjectOrgId,
          ),
          isDone: true,
          continueCursor: "",
        }
      : await ctx.db
          .query("policies")
          .withIndex("organization", (q) => q.eq("orgId", args.subjectOrgId))
          .paginate(args.paginationOpts);
    const policies = page.page.filter((policy) =>
      policyReadableForCompliance(policy, true),
    );
    const judgments = await Promise.all(
      policies.map((policy) =>
        ctx.db
          .query("complianceJudgments")
          .withIndex("requirement_subject_policy", (q) =>
            q
              .eq("requirementId", requirement._id)
              .eq("subjectOrgId", args.subjectOrgId)
              .eq("policyId", policy._id),
          )
          .unique(),
      ),
    );
    return {
      requirement,
      expectedNames: org.name ? [org.name] : [],
      policies,
      judgments,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const save = internalMutation({
  args: {
    requirementId: v.id("insuranceRequirements"),
    subjectOrgId: v.id("organizations"),
    policyId: v.id("policies"),
    inputHash: v.string(),
    answers: v.record(v.string(), v.union(v.string(), v.boolean())),
    error: v.optional(v.string()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const [requirement, policy, org] = await Promise.all([
      ctx.db.get(args.requirementId),
      ctx.db.get(args.policyId),
      ctx.db.get(args.subjectOrgId),
    ]);
    if (
      !requirement ||
      requirement.status !== "active" ||
      !policy ||
      policy.orgId !== args.subjectOrgId ||
      !org ||
      !(await subjectAllowed(ctx, requirement, args.subjectOrgId)) ||
      !policyReadableForCompliance(policy, true)
    )
      return;
    if (
      complianceJudgmentInputHash(
        requirement,
        policy,
        org.name ? [org.name] : [],
      ) !== args.inputHash
    )
      return;
    const previous = await ctx.db
      .query("complianceJudgments")
      .withIndex("requirement_subject_policy", (q) =>
        q
          .eq("requirementId", args.requirementId)
          .eq("subjectOrgId", args.subjectOrgId)
          .eq("policyId", args.policyId),
      )
      .unique();
    const now = dayjs().valueOf();
    if (args.error) {
      // Keep the previous hash, answers and judgment time on failed refreshes.
      if (previous)
        await ctx.db.patch(previous._id, {
          error: args.error.slice(0, 1000),
          errorAt: now,
        });
      else
        await ctx.db.insert("complianceJudgments", {
          requirementId: args.requirementId,
          subjectOrgId: args.subjectOrgId,
          policyId: args.policyId,
          inputHash: args.inputHash,
          error: args.error.slice(0, 1000),
          answers: {},
          judgedAt: 0,
          errorAt: now,
        });
      return;
    }
    const value = {
      requirementId: args.requirementId,
      subjectOrgId: args.subjectOrgId,
      policyId: args.policyId,
      inputHash: args.inputHash,
      answers: {
        ...(!args.force && previous?.inputHash === args.inputHash
          ? previous.answers
          : {}),
        ...args.answers,
      },
      judgedAt: now,
      error: undefined,
      errorAt: undefined,
    };
    if (previous) await ctx.db.patch(previous._id, value);
    else await ctx.db.insert("complianceJudgments", value);
  },
});

export const findMissingRequirementJudgments = internalQuery({
  args: {
    ownerOrgId: v.id("organizations"),
    subjectOrgId: v.id("organizations"),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 50)
      throw new Error("Missing judgment batch must contain 1–50 requirements");
    const scope = args.ownerOrgId === args.subjectOrgId ? "own_org" : "vendors";
    if (scope === "vendors") {
      const relationships = await ctx.db
        .query("connectedOrgRelationships")
        .withIndex("client_vendor", (q) =>
          q
            .eq("clientOrgId", args.ownerOrgId)
            .eq("vendorOrgId", args.subjectOrgId),
        )
        .collect();
      if (
        !relationships.some((relationship) => relationship.status === "active")
      )
        return [];
    }
    const policies = (
      await ctx.db
        .query("policies")
        .withIndex("organization", (q) => q.eq("orgId", args.subjectOrgId))
        .collect()
    ).filter((policy) => policyReadableForCompliance(policy, false));
    if (!policies.length) return [];
    const requirementIds: Id<"insuranceRequirements">[] = [];
    for await (const requirement of ctx.db
      .query("insuranceRequirements")
      .withIndex("organization_status", (q) =>
        q.eq("orgId", args.ownerOrgId).eq("status", "active"),
      )) {
      if (requirement.kind !== "coverage" || requirement.scope !== scope)
        continue;
      const judgments = await loadComplianceJudgments(
        ctx,
        requirement._id,
        args.subjectOrgId,
      );
      // Error-only rows (judgedAt 0) still need a successful judgment.
      const knownPolicies = new Set(
        judgments
          .filter((judgment) => judgment.judgedAt > 0)
          .map((judgment) => judgment.policyId),
      );
      if (!policies.some((policy) => !knownPolicies.has(policy._id))) continue;
      requirementIds.push(requirement._id);
      if (requirementIds.length === args.limit) break;
    }
    return requirementIds;
  },
});

export const ownersForSubject = internalQuery({
  args: { subjectOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const relationships = await ctx.db
      .query("connectedOrgRelationships")
      .withIndex("vendor_status", (q) =>
        q.eq("vendorOrgId", args.subjectOrgId).eq("status", "active"),
      )
      .collect();
    return [
      ...new Set([
        args.subjectOrgId,
        ...relationships.map((relationship) => relationship.clientOrgId),
      ]),
    ];
  },
});

export const requirementPage = internalQuery({
  args: {
    ownerOrgId: v.optional(v.id("organizations")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) =>
    args.ownerOrgId
      ? ctx.db
          .query("insuranceRequirements")
          .withIndex("organization_status", (q) =>
            q.eq("orgId", args.ownerOrgId!).eq("status", "active"),
          )
          .paginate(args.paginationOpts)
      : ctx.db
          .query("insuranceRequirements")
          .withIndex("status_scope", (q) => q.eq("status", "active"))
          .paginate(args.paginationOpts),
});

export const subjectPage = internalQuery({
  args: {
    requirementId: v.id("insuranceRequirements"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const requirement = await ctx.db.get(args.requirementId);
    if (
      !requirement ||
      requirement.status !== "active" ||
      requirement.kind !== "coverage"
    )
      return null;
    if (requirement.scope === "own_org")
      return {
        subjects: [requirement.orgId],
        isDone: true,
        continueCursor: "",
      };
    const page = await ctx.db
      .query("connectedOrgRelationships")
      .withIndex("client_status", (q) =>
        q.eq("clientOrgId", requirement.orgId).eq("status", "active"),
      )
      .paginate(args.paginationOpts);
    return {
      subjects: [
        ...new Set(page.page.map((relationship) => relationship.vendorOrgId)),
      ],
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const requirementOwner = internalQuery({
  args: { requirementId: v.id("insuranceRequirements") },
  handler: async (ctx, args) => {
    const requirement = await ctx.db.get(args.requirementId);
    return requirement?.status === "active"
      ? { orgId: requirement.orgId, scope: requirement.scope }
      : null;
  },
});

type JudgmentQueries = ApiFromModules<{
  judgments: {
    getContext: typeof getContext;
    ownersForSubject: typeof ownersForSubject;
    requirementPage: typeof requirementPage;
    subjectPage: typeof subjectPage;
    requirementOwner: typeof requirementOwner;
    findMissingRequirementJudgments: typeof findMissingRequirementJudgments;
  };
}>["judgments"];

export const getContextRef = makeFunctionReference<
  "query",
  {
    requirementId: Id<"insuranceRequirements">;
    subjectOrgId: Id<"organizations">;
    policyId?: Id<"policies">;
    paginationOpts: { cursor: string | null; numItems: number };
  },
  FunctionReturnType<JudgmentQueries["getContext"]>
>("complianceJudgments:getContext");
export const saveJudgmentRef = makeFunctionReference<
  "mutation",
  {
    requirementId: Id<"insuranceRequirements">;
    subjectOrgId: Id<"organizations">;
    policyId: Id<"policies">;
    inputHash: string;
    answers: Record<string, string | boolean>;
    error?: string;
    force?: boolean;
  },
  null
>("complianceJudgments:save");
export const ownersForSubjectRef = makeFunctionReference<
  "query",
  { subjectOrgId: Id<"organizations"> },
  FunctionReturnType<JudgmentQueries["ownersForSubject"]>
>("complianceJudgments:ownersForSubject");
export const requirementPageRef = makeFunctionReference<
  "query",
  {
    ownerOrgId?: Id<"organizations">;
    paginationOpts: { cursor: string | null; numItems: number };
  },
  FunctionReturnType<JudgmentQueries["requirementPage"]>
>("complianceJudgments:requirementPage");
export const subjectPageRef = makeFunctionReference<
  "query",
  {
    requirementId: Id<"insuranceRequirements">;
    paginationOpts: { cursor: string | null; numItems: number };
  },
  FunctionReturnType<JudgmentQueries["subjectPage"]>
>("complianceJudgments:subjectPage");
export const requirementOwnerRef = makeFunctionReference<
  "query",
  { requirementId: Id<"insuranceRequirements"> },
  FunctionReturnType<JudgmentQueries["requirementOwner"]>
>("complianceJudgments:requirementOwner");

export const findMissingRequirementJudgmentsRef = makeFunctionReference<
  "query",
  {
    ownerOrgId: Id<"organizations">;
    subjectOrgId: Id<"organizations">;
    limit: number;
  },
  FunctionReturnType<JudgmentQueries["findMissingRequirementJudgments"]>
>("complianceJudgments:findMissingRequirementJudgments");
