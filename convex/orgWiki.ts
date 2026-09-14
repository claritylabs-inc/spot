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
  requireOrgWikiSection,
  renderWikiBullets,
  wikiBulletLines,
  type OrgWikiSectionKey,
} from "./lib/orgWiki";
import {
  isCompanyWikiFact,
  assertAgentWikiContent,
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
  v.literal("extraction"),
  v.literal("analysis"),
  v.literal("chat"),
  v.literal("email"),
  v.literal("imessage"),
  v.literal("slack"),
  v.literal("manual"),
  v.literal("operator"),
  v.literal("mcp"),
);
const MAX_SECTION_BODY = 20_000;

import { getMarkdownDocument, saveMarkdownDocument } from "./markdownDocuments";
import {
  readMarkdownHeading,
  replaceMarkdownHeading,
  parseMarkdownDocument,
  parseDocumentVisibility,
} from "./lib/markdownDocument";
import {
  manualWikiDocument,
  readWikiDocument,
  renderWikiDocument,
  type WikiMetadata,
} from "./lib/orgWikiDocument";

async function loadWiki(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
) {
  const document = await getMarkdownDocument(ctx, {
    orgId,
    kind: "company_wiki",
  });
  return { document, ...readWikiDocument(document?.markdown ?? "") };
}

type WikiState = Awaited<ReturnType<typeof loadWiki>>;

async function persistWiki(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  state: WikiState,
  body: string,
  metadata: WikiMetadata,
) {
  const document = await saveMarkdownDocument(ctx, {
    orgId,
    kind: "company_wiki",
    filename: "company-wiki.md",
    markdown: renderWikiDocument(body, metadata, state.frontmatter),
    expectedRevision: state.document?.revision ?? 0,
  });
  return document;
}

async function orgNameById(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
) {
  const org = await ctx.db.get(orgId);
  return org?.name ?? null;
}

async function requireClientWikiOrganization(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
) {
  const organization = await ctx.db.get(orgId);
  if (!organization || organization.type !== "client") {
    throw new Error("Client organization not found");
  }
  return organization;
}

async function readSharedWiki(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
) {
  await requireClientWikiOrganization(ctx, orgId);
  const wiki = await readOrgWiki(ctx, orgId);
  return parseDocumentVisibility(wiki.markdown, "shared") === "shared"
    ? wiki
    : null;
}

async function requireSharedWikiWrite(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
  markdown?: string,
) {
  if (
    !(await readSharedWiki(ctx, orgId)) ||
    (markdown !== undefined &&
      parseDocumentVisibility(markdown, "shared") !== "shared")
  )
    throw new Error("This company document is available only to operators");
}

async function requireWikiAdmin(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
) {
  await requireClientWikiOrganization(ctx, orgId);
  const access = await getOrgAccess(ctx, orgId);
  await assertImpersonatedSetupWrite(ctx, orgId);
  await requireSharedWikiWrite(ctx, orgId);
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
  await requireClientWikiOrganization(ctx, orgId);
  await requireSharedWikiWrite(ctx, orgId);
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("organization_user", (q) =>
      q.eq("orgId", orgId).eq("userId", userId),
    )
    .first();
  if (!membership || membership.role !== "admin") {
    throwUserFacingError(
      userFacingErrorCodes.orgAdminRequired,
      "Only an organization admin can manage the company wiki.",
    );
  }
}

async function requireDirectOperatorWikiWrite(
  ctx: MutationCtx,
  operatorUserId: Id<"users">,
) {
  await requireOperatorForUser(ctx, operatorUserId);
  const active = await ctx.db
    .query("operatorImpersonationSessions")
    .withIndex("operator_status", (q) =>
      q.eq("operatorUserId", operatorUserId).eq("status", "active"),
    )
    .first();
  if (active) throwUserFacingError(userFacingErrorCodes.impersonationReadOnly);
}

async function requireOperatorWikiOrganization(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
) {
  const organization = await ctx.db.get(orgId);
  if (
    !organization ||
    (organization.type !== "client" && organization.type !== "broker")
  )
    throw new Error("Company not found");
  return organization;
}

async function sectionForKey(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
  key: string,
) {
  const heading = requireOrgWikiSection(key).heading;
  const state = await loadWiki(ctx, orgId);
  const body = readMarkdownHeading(state.body, heading);
  if (!body) return null;
  return {
    body,
    sourceRefs: state.metadata.contributions?.[heading]?.sources ?? [],
    extractedLines: state.metadata.contributions?.[heading]?.lines ?? [],
    manuallyEditedAt:
      state.metadata.manual ||
      state.metadata.protectedHeadings?.includes(heading)
        ? 1
        : undefined,
    proposedBody: state.metadata.proposals?.[heading]?.body,
    proposedRationale: state.metadata.proposals?.[heading]?.rationale,
    source: "extraction" as OrgWikiSource,
  };
}

/** The canonical Markdown file and its pending source-grounded suggestions. */
export async function readOrgWiki(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
) {
  const state = await loadWiki(ctx, orgId);
  return {
    orgId,
    filename: state.document?.filename ?? "company-wiki.md",
    revision: state.document?.revision ?? 0,
    markdown:
      state.document?.markdown ??
      renderWikiDocument(state.body, state.metadata, state.frontmatter),
    body: state.body,
    proposals: Object.entries(state.metadata.proposals ?? {}).map(
      ([heading, proposal]) => ({ heading, ...proposal }),
    ),
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
  const heading = requireOrgWikiSection(args.key).heading;
  if (args.body.length > MAX_SECTION_BODY)
    throw new Error("Wiki contribution exceeds 20,000 characters");
  const state = await loadWiki(ctx, args.orgId);
  const metadata = state.metadata;
  if (args.manual) {
    metadata.protectedHeadings = [
      ...new Set([...(metadata.protectedHeadings ?? []), heading]),
    ];
    if (metadata.contributions) delete metadata.contributions[heading];
  } else if (args.extractedLines) {
    metadata.contributions = {
      ...metadata.contributions,
      [heading]: { lines: args.extractedLines, sources: args.sourceRefs ?? [] },
    };
  }
  const proposal = metadata.proposals?.[heading];
  if (proposal) {
    if (args.manual) delete metadata.proposals![heading];
    else {
      const previous = readMarkdownHeading(state.body, heading);
      proposal.body = proposal.body.startsWith(previous)
        ? `${args.body.trim()}${proposal.body.slice(previous.length)}`
        : `${args.body.trim()}\n\n${proposal.body}`;
    }
  }
  const document = await persistWiki(
    ctx,
    args.orgId,
    state,
    replaceMarkdownHeading(state.body, heading, args.body),
    metadata,
  );
  return document._id;
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
    .filter((content) =>
      isCompanyWikiFact({ content, orgName, trusted: args.trusted }),
    );
  if (accepted.length === 0) return { accepted: 0, alreadyPresent: false };
  const existing = await sectionForKey(ctx, args.orgId, args.key);
  const additions = accepted.filter((fact) => !existing?.body.includes(fact));
  if (!additions.length) return { accepted: 0, alreadyPresent: true };
  const body = `${existing?.body ?? ""}${existing?.body ? "\n\n" : ""}${renderWikiBullets(additions)}`;
  const sourceRefs = [
    ...new Set([...(existing?.sourceRefs ?? []), ...(args.sourceRefs ?? [])]),
  ].sort();
  await writeSection(ctx, { ...args, body, sourceRefs, manual: false });
  return { accepted: additions.length, alreadyPresent: false };
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
    facts: Array<{
      key: OrgWikiSectionKey;
      content: string;
      sourceRef: string;
    }>;
    source: OrgWikiSource;
  },
) {
  const orgName = await orgNameById(ctx, args.orgId);
  const state = await loadWiki(ctx, args.orgId);
  const metadata = state.metadata;
  let body = state.body;
  for (const [key, heading] of ORG_WIKI_SECTIONS) {
    const facts = args.facts.filter(
      (fact) =>
        fact.key === key &&
        isCompanyWikiFact({ content: fact.content, orgName, trusted: true }),
    );
    const lines = wikiBulletLines(
      renderWikiBullets(facts.map((fact) => fact.content)),
    );
    const current = readMarkdownHeading(body, heading);
    if (metadata.manual || metadata.protectedHeadings?.includes(heading)) {
      const additions = lines.filter((line) => !current.includes(line));
      if (additions.length) {
        metadata.proposals = {
          ...metadata.proposals,
          [heading]: {
            body: `${current}${current ? "\n\n" : ""}${renderWikiBullets(additions)}`,
            rationale: `Suggested facts from ${new Set(facts.map((fact) => fact.sourceRef)).size} sources`,
          },
        };
      } else if (metadata.proposals?.[heading]) {
        delete metadata.proposals[heading];
      }
      continue;
    }
    const owned = new Set(metadata.contributions?.[heading]?.lines ?? []);
    const retained = current
      .split("\n")
      .filter((line) => {
        const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
        return !bullet || !owned.has(bullet[1].trim());
      })
      .join("\n")
      .trim();
    const additions = lines.filter((line) => !retained.includes(line));
    const content = `${retained}${retained && additions.length ? "\n\n" : ""}${renderWikiBullets(additions)}`;
    body = replaceMarkdownHeading(body, heading, content);
    metadata.contributions = {
      ...metadata.contributions,
      [heading]: {
        lines: additions,
        sources: [...new Set(facts.map((fact) => fact.sourceRef))],
      },
    };
  }
  await persistWiki(ctx, args.orgId, state, body, metadata);
}

// ── Internal ──

export const getInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => await readSharedWiki(ctx, args.orgId),
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
  handler: async (ctx, args) => {
    if (!(await readSharedWiki(ctx, args.orgId)))
      return { accepted: 0, alreadyPresent: false };
    return appendOrgWikiFacts(ctx, args);
  },
});

export const getForMcp = internalQuery({
  args: { orgId: v.id("organizations"), userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireClientWikiOrganization(ctx, args.orgId);
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) =>
        q.eq("orgId", args.orgId).eq("userId", args.userId),
      )
      .first();
    if (!membership)
      throwUserFacingError(userFacingErrorCodes.orgAccessRequired);
    return await readSharedWiki(ctx, args.orgId);
  },
});

// ── Tenant ──

export const get = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireClientWikiOrganization(ctx, args.orgId);
    const access = await getOrgAccess(ctx, args.orgId);
    if (access.accessType !== "member") {
      throwUserFacingError(
        userFacingErrorCodes.orgAccessRequired,
        "The company wiki is available only to members of this organization.",
      );
    }
    return await readSharedWiki(ctx, args.orgId);
  },
});

// ── Operator ──

export const getForOperator = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    await requireOperatorWikiOrganization(ctx, args.orgId);
    return await readOrgWiki(ctx, args.orgId);
  },
});

/** Called only inside the scan source's atomic authorization boundary. */
export async function writeWorkspaceScanCompanyFacts(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    orgId: Id<"organizations">;
    key: OrgWikiSectionKey;
    body: string;
    replaces: string[];
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
  const current = await sectionForKey(ctx, args.orgId, args.key);
  const existing = wikiBulletLines(current?.body ?? "");
  if (args.replaces.some((line) => !existing.includes(line)))
    throw new Error("A contradicted company fact changed during analysis");
  const retained = (current?.body ?? "")
    .split("\n")
    .filter(
      (line) => !args.replaces.includes(line.replace(/^\s*[-*]\s+/, "").trim()),
    )
    .join("\n")
    .trim();
  return writeSection(ctx, {
    orgId: args.orgId,
    key: args.key,
    body: `${retained}${retained ? "\n\n" : ""}${renderWikiBullets(lines)}`,
    source: "email",
    manual: false,
  });
}

async function saveWikiFile(
  ctx: MutationCtx,
  args: {
    orgId: Id<"organizations">;
    markdown: string;
    expectedRevision: number;
    agent?: boolean;
  },
) {
  const state = await loadWiki(ctx, args.orgId);
  let markdown = manualWikiDocument(args.markdown);
  if (args.agent) {
    const parsed = parseMarkdownDocument(args.markdown);
    assertAgentWikiContent(state.body, parsed.body);
    const metadataText = (metadata: Record<string, unknown>) => {
      const strings: string[] = [];
      const visit = (value: unknown) => {
        if (typeof value === "string" && !/^https?:\/\//i.test(value))
          strings.push(value);
        else if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === "object")
          for (const [key, item] of Object.entries(value))
            if (key !== "_spot") visit(item);
      };
      visit(metadata);
      return strings.join("\n");
    };
    assertAgentWikiContent(
      metadataText(state.frontmatter),
      metadataText(parsed.frontmatter),
    );
    for (const [heading, proposal] of Object.entries(
      state.metadata.proposals ?? {},
    )) {
      const previous = readMarkdownHeading(state.body, heading);
      const current = readMarkdownHeading(parsed.body, heading);
      if (previous !== current) {
        proposal.body = proposal.body.startsWith(previous)
          ? `${current}${proposal.body.slice(previous.length)}`
          : [current, proposal.body].filter(Boolean).join("\n\n");
      }
    }
    markdown = renderWikiDocument(
      parsed.body,
      state.metadata,
      parsed.frontmatter,
    );
  }
  const document = await saveMarkdownDocument(ctx, {
    orgId: args.orgId,
    kind: "company_wiki",
    filename: "company-wiki.md",
    markdown,
    expectedRevision: args.expectedRevision,
  });
  return document;
}

const wikiFileArgs = {
  orgId: v.id("organizations"),
  markdown: v.string(),
  expectedRevision: v.number(),
};

export const save = mutation({
  args: wikiFileArgs,
  handler: async (ctx, args) => {
    await requireWikiAdmin(ctx, args.orgId);
    await requireSharedWikiWrite(ctx, args.orgId, args.markdown);
    await saveWikiFile(ctx, args);
    return readOrgWiki(ctx, args.orgId);
  },
});

export const saveForMcp = internalMutation({
  args: { ...wikiFileArgs, userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireDirectWikiAdminForUser(ctx, args.orgId, args.userId);
    await requireSharedWikiWrite(ctx, args.orgId, args.markdown);
    await saveWikiFile(ctx, { ...args, agent: true });
    return readOrgWiki(ctx, args.orgId);
  },
});

export async function upsertOrgWikiDocumentByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    orgId: Id<"organizations">;
    markdown: string;
    expectedRevision: number;
    source?: "operator" | "mcp";
  },
) {
  await requireDirectOperatorWikiWrite(ctx, args.operatorUserId);
  await requireOperatorWikiOrganization(ctx, args.orgId);
  await saveWikiFile(ctx, { ...args, agent: args.source !== undefined });
  await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: args.orgId,
    summary: "Updated company wiki",
    metadata: { domain: "org_wiki", operation: "save_document" },
  });
  return readOrgWiki(ctx, args.orgId);
}

export const saveForOperator = mutation({
  args: wikiFileArgs,
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return upsertOrgWikiDocumentByOperator(ctx, {
      ...args,
      operatorUserId: operator.userId,
    });
  },
});

async function resolveWikiFileProposal(
  ctx: MutationCtx,
  args: {
    orgId: Id<"organizations">;
    heading: string;
    accept: boolean;
    expectedRevision: number;
  },
) {
  const state = await loadWiki(ctx, args.orgId);
  if ((state.document?.revision ?? 0) !== args.expectedRevision)
    throw new Error(
      "This document changed. Reload it before resolving the suggestion.",
    );
  const proposal = state.metadata.proposals?.[args.heading];
  if (!proposal) throw new Error("No wiki proposal pending");
  delete state.metadata.proposals![args.heading];
  await persistWiki(
    ctx,
    args.orgId,
    state,
    args.accept
      ? replaceMarkdownHeading(state.body, args.heading, proposal.body)
      : state.body,
    state.metadata,
  );
  return readOrgWiki(ctx, args.orgId);
}

const proposalFileArgs = {
  orgId: v.id("organizations"),
  heading: v.string(),
  accept: v.boolean(),
  expectedRevision: v.number(),
};
export const resolveProposal = mutation({
  args: proposalFileArgs,
  handler: async (ctx, args) => {
    await requireWikiAdmin(ctx, args.orgId);
    return resolveWikiFileProposal(ctx, args);
  },
});
export const resolveProposalForOperator = mutation({
  args: proposalFileArgs,
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireDirectOperatorWikiWrite(ctx, operator.userId);
    await requireOperatorWikiOrganization(ctx, args.orgId);
    return resolveWikiFileProposal(ctx, args);
  },
});
