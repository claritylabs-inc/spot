import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getPolicyAccessForQuery } from "./lib/access";
import { getActiveOperatorProfile } from "./lib/operatorIdentity";

const sourceNodeInsertFields = {
  orgId: v.id("organizations"),
  policyId: v.optional(v.id("policies")),
  nodeId: v.string(),
  documentId: v.string(),
  parentNodeId: v.optional(v.string()),
  kind: v.string(),
  title: v.string(),
  description: v.string(),
  textExcerpt: v.optional(v.string()),
  sourceSpanIds: v.array(v.string()),
  pageStart: v.optional(v.number()),
  pageEnd: v.optional(v.number()),
  bbox: v.optional(v.any()),
  order: v.number(),
  path: v.string(),
  metadata: v.optional(v.any()),
  embedding: v.optional(v.array(v.float64())),
  createdAt: v.number(),
};

type SourceNodeDoc = Doc<"sourceNodes">;
type OutlineShapeNode = Pick<SourceNodeDoc, "kind" | "nodeId" | "title" | "description" | "textExcerpt" | "order">;
type PublicSourceNode = {
  _id: SourceNodeDoc["_id"];
  _creationTime: number;
  id: string;
  nodeId: string;
  documentId: string;
  parentNodeId?: string;
  title: string;
  type: string;
  label: string;
  description: string;
  excerpt?: string;
  content?: string;
  sourceSpanIds: string[];
  pageStart?: number;
  pageEnd?: number;
  formNumber?: string;
  bbox?: unknown;
  order: number;
  path: string;
  metadata?: unknown;
  hasChildren: boolean;
  children?: PublicSourceNode[];
};

async function canReadPolicySourceNodes(
  ctx: Pick<QueryCtx, "auth" | "db">,
  policyId: Id<"policies">,
  allowOperatorAccess = false,
) {
  try {
    if (await getPolicyAccessForQuery(ctx as QueryCtx, policyId)) return true;
  } catch {
    // Fall through to the operator check. Unauthenticated callers still fail.
  }
  return allowOperatorAccess
    ? Boolean(await getActiveOperatorProfile(ctx as QueryCtx))
    : false;
}

function likelyHasChildNodes(node: SourceNodeDoc) {
  if (
    node.kind === "text" &&
    node.metadata &&
    typeof node.metadata === "object" &&
    !Array.isArray(node.metadata) &&
    (node.metadata as Record<string, unknown>).organizer === "title_block"
  ) {
    return true;
  }
  return !["text", "table_cell"].includes(node.kind);
}

function metadataRecord(node: SourceNodeDoc) {
  return node.metadata && typeof node.metadata === "object" && !Array.isArray(node.metadata)
    ? node.metadata as Record<string, unknown>
    : undefined;
}

const SEMANTIC_OUTLINE_KINDS = new Set([
  "page_group",
  "form",
  "endorsement",
  "section",
  "schedule",
  "clause",
]);

const OUTLINE_NODE_KINDS = new Set([
  ...SEMANTIC_OUTLINE_KINDS,
  "page",
  "table",
]);

const DIRECT_CONTENT_OUTLINE_KINDS = new Set([
  "text",
  "table",
]);

const CONTENT_PARENT_OUTLINE_KINDS = new Set([
  "page_group",
  "form",
  "endorsement",
]);

const CONTENT_OUTLINE_KINDS = new Set([
  "endorsement",
  "section",
  "schedule",
  "clause",
  "table",
]);

function isOutlineNode(node: SourceNodeDoc) {
  return OUTLINE_NODE_KINDS.has(node.kind);
}

function isDirectContentOutlineNode(node: OutlineShapeNode) {
  return DIRECT_CONTENT_OUTLINE_KINDS.has(node.kind);
}

function hasSemanticOutlineChildren(nodes: OutlineShapeNode[]) {
  return nodes.some((node) => SEMANTIC_OUTLINE_KINDS.has(node.kind));
}

function isDeclarationsGroup(node: Pick<SourceNodeDoc, "kind" | "title"> | OutlineShapeNode | undefined) {
  return Boolean(node?.kind === "page_group" && /^declarations?$/i.test(node.title));
}

function isDeclarationPolicyTitleWrapper(parent: OutlineShapeNode, node: OutlineShapeNode) {
  if (!isDeclarationsGroup(parent) || node.kind !== "section") return false;
  const title = cleanNodeText(node.title);
  if (!title || title.length > 140) return false;
  if (/^(?:item\s+\d+|section|part|article|schedule|endorsement|exclusion|condition|definition|coverage\s+part)\b/i.test(title)) {
    return false;
  }
  return /\b(?:insurance|liability|policy)\b/i.test(title);
}

function hasBlockingSemanticOutlineChildren(parent: OutlineShapeNode, nodes: OutlineShapeNode[]) {
  return nodes.some((node) =>
    SEMANTIC_OUTLINE_KINDS.has(node.kind) &&
    !isDeclarationPolicyTitleWrapper(parent, node),
  );
}

function shouldInlineOutlineChildren(node: SourceNodeDoc) {
  return !["table", "table_row", "table_cell", "text"].includes(node.kind);
}

function cleanNodeText(value: string | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function sourceNodeSearchText(node: Pick<SourceNodeDoc, "title" | "description" | "textExcerpt">) {
  return cleanNodeText([node.title, node.description, node.textExcerpt].filter(Boolean).join(" "));
}

function isNoticesAndJacketNode(node: Pick<SourceNodeDoc, "kind" | "title"> | undefined) {
  return Boolean(node?.kind === "page_group" && /^notices?\s+and\s+jacket$/i.test(node.title));
}

function hasSignificantNoticePageValue(node: Pick<SourceNodeDoc, "title" | "description" | "textExcerpt">) {
  const text = sourceNodeSearchText(node);
  return /\b(important notice|how to report a claim|privacy notice|ofac|terrorism risk insurance act|tria|trade or economic sanctions|economic sanctions limitation|sanctions limitation|declarations page|coverage part|named insured|premium|forms? and endorsements?|endorsement no\.?)\b/i.test(text);
}

function isLowValueJacketPage(node: Pick<SourceNodeDoc, "title" | "description" | "textExcerpt">) {
  const text = sourceNodeSearchText(node);
  return /\b(admitted stock insurance company|organized under the laws|home office|corporate secretary|president and ceo|countersigned|licensed resident agent|signature)\b/i.test(text) &&
    !hasSignificantNoticePageValue(node);
}

function shouldShowOutlineChild(parent: OutlineShapeNode | undefined, node: OutlineShapeNode) {
  if (node.kind !== "page") return true;
  if (isNoticesAndJacketNode(parent)) return hasSignificantNoticePageValue(node);
  return !isLowValueJacketPage(node);
}

function shouldHidePageChildrenBehindStoredContent(parent: SourceNodeDoc, children: SourceNodeDoc[]) {
  if (isNoticesAndJacketNode(parent)) return false;
  if (!["page_group", "form", "endorsement"].includes(parent.kind)) return false;
  return children.some((child) => CONTENT_OUTLINE_KINDS.has(child.kind));
}

export function shapeDirectContentOutlineChildren<T extends OutlineShapeNode>(
  parent: T,
  children: T[],
  childNodesByNodeId: ReadonlyMap<string, T[]>,
): T[] | undefined {
  if (!CONTENT_PARENT_OUTLINE_KINDS.has(parent.kind) || isNoticesAndJacketNode(parent)) {
    return undefined;
  }

  const visibleOutlineChildren = children.filter((child) =>
    OUTLINE_NODE_KINDS.has(child.kind) && shouldShowOutlineChild(parent, child),
  );
  if (hasBlockingSemanticOutlineChildren(parent, visibleOutlineChildren)) return undefined;

  const directChildren = children.filter(isDirectContentOutlineNode);
  for (const child of visibleOutlineChildren) {
    if (child.kind === "page") {
      const pageChildren = childNodesByNodeId.get(child.nodeId) ?? [];
      const pageOutlineChildren = pageChildren.filter((pageChild) => OUTLINE_NODE_KINDS.has(pageChild.kind));
      if (hasSemanticOutlineChildren(pageOutlineChildren)) return undefined;
      directChildren.push(...pageChildren.filter(isDirectContentOutlineNode));
    } else if (isDeclarationPolicyTitleWrapper(parent, child)) {
      directChildren.push(...(childNodesByNodeId.get(child.nodeId) ?? []).filter(isDirectContentOutlineNode));
    }
  }

  if (directChildren.length === 0) return undefined;
  return [...directChildren].sort((left, right) => left.order - right.order);
}

async function directContentOutlineChildren(
  ctx: Pick<QueryCtx, "db">,
  policyId: Id<"policies">,
  parent: SourceNodeDoc,
  children: SourceNodeDoc[],
): Promise<SourceNodeDoc[] | undefined> {
  if (!CONTENT_PARENT_OUTLINE_KINDS.has(parent.kind) || isNoticesAndJacketNode(parent)) {
    return undefined;
  }
  const visibleOutlineChildren = children.filter((child) =>
    OUTLINE_NODE_KINDS.has(child.kind) && shouldShowOutlineChild(parent, child),
  );
  if (hasBlockingSemanticOutlineChildren(parent, visibleOutlineChildren)) return undefined;

  const visiblePageChildren = visibleOutlineChildren.filter((child) => child.kind === "page");
  const wrapperChildren = visibleOutlineChildren.filter((child) =>
    isDeclarationPolicyTitleWrapper(parent, child),
  );
  const childNodesByNodeId = new Map<string, SourceNodeDoc[]>();
  for (const node of [...visiblePageChildren, ...wrapperChildren]) {
    childNodesByNodeId.set(node.nodeId, await childNodes(ctx, policyId, node.nodeId));
  }
  return shapeDirectContentOutlineChildren(parent, children, childNodesByNodeId);
}

function publicSourceNode(
  node: SourceNodeDoc,
  hasChildren: boolean,
  children?: PublicSourceNode[],
) {
  const metadata = metadataRecord(node);
  return {
    _id: node._id,
    _creationTime: node._creationTime,
    id: node.nodeId,
    nodeId: node.nodeId,
    documentId: node.documentId,
    parentNodeId: node.parentNodeId,
    title: node.title,
    type: node.kind,
    label: node.kind,
    description: node.description,
    excerpt: node.textExcerpt,
    content: node.textExcerpt,
    sourceSpanIds: node.sourceSpanIds,
    pageStart: node.pageStart,
    pageEnd: node.pageEnd,
    formNumber: typeof metadata?.formNumber === "string" ? metadata.formNumber : undefined,
    bbox: node.bbox,
    order: node.order,
    path: node.path,
    metadata: node.metadata,
    hasChildren,
    children,
  };
}

async function childNodes(
  ctx: Pick<QueryCtx, "db">,
  policyId: Id<"policies">,
  parentNodeId: string,
) {
  const children = await ctx.db
    .query("sourceNodes")
    .withIndex("policy_parent", (q) =>
      q.eq("policyId", policyId).eq("parentNodeId", parentNodeId),
    )
    .collect();
  return children.sort((left, right) => left.order - right.order);
}

async function publicChildNodes(
  ctx: Pick<QueryCtx, "db">,
  policyId: Id<"policies">,
  parentNodeId: string,
): Promise<PublicSourceNode[]> {
  const children = await childNodes(ctx, policyId, parentNodeId);
  return Promise.all(children.map(async (node: SourceNodeDoc) => {
    if (
      node.kind !== "table" &&
      node.kind !== "table_row" &&
      !(node.kind === "text" && likelyHasChildNodes(node))
    ) {
      return publicSourceNode(node, likelyHasChildNodes(node));
    }
    return publicSourceNode(
      node,
      true,
      await publicChildNodes(ctx, policyId, node.nodeId),
    );
  }));
}

async function publicOutlineChildren(
  ctx: Pick<QueryCtx, "db">,
  policyId: Id<"policies">,
  parent: SourceNodeDoc,
): Promise<PublicSourceNode[]> {
  const children = await childNodes(ctx, policyId, parent.nodeId);
  const outlineChildren = children
    .filter((child) => isOutlineNode(child) && shouldShowOutlineChild(parent, child));
  const directChildren = await directContentOutlineChildren(ctx, policyId, parent, children);
  const visibleChildren = directChildren ??
    (shouldHidePageChildrenBehindStoredContent(parent, outlineChildren)
      ? outlineChildren.filter((child) => child.kind !== "page")
      : outlineChildren);
  return Promise.all(visibleChildren.map(async (node: SourceNodeDoc) => {
    if (!shouldInlineOutlineChildren(node)) {
      return publicSourceNode(node, likelyHasChildNodes(node));
    }
    const outlineChildren = await publicOutlineChildren(ctx, policyId, node);
    return publicSourceNode(
      node,
      likelyHasChildNodes(node),
      outlineChildren.length > 0 ? outlineChildren : undefined,
    );
  }));
}

async function topLevelSourceNodes(
  ctx: Pick<QueryCtx, "db">,
  policyId: Id<"policies">,
) {
  const rootCandidates = await ctx.db
    .query("sourceNodes")
    .withIndex("policy_parent", (q) =>
      q.eq("policyId", policyId).eq("parentNodeId", undefined),
    )
    .collect();
  const root = rootCandidates.find((node) => node.kind === "document");
  const topLevel = root
    ? await childNodes(ctx, policyId, root.nodeId)
    : rootCandidates
      .filter((node) => node.kind !== "document")
      .sort((left, right) => left.order - right.order);
  return { root, topLevel };
}

export const listOutlineByPolicy = query({
  args: {
    policyId: v.id("policies"),
    allowOperatorAccess: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (!await canReadPolicySourceNodes(ctx, args.policyId, args.allowOperatorAccess)) return [];

    const { topLevel } = await topLevelSourceNodes(ctx, args.policyId);
    const hasSemanticTopLevel = topLevel.some((node) => SEMANTIC_OUTLINE_KINDS.has(node.kind));
    if (!hasSemanticTopLevel) {
      return Promise.all(topLevel.map(async (node) =>
        publicSourceNode(node, likelyHasChildNodes(node)),
      ));
    }

    const outlineTopLevel = topLevel.filter((node) => isOutlineNode(node) && shouldShowOutlineChild(undefined, node));
    return Promise.all(outlineTopLevel.map(async (node) => {
      if (!shouldInlineOutlineChildren(node)) {
        return publicSourceNode(node, likelyHasChildNodes(node));
      }
      const outlineChildren = await publicOutlineChildren(ctx, args.policyId, node);
      return publicSourceNode(
        node,
        likelyHasChildNodes(node),
        outlineChildren.length > 0 ? outlineChildren : undefined,
      );
    }));
  },
});

export const listChildrenByPolicyAndParentNodeId = query({
  args: {
    policyId: v.id("policies"),
    parentNodeId: v.string(),
    allowOperatorAccess: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (!await canReadPolicySourceNodes(ctx, args.policyId, args.allowOperatorAccess)) return [];
    return await publicChildNodes(ctx, args.policyId, args.parentNodeId);
  },
});

export const listByPolicy = query({
  args: {
    policyId: v.id("policies"),
    allowOperatorAccess: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (!await canReadPolicySourceNodes(ctx, args.policyId, args.allowOperatorAccess)) return [];
    const nodes = await ctx.db
      .query("sourceNodes")
      .withIndex("policy", (q) => q.eq("policyId", args.policyId))
      .collect();
    const childParentIds = new Set(
      nodes
        .map((node) => node.parentNodeId)
        .filter((parentNodeId): parentNodeId is string => Boolean(parentNodeId)),
    );
    return nodes
      .sort((left, right) => left.order - right.order)
      .map((node) => publicSourceNode(node, childParentIds.has(node.nodeId)));
  },
});

export const listByPolicyAndNodeIds = query({
  args: {
    policyId: v.id("policies"),
    nodeIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    if (!await canReadPolicySourceNodes(ctx, args.policyId)) return [];
    const wanted = new Set(args.nodeIds);
    if (wanted.size === 0) return [];

    const byId = new Map<string, SourceNodeDoc>();
    const loadNode = async (nodeId: string) => {
      if (byId.has(nodeId)) return byId.get(nodeId);
      const node = await ctx.db
        .query("sourceNodes")
        .withIndex("policy_node", (q) =>
          q.eq("policyId", args.policyId).eq("nodeId", nodeId),
        )
        .first();
      if (node) byId.set(nodeId, node);
      return node;
    };

    for (const nodeId of wanted) {
      let node = await loadNode(nodeId);
      while (node?.parentNodeId) {
        node = await loadNode(node.parentNodeId);
      }
    }

    for (const nodeId of wanted) {
      const children = await childNodes(ctx, args.policyId, nodeId);
      for (const child of children) byId.set(child.nodeId, child);
    }

    return Promise.all(
      [...byId.values()]
        .sort((left, right) => left.order - right.order)
        .map(async (node) =>
          publicSourceNode(node, likelyHasChildNodes(node)),
        ),
    );
  },
});

export const hasNodesForPolicy = internalQuery({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const first = await ctx.db
      .query("sourceNodes")
      .withIndex("policy", (q) => q.eq("policyId", args.policyId))
      .first();
    return first !== null;
  },
});

export const insertNodesBatch = internalMutation({
  args: {
    nodes: v.array(v.object(sourceNodeInsertFields)),
  },
  handler: async (ctx, args) => {
    const inserted = [];
    for (const node of args.nodes) {
      inserted.push(await ctx.db.insert("sourceNodes", node));
    }
    return { inserted: inserted.length };
  },
});

export const deleteByPolicy = internalMutation({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const nodes = await ctx.db
      .query("sourceNodes")
      .withIndex("policy", (q) => q.eq("policyId", args.policyId))
      .take(50);
    for (const node of nodes) await ctx.db.delete(node._id);
    return { deleted: nodes.length };
  },
});

/** Full-text source-node hits within one policy. */
export const searchInternal = internalQuery({
  args: {
    policyId: v.id("policies"),
    query: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("sourceNodes")
      .withSearchIndex("search_description", (q) =>
        q.search("description", args.query).eq("policyId", args.policyId),
      )
      .take(Math.max(1, Math.min(Math.floor(args.limit), 100)));
  },
});
