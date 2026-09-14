import dayjs from "dayjs";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getOrgAccess } from "./lib/access";
import {
  assertImpersonatedSetupWrite,
  requireOperator,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import {
  ORG_WIKI_SECTIONS,
  assembleOrgWikiMarkdown,
  requireOrgWikiSection,
  renderWikiBullets,
  wikiBulletLines,
  type OrgWikiSectionKey,
} from "./lib/orgWiki";
import {
  isCompanyWikiFact,
  normalizeWikiContent,
  type OrgWikiSource,
} from "./lib/orgWikiPolicy";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";

const wikiSectionKeyValidator = v.union(
  ...ORG_WIKI_SECTIONS.map(([key]) => v.literal(key)),
);
const wikiSourceValidator = v.union(
  v.literal("extraction"), v.literal("analysis"), v.literal("chat"),
  v.literal("email"), v.literal("imessage"), v.literal("slack"),
  v.literal("manual"), v.literal("operator"), v.literal("mcp"),
);
const MAX_SECTION_BODY = 20_000;

async function orgNameById(ctx: QueryCtx | MutationCtx, orgId: Id<"organizations">) {
  const org = await ctx.db.get(orgId);
  return org?.name ?? null;
}

async function requireClientWikiOrganization(ctx: QueryCtx | MutationCtx, orgId: Id<"organizations">) {
  const organization = await ctx.db.get(orgId);
  if (!organization || organization.type !== "client") {
    throw new Error("Client organization not found");
  }
  return organization;
}

async function requireWikiAdmin(ctx: QueryCtx | MutationCtx, orgId: Id<"organizations">) {
  const access = await getOrgAccess(ctx, orgId);
  await assertImpersonatedSetupWrite(ctx, orgId);
  if (access.accessType !== "member" || access.role !== "admin") {
    throwUserFacingError(
      userFacingErrorCodes.orgAdminRequired,
      "Only an organization admin can manage the company wiki.",
    );
  }
}

async function requireDirectWikiAdminForUser(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
  userId: Id<"users">,
) {
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("organization_user", (q) => q.eq("orgId", orgId).eq("userId", userId))
    .first();
  if (!membership || membership.role !== "admin") {
    throwUserFacingError(
      userFacingErrorCodes.orgAdminRequired,
      "Only an organization admin can manage the company wiki.",
    );
  }
}

async function requireDirectOperatorWikiWrite(ctx: MutationCtx, operatorUserId: Id<"users">) {
  await requireOperatorForUser(ctx, operatorUserId);
  const active = await ctx.db
    .query("operatorImpersonationSessions")
    .withIndex("operator_status", (q) =>
      q.eq("operatorUserId", operatorUserId).eq("status", "active"),
    )
    .first();
  if (active) throwUserFacingError(userFacingErrorCodes.impersonationReadOnly);
}

async function sectionForKey(ctx: QueryCtx | MutationCtx, orgId: Id<"organizations">, key: string) {
  return await ctx.db
    .query("orgWikiSections")
    .withIndex("organization_key", (q) => q.eq("orgId", orgId).eq("key", key))
    .first();
}

/** The whole document, plus the sections still empty. */
export async function readOrgWiki(ctx: QueryCtx | MutationCtx, orgId: Id<"organizations">) {
  const sections = await ctx.db
    .query("orgWikiSections")
    .withIndex("organization", (q) => q.eq("orgId", orgId))
    .collect();
  const ordered = [...sections].sort((a, b) => a.order - b.order);
  return {
    orgId,
    sections: ordered,
    markdown: assembleOrgWikiMarkdown(ordered),
    gaps: ORG_WIKI_SECTIONS.filter(
      ([key]) => !sections.some((section) => section.key === key && section.body.trim()),
    ).map(([key, heading]) => ({ key, heading })),
  };
}

async function writeSection(
  ctx: MutationCtx,
  args: {
    orgId: Id<"organizations">;
    key: OrgWikiSectionKey;
    body: string;
    source: OrgWikiSource;
    sourceRefs?: string[];
    extractedLines?: string[];
    manual: boolean;
  },
) {
  const canonical = requireOrgWikiSection(args.key);
  const body = args.body.trim();
  if (body.length > MAX_SECTION_BODY) {
    throw new Error(`Wiki section must be ${MAX_SECTION_BODY.toLocaleString()} characters or fewer`);
  }
  const existing = await sectionForKey(ctx, args.orgId, args.key);
  const now = dayjs().valueOf();
  if (!existing) {
    if (!body) return null;
    return await ctx.db.insert("orgWikiSections", {
      orgId: args.orgId,
      key: canonical.key,
      heading: canonical.heading,
      body,
      order: canonical.order,
      source: args.source,
      sourceRefs: args.sourceRefs,
      extractedLines: args.manual ? undefined : args.extractedLines,
      manuallyEditedAt: args.manual ? now : undefined,
      createdAt: now,
      updatedAt: now,
    });
  }
  if (!body) {
    await ctx.db.delete(existing._id);
    return null;
  }
  await ctx.db.patch(existing._id, {
    body,
    source: args.source,
    sourceRefs: args.sourceRefs ?? existing.sourceRefs,
    extractedLines: args.manual
      ? undefined
      : (args.extractedLines ?? existing.extractedLines),
    proposedBody: undefined,
    proposedRationale: undefined,
    manuallyEditedAt: args.manual ? now : existing.manuallyEditedAt,
    updatedAt: now,
  });
  return existing._id;
}

/** Add lines to a section without disturbing what is already written. Used by
 * the conversational writers, where each exchange contributes a fact or two. */
export async function appendOrgWikiFacts(
  ctx: MutationCtx,
  args: {
    orgId: Id<"organizations">;
    key: OrgWikiSectionKey;
    facts: string[];
    source: OrgWikiSource;
    sourceRefs?: string[];
    trusted?: boolean;
  },
) {
  const orgName = await orgNameById(ctx, args.orgId);
  const accepted = args.facts
    .map((fact) => normalizeWikiContent(fact))
    .filter((content) => isCompanyWikiFact({ content, orgName, trusted: args.trusted }));
  if (accepted.length === 0) return { accepted: 0, alreadyPresent: false };
  const existing = await sectionForKey(ctx, args.orgId, args.key);
  const body = renderWikiBullets([...wikiBulletLines(existing?.body ?? ""), ...accepted]);
  if (existing?.body === body) return { accepted: 0, alreadyPresent: true };
  const sourceRefs = [...new Set([...(existing?.sourceRefs ?? []), ...(args.sourceRefs ?? [])])].sort();
  await writeSection(ctx, { ...args, body, sourceRefs, manual: false });
  return { accepted: accepted.length, alreadyPresent: false };
}

/** Rewrite only the lines the company-information reconciler owns, from the
 * full extracted fact set. Lines contributed by the conversational and
 * append-only writers are retained untouched, so a reconcile that has nothing
 * to say about a section never empties it. A manually edited section is
 * human-owned end to end and only ever receives a proposal. */
export async function reconcileExtractedCompanyFacts(
  ctx: MutationCtx,
  args: {
    orgId: Id<"organizations">;
    facts: Array<{ key: OrgWikiSectionKey; content: string; sourceRef: string }>;
    source: OrgWikiSource;
  },
) {
  const orgName = await orgNameById(ctx, args.orgId);
  const now = dayjs().valueOf();
  for (const [key] of ORG_WIKI_SECTIONS) {
    const facts = args.facts.filter(
      (fact) =>
        fact.key === key &&
        isCompanyWikiFact({ content: fact.content, orgName, trusted: true }),
    );
    const existing = await sectionForKey(ctx, args.orgId, key);
    // Round-tripped through the renderer so these read back exactly as they
    // appear in `body`, which is what the subtraction below relies on.
    const extractedLines = wikiBulletLines(
      renderWikiBullets(facts.map((fact) => fact.content)),
    );
    if (!existing && extractedLines.length === 0) continue;
    const sourceRefs = [...new Set(facts.map((fact) => fact.sourceRef))].sort();

    if (existing?.manuallyEditedAt) {
      // The human owns this section, so the sources are offered as a reviewable
      // replacement. With no facts there is nothing to review, and proposing an
      // empty body would just ask the admin to blank their own writing.
      const proposedBody = renderWikiBullets(extractedLines);
      if (
        !proposedBody ||
        existing.body === proposedBody ||
        existing.proposedBody === proposedBody
      ) {
        continue;
      }
      await ctx.db.patch(existing._id, {
        proposedBody,
        proposedRationale: `Extracted from ${sourceRefs.length} source${sourceRefs.length === 1 ? "" : "s"}`,
        updatedAt: now,
      });
      continue;
    }

    const priorExtracted = new Set(existing?.extractedLines ?? []);
    const retained = wikiBulletLines(existing?.body ?? "").filter(
      (line) => !priorExtracted.has(line),
    );
    const body = renderWikiBullets([...retained, ...extractedLines]);
    const unchanged =
      existing !== null &&
      existing.body === body &&
      existing.source === args.source &&
      sameLines(existing.extractedLines ?? [], extractedLines) &&
      sameLines(existing.sourceRefs ?? [], sourceRefs);
    if (unchanged) continue;
    await writeSection(ctx, {
      orgId: args.orgId,
      key,
      body,
      source: args.source,
      sourceRefs,
      extractedLines,
      manual: false,
    });
  }
}

function sameLines(a: string[], b: string[]) {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

// ── Internal ──

export const getInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => await readOrgWiki(ctx, args.orgId),
});

export const appendFacts = internalMutation({
  args: {
    orgId: v.id("organizations"),
    key: wikiSectionKeyValidator,
    facts: v.array(v.string()),
    source: wikiSourceValidator,
    sourceRefs: v.optional(v.array(v.string())),
    trusted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => await appendOrgWikiFacts(ctx, args),
});

export const getForMcp = internalQuery({
  args: { orgId: v.id("organizations"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) => q.eq("orgId", args.orgId).eq("userId", args.userId))
      .first();
    if (!membership) throwUserFacingError(userFacingErrorCodes.orgAccessRequired);
    return await readOrgWiki(ctx, args.orgId);
  },
});

export const upsertSectionForMcp = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    key: wikiSectionKeyValidator,
    body: v.string(),
  },
  handler: async (ctx, args) => {
    await requireDirectWikiAdminForUser(ctx, args.orgId, args.userId);
    await writeSection(ctx, { ...args, source: "mcp", manual: true });
    return await readOrgWiki(ctx, args.orgId);
  },
});

// ── Tenant ──

export const get = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.orgId);
    if (access.accessType !== "member") {
      throwUserFacingError(
        userFacingErrorCodes.orgAccessRequired,
        "The company wiki is available only to members of this organization.",
      );
    }
    return await readOrgWiki(ctx, args.orgId);
  },
});

export const upsertSection = mutation({
  args: { orgId: v.id("organizations"), key: wikiSectionKeyValidator, body: v.string() },
  handler: async (ctx, args) => {
    await requireWikiAdmin(ctx, args.orgId);
    await writeSection(ctx, { ...args, source: "manual", manual: true });
    return await readOrgWiki(ctx, args.orgId);
  },
});

export const acceptProposal = mutation({
  args: { orgId: v.id("organizations"), key: wikiSectionKeyValidator },
  handler: async (ctx, args) => {
    await requireWikiAdmin(ctx, args.orgId);
    const section = await sectionForKey(ctx, args.orgId, args.key);
    if (!section?.proposedBody) throw new Error("No wiki proposal pending");
    await ctx.db.patch(section._id, {
      body: section.proposedBody, proposedBody: undefined,
      proposedRationale: undefined, updatedAt: dayjs().valueOf(),
    });
    return await readOrgWiki(ctx, args.orgId);
  },
});

export const rejectProposal = mutation({
  args: { orgId: v.id("organizations"), key: wikiSectionKeyValidator },
  handler: async (ctx, args) => {
    await requireWikiAdmin(ctx, args.orgId);
    const section = await sectionForKey(ctx, args.orgId, args.key);
    if (!section) throw new Error("Wiki section not found");
    await ctx.db.patch(section._id, {
      proposedBody: undefined, proposedRationale: undefined, updatedAt: dayjs().valueOf(),
    });
    return await readOrgWiki(ctx, args.orgId);
  },
});

// ── Operator ──

export const getForOperator = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    await requireClientWikiOrganization(ctx, args.orgId);
    return await readOrgWiki(ctx, args.orgId);
  },
});

export const upsertSectionForOperator = mutation({
  args: { orgId: v.id("organizations"), key: wikiSectionKeyValidator, body: v.string() },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await upsertOrgWikiSectionByOperator(ctx, { ...args, operatorUserId: operator.userId });
  },
});

export async function upsertOrgWikiSectionByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    orgId: Id<"organizations">;
    key: OrgWikiSectionKey;
    body: string;
    source?: "operator" | "mcp";
  },
) {
  await requireDirectOperatorWikiWrite(ctx, args.operatorUserId);
  await requireClientWikiOrganization(ctx, args.orgId);
  await writeSection(ctx, { ...args, source: args.source ?? "operator", manual: true });
  await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: args.orgId,
    summary: "Updated company wiki",
    metadata: { domain: "org_wiki", operation: "upsert", wikiSectionKey: args.key },
  });
  return await readOrgWiki(ctx, args.orgId);
}

/** Called only inside the scan source's atomic authorization boundary. */
export async function writeWorkspaceScanCompanyFacts(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    orgId: Id<"organizations">;
    key: OrgWikiSectionKey;
    body: string;
  },
) {
  await requireDirectOperatorWikiWrite(ctx, args.operatorUserId);
  await requireClientWikiOrganization(ctx, args.orgId);
  const lines = wikiBulletLines(args.body);
  if (
    !lines.length ||
    lines.some((line) => !isCompanyWikiFact({ content: line }))
  )
    throw new Error(
      "Company facts must contain audience-safe company information",
    );
  return writeSection(ctx, {
    orgId: args.orgId,
    key: args.key,
    body: renderWikiBullets(lines),
    source: "email",
    manual: false,
  });
}
