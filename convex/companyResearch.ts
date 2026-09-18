import dayjs from "dayjs";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import {
  COMPANY_RESEARCH_VERSION,
  companyResearchFactValidator,
  companyResearchFingerprint,
  companyResearchFingerprintMatchesIdentity,
  publicResearchUrl,
  samePublicResearchSite,
  samePublicResearchUrl,
} from "./lib/companyResearch";
import {
  isSpotOwnedBrokerIdentity,
  normalizeBrokerWritingStates,
  normalizeBrokerLineOfBusinessCodes,
} from "./lib/brokerProfileValidation";
import { researchBrokerValidator } from "./lib/companyResearch";
import { reconcileExtractedCompanyFacts } from "./orgWiki";

const LEASE_MS = 15 * 60 * 1_000;
const MAX_ATTEMPTS = 3;
const runRef = makeFunctionReference<"action", { orgId: Id<"organizations"> }>(
  "actions/companyResearch:run",
);
const recoverRef = makeFunctionReference<
  "mutation",
  { orgId: Id<"organizations">; leaseId: string }
>("companyResearch:recover");

function missingFields(org: Doc<"organizations">) {
  return [!org.website && "website"].filter((field): field is string =>
    Boolean(field),
  );
}

type CompanyResearchFact = NonNullable<
  Doc<"organizations">["companyResearch"]
>["facts"][number];

async function reconcileCompanyResearchFacts(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  researchFacts: CompanyResearchFact[],
) {
  const extractions = await ctx.db
    .query("companyInformationExtractions")
    .withIndex("organization", (q) => q.eq("orgId", orgId))
    .order("desc")
    .take(500);
  await reconcileExtractedCompanyFacts(ctx, {
    orgId,
    source: "extraction",
    facts: [
      ...extractions
        .filter((row) => row.appliedFingerprint)
        .flatMap((row) =>
          (row.organizationFacts ?? []).map((fact) => ({
            key: fact.section ?? ("profile" as const),
            content: fact.content,
            sourceRef: row.sourceRef,
          })),
        ),
      ...researchFacts.map((fact) => ({
        ...fact,
        content: `${fact.content} [Source](${fact.sourceRef})`,
      })),
    ],
  });
}

export async function scheduleCompanyResearch(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  options: { force?: boolean } = {},
) {
  const org = await ctx.db.get(orgId);
  if (
    !org ||
    org.deletedAt !== undefined ||
    (org.type !== "client" && org.type !== "broker") ||
    (org.type === "broker" && isSpotOwnedBrokerIdentity(org))
  )
    return false;
  const fingerprint = companyResearchFingerprint(org);
  if (
    org.companyResearch?.fingerprint === fingerprint &&
    (!options.force ||
      ["pending", "running"].includes(org.companyResearch.status))
  )
    return false;
  const retainEvidence =
    !org.companyResearch ||
    companyResearchFingerprintMatchesIdentity(
      org.companyResearch.fingerprint,
      org,
    );
  const sourceUrls = retainEvidence
    ? (org.companyResearch?.sourceUrls ?? [])
    : [];
  const facts = retainEvidence ? (org.companyResearch?.facts ?? []) : [];
  if (
    !retainEvidence &&
    org.type === "broker" &&
    org.companyResearch?.appliedBrokerFields?.length
  ) {
    const profile = await ctx.db
      .query("brokerProfiles")
      .withIndex("broker", (q) => q.eq("brokerOrgId", orgId))
      .unique();
    if (profile) {
      const owned = new Set(org.companyResearch.appliedBrokerFields);
      await ctx.db.patch(profile._id, {
        ...(owned.has("writingStates") ? { writingStates: [] } : {}),
        ...(owned.has("lineOfBusinessCodes")
          ? { lineOfBusinessCodes: [] }
          : {}),
        ...(owned.has("officeAddress") ? { officeAddress: undefined } : {}),
        updatedAt: dayjs().valueOf(),
      });
    }
  }
  await ctx.db.patch(orgId, {
    companyResearch: {
      version: COMPANY_RESEARCH_VERSION,
      fingerprint,
      status: "pending",
      attempts: 0,
      unresolvedFields: missingFields(org),
      sourceUrls,
      facts,
      brokerFindings: retainEvidence
        ? org.companyResearch?.brokerFindings
        : undefined,
      appliedBrokerFields: retainEvidence
        ? org.companyResearch?.appliedBrokerFields
        : undefined,
      updatedAt: dayjs().valueOf(),
    },
  });
  if (!retainEvidence) await reconcileCompanyResearchFacts(ctx, orgId, []);
  await ctx.scheduler.runAfter(0, runRef, { orgId });
  return true;
}

export const claim = internalMutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.get(orgId);
    if (
      !org ||
      org.deletedAt !== undefined ||
      (org.type !== "client" && org.type !== "broker") ||
      (org.type === "broker" && isSpotOwnedBrokerIdentity(org))
    )
      return null;
    const research = org.companyResearch;
    if (!research || research.fingerprint !== companyResearchFingerprint(org)) {
      await scheduleCompanyResearch(ctx, orgId);
      return null;
    }
    if (research.status !== "pending") return null;
    const now = dayjs().valueOf();
    const leaseId = crypto.randomUUID();
    await ctx.db.patch(orgId, {
      companyResearch: {
        ...research,
        status: "running",
        attempts: research.attempts + 1,
        leaseId,
        leaseExpiresAt: now + LEASE_MS,
        error: undefined,
        updatedAt: now,
      },
    });
    await ctx.scheduler.runAfter(LEASE_MS, recoverRef, { orgId, leaseId });
    let profileUpdatedAt: number | undefined;
    if (org.type === "broker") {
      const profile = await ctx.db
        .query("brokerProfiles")
        .withIndex("broker", (q) => q.eq("brokerOrgId", orgId))
        .unique();
      if (!profile)
        await ctx.db.insert("brokerProfiles", {
          brokerOrgId: orgId,
          networkStatus: "prospect",
          writingStates: [],
          lineOfBusinessCodes: [],
          createdAt: now,
          updatedAt: now,
        });
      profileUpdatedAt = profile?.updatedAt ?? now;
    }
    return {
      orgId,
      leaseId,
      fingerprint: research.fingerprint,
      name: org.name,
      website: org.website,
      type: org.type,
      profileUpdatedAt,
    };
  },
});

async function failLease(
  ctx: MutationCtx,
  org: Doc<"organizations">,
  error: string,
) {
  const research = org.companyResearch!;
  const retry = research.attempts < MAX_ATTEMPTS;
  await ctx.db.patch(org._id, {
    companyResearch: {
      ...research,
      status: retry ? "pending" : "failed",
      error: error.slice(0, 500),
      leaseId: undefined,
      leaseExpiresAt: undefined,
      updatedAt: dayjs().valueOf(),
    },
  });
  if (!retry)
    await ctx.db.insert("companyResearchEvents", {
      orgId: org._id,
      fingerprint: research.fingerprint,
      status: "failed",
      sourceCount: research.sourceUrls.length,
      unresolvedFields: research.unresolvedFields,
      createdAt: dayjs().valueOf(),
    });
  if (retry)
    await ctx.scheduler.runAfter(research.attempts * 1_000, runRef, {
      orgId: org._id,
    });
}

export const recover = internalMutation({
  args: { orgId: v.id("organizations"), leaseId: v.string() },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (org?.deletedAt !== undefined) return;
    if (
      !org ||
      org.companyResearch?.status !== "running" ||
      org.companyResearch.leaseId !== args.leaseId
    )
      return;
    if ((org.companyResearch.leaseExpiresAt ?? 0) > dayjs().valueOf()) return;
    if (org.companyResearch.fingerprint !== companyResearchFingerprint(org)) {
      await scheduleCompanyResearch(ctx, org._id);
      return;
    }
    await failLease(ctx, org, "Public company research lease expired");
  },
});

export const fail = internalMutation({
  args: {
    orgId: v.id("organizations"),
    leaseId: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (org?.deletedAt !== undefined) return false;
    if (
      !org ||
      org.companyResearch?.status !== "running" ||
      org.companyResearch.leaseId !== args.leaseId
    )
      return false;
    if (org.companyResearch.fingerprint !== companyResearchFingerprint(org)) {
      await scheduleCompanyResearch(ctx, org._id);
      return false;
    }
    await failLease(ctx, org, args.error);
    return true;
  },
});

export const complete = internalMutation({
  args: {
    orgId: v.id("organizations"),
    leaseId: v.string(),
    fingerprint: v.string(),
    website: v.optional(v.string()),
    facts: v.array(companyResearchFactValidator),
    sourceUrls: v.array(v.string()),
    reason: v.optional(v.string()),
    unresolvedFields: v.optional(v.array(v.string())),
    brokerFindings: v.optional(researchBrokerValidator),
    profileUpdatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (org?.deletedAt !== undefined) return false;
    const research = org?.companyResearch;
    if (
      !org ||
      !research ||
      research.status !== "running" ||
      research.leaseId !== args.leaseId ||
      research.fingerprint !== args.fingerprint
    )
      return false;
    if (research.fingerprint !== companyResearchFingerprint(org)) {
      await scheduleCompanyResearch(ctx, org._id);
      return false;
    }
    const currentSourceUrls = [
      ...new Set(
        args.sourceUrls
          .map(publicResearchUrl)
          .filter((url): url is string => Boolean(url)),
      ),
    ].slice(0, 40);
    const currentFacts = args.facts
      .flatMap((fact) => {
        const sourceRef = currentSourceUrls.find((url) =>
          samePublicResearchUrl(url, fact.sourceRef),
        );
        return sourceRef && fact.content.length <= 1_200
          ? [{ ...fact, sourceRef }]
          : [];
      })
      .slice(0, 40);
    const verifiedCurrentEvidence =
      currentSourceUrls.length > 0 && !args.reason;
    const replaceFacts =
      verifiedCurrentEvidence &&
      currentFacts.length > 0 &&
      !args.unresolvedFields?.length;
    let sourceUrls = replaceFacts
      ? currentSourceUrls
      : [
          ...new Set([
            ...research.sourceUrls,
            ...(verifiedCurrentEvidence ? currentSourceUrls : []),
          ]),
        ].slice(0, 120);
    const mergedFacts = [
      ...new Map(
        [
          ...research.facts,
          ...(verifiedCurrentEvidence ? currentFacts : []),
        ].map((fact) => [`${fact.key}:${fact.content}`, fact]),
      ).values(),
    ];
    const facts = replaceFacts
      ? currentFacts
      : mergedFacts
          .filter((fact) => sourceUrls.includes(fact.sourceRef))
          .slice(0, 120);
    const patch: Partial<Doc<"organizations">> = {};
    const website = args.website && publicResearchUrl(args.website);
    if (
      !org.website &&
      website &&
      currentSourceUrls.some((url) => samePublicResearchSite(url, website))
    )
      patch.website = website;
    const updated = { ...org, ...patch };
    const unresolvedFields = [
      ...missingFields(updated),
      ...(args.unresolvedFields ?? []),
    ];
    if (mergedFacts.length > 120 || sourceUrls.length === 120)
      unresolvedFields.push("evidenceCapacity");
    let brokerFindings = research.brokerFindings;
    const appliedBrokerFields = new Set(research.appliedBrokerFields ?? []);
    if (
      org.type === "broker" &&
      verifiedCurrentEvidence &&
      args.brokerFindings
    ) {
      const supported = (items: typeof args.brokerFindings.writingStates) =>
        items.filter(
          (item) =>
            Number.isFinite(item.confidence) &&
            item.confidence > 0.7 &&
            item.confidence <= 1,
        );
      const nextStates = supported(args.brokerFindings.writingStates);
      const nextLines = supported(args.brokerFindings.lineOfBusinessCodes);
      const mergeSelections = (
        previous: typeof nextStates,
        next: typeof nextStates,
        field: string,
      ) =>
        next.length && !unresolvedFields.includes(field)
          ? next
          : [
              ...new Map(
                [...previous, ...next].map((item) => [item.code, item]),
              ).values(),
            ];
      const officeSupported =
        !!args.brokerFindings.officeAddress &&
        !!args.brokerFindings.officeSourceRef &&
        currentSourceUrls.some((url) =>
          samePublicResearchUrl(url, args.brokerFindings!.officeSourceRef!),
        );
      if (!nextStates.length) unresolvedFields.push("writingStates");
      if (!nextLines.length) unresolvedFields.push("lineOfBusinessCodes");
      if (!officeSupported) unresolvedFields.push("officeAddress");
      brokerFindings = {
        writingStates: mergeSelections(
          research.brokerFindings?.writingStates ?? [],
          nextStates,
          "writingStates",
        ),
        lineOfBusinessCodes: mergeSelections(
          research.brokerFindings?.lineOfBusinessCodes ?? [],
          nextLines,
          "lineOfBusinessCodes",
        ),
        ...(officeSupported
          ? {
              officeAddress: args.brokerFindings.officeAddress,
              officeSourceRef: args.brokerFindings.officeSourceRef,
            }
          : {
              officeAddress: research.brokerFindings?.officeAddress,
              officeSourceRef: research.brokerFindings?.officeSourceRef,
            }),
      };
      if (
        !nextStates.length ||
        !nextLines.length ||
        !officeSupported ||
        unresolvedFields.includes("writingStates") ||
        unresolvedFields.includes("lineOfBusinessCodes")
      ) {
        sourceUrls = [
          ...new Set([...sourceUrls, ...research.sourceUrls]),
        ].slice(0, 120);
      }
      const writingStates = normalizeBrokerWritingStates(
        brokerFindings.writingStates.map((item) => item.code),
      );
      const lineOfBusinessCodes = normalizeBrokerLineOfBusinessCodes(
        brokerFindings.lineOfBusinessCodes.map((item) => item.code),
      );
      const profile = await ctx.db
        .query("brokerProfiles")
        .withIndex("broker", (q) => q.eq("brokerOrgId", org._id))
        .unique();
      if (profile && profile.updatedAt === args.profileUpdatedAt) {
        // Refresh only research-owned or missing fields; manual writes relinquish research ownership.
        const manualFields = new Set(profile.manualFields ?? []);
        const writeStates =
          !manualFields.has("writingStates") &&
          (appliedBrokerFields.has("writingStates") ||
            !profile.writingStates.length);
        const writeLines =
          !manualFields.has("lineOfBusinessCodes") &&
          (appliedBrokerFields.has("lineOfBusinessCodes") ||
            !profile.lineOfBusinessCodes.length);
        const writeOffice =
          !manualFields.has("officeAddress") &&
          (appliedBrokerFields.has("officeAddress") ||
            !Object.values(profile.officeAddress ?? {}).some(Boolean));
        if (writeStates) appliedBrokerFields.add("writingStates");
        if (writeLines) appliedBrokerFields.add("lineOfBusinessCodes");
        if (writeOffice) appliedBrokerFields.add("officeAddress");
        await ctx.db.patch(profile._id, {
          ...(writeStates ? { writingStates } : {}),
          ...(writeLines ? { lineOfBusinessCodes } : {}),
          ...(writeOffice
            ? { officeAddress: brokerFindings.officeAddress }
            : {}),
          updatedByUserId: undefined,
          updatedAt: dayjs().valueOf(),
        });
      } else unresolvedFields.push("profileChangedDuringResearch");
    }
    if (org.type === "broker" && !args.brokerFindings)
      unresolvedFields.push("brokerProfile");
    if (!currentSourceUrls.length || args.reason)
      unresolvedFields.push("publicIdentity");
    if (!currentFacts.length) unresolvedFields.push("companyFacts");
    await ctx.db.patch(org._id, {
      ...patch,
      companyResearch: {
        ...research,
        fingerprint: companyResearchFingerprint(updated),
        status: unresolvedFields.length ? "partial" : "completed",
        sourceUrls,
        facts,
        brokerFindings,
        appliedBrokerFields: [...appliedBrokerFields],
        unresolvedFields,
        error: args.reason,
        leaseId: undefined,
        leaseExpiresAt: undefined,
        updatedAt: dayjs().valueOf(),
      },
    });
    await ctx.db.insert("companyResearchEvents", {
      orgId: org._id,
      fingerprint: companyResearchFingerprint(updated),
      status: unresolvedFields.length ? "partial" : "completed",
      sourceCount: sourceUrls.length,
      unresolvedFields,
      createdAt: dayjs().valueOf(),
    });
    await reconcileCompanyResearchFacts(ctx, org._id, facts);
    return true;
  },
});

async function requestResearch(ctx: MutationCtx, orgId: Id<"organizations">) {
  const org = await ctx.db.get(orgId);
  if (!org || org.deletedAt !== undefined || org.type !== "client")
    throw new Error("Client not found");
  const queued = await scheduleCompanyResearch(ctx, orgId, { force: true });
  const current = await ctx.db.get(orgId);
  return {
    success: true as const,
    queued,
    status: current!.companyResearch!.status,
  };
}

export const request = internalMutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => requestResearch(ctx, args.orgId),
});

export const requestForUser = internalMutation({
  args: { orgId: v.id("organizations"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) =>
        q.eq("orgId", args.orgId).eq("userId", args.userId),
      )
      .unique();
    if (membership?.role !== "admin")
      throw new Error(
        "Only a direct organization admin can research this company",
      );
    const impersonation = await ctx.db
      .query("operatorImpersonationSessions")
      .withIndex("operator_status", (q) =>
        q.eq("operatorUserId", args.userId).eq("status", "active"),
      )
      .first();
    if (impersonation) throw new Error("IMPERSONATION_READ_ONLY");
    return requestResearch(ctx, args.orgId);
  },
});
