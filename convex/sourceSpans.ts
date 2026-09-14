import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { getPolicyAccessForQuery } from "./lib/access";
import { getActiveOperatorProfile } from "./lib/operatorIdentity";

const sourceKindValidator = v.union(
  v.literal("policy_pdf"),
  v.literal("email"),
  v.literal("attachment"),
  v.literal("manual_note"),
);

const sourceSpanInsertFields = {
  orgId: v.id("organizations"),
  policyId: v.optional(v.id("policies")),
  spanId: v.string(),
  documentId: v.string(),
  sourceKind: sourceKindValidator,
  pageStart: v.optional(v.number()),
  pageEnd: v.optional(v.number()),
  sectionId: v.optional(v.string()),
  formNumber: v.optional(v.string()),
  sourceUnit: v.optional(v.string()),
  parentSpanId: v.optional(v.string()),
  table: v.optional(v.any()),
  location: v.optional(v.any()),
  text: v.string(),
  textHash: v.string(),
  bbox: v.optional(v.any()),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
};

type SourceSpanDoc = Doc<"sourceSpans">;
type ClientSourceSpan = Pick<
  SourceSpanDoc,
  | "spanId"
  | "pageStart"
  | "pageEnd"
  | "sectionId"
  | "formNumber"
  | "sourceUnit"
  | "parentSpanId"
  | "location"
  | "text"
  | "bbox"
> & {
  table?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

const BULK_SPAN_LOOKUP_THRESHOLD = 32;
const MAX_CLIENT_SPAN_LOOKUP_IDS = 256;
const MAX_PARENT_LOOKUP_ROUNDS = 8;

function parentFor(span: SourceSpanDoc) {
  const metadata = span.metadata && typeof span.metadata === "object"
    ? span.metadata as Record<string, unknown>
    : {};
  const table = span.table && typeof span.table === "object"
    ? span.table as Record<string, unknown>
    : {};
  const parent =
    span.parentSpanId ??
    table.rowSpanId ??
    table.tableSpanId ??
    metadata.parentSpanId ??
    metadata.rowSpanId ??
    metadata.tableSpanId;
  return typeof parent === "string" && parent.length > 0 ? parent : undefined;
}

function compactObjectKeys(
  value: unknown,
  keys: string[],
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const compacted: Record<string, unknown> = {};
  for (const key of keys) {
    const item = source[key];
    if (item !== undefined) compacted[key] = item;
  }
  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

function clientSpan(span: SourceSpanDoc): ClientSourceSpan {
  const table = compactObjectKeys(span.table, ["rowSpanId", "tableSpanId"]);
  const metadata = compactObjectKeys(span.metadata, [
    "sourceUnit",
    "elementType",
    "parentSpanId",
    "rowSpanId",
    "tableSpanId",
    "bboxCoordinateWidth",
    "bboxCoordinateHeight",
    "pageWidth",
    "pageHeight",
  ]);
  return {
    spanId: span.spanId,
    pageStart: span.pageStart,
    pageEnd: span.pageEnd,
    sectionId: span.sectionId,
    formNumber: span.formNumber,
    sourceUnit: span.sourceUnit,
    parentSpanId: span.parentSpanId,
    table,
    location: span.location,
    text: span.text,
    bbox: span.bbox,
    metadata,
  };
}

export const listSpansByPolicyAndSpanIds = query({
  args: {
    policyId: v.id("policies"),
    spanIds: v.array(v.string()),
    allowOperatorAccess: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const policyAccess = await getPolicyAccessForQuery(ctx, args.policyId);
    if (!policyAccess) {
      const operatorAccess = args.allowOperatorAccess
        ? await getActiveOperatorProfile(ctx)
        : null;
      if (!operatorAccess) return [];
    }

    const wanted = new Set([...new Set(args.spanIds)].slice(0, MAX_CLIENT_SPAN_LOOKUP_IDS));
    if (wanted.size === 0) return [];
    const relatedIds = new Set(wanted);
    const byId = new Map<string, SourceSpanDoc>();
    let policySpanMap: Map<string, SourceSpanDoc> | undefined;
    if (wanted.size >= BULK_SPAN_LOOKUP_THRESHOLD) {
      const spans = await ctx.db
        .query("sourceSpans")
        .withIndex("policy", (q) => q.eq("policyId", args.policyId))
        .collect();
      policySpanMap = new Map(spans.map((span) => [span.spanId, span]));
    }
    const loadSpan = async (spanId: string) => {
      if (byId.has(spanId)) return byId.get(spanId);
      if (policySpanMap) {
        const span = policySpanMap.get(spanId);
        if (span) byId.set(spanId, span);
        return span;
      }
      const span = await ctx.db
        .query("sourceSpans")
        .withIndex("policy_span", (q) =>
          q.eq("policyId", args.policyId).eq("spanId", spanId),
        )
        .first();
      if (span) byId.set(spanId, span);
      return span;
    };

    let changed = true;
    let rounds = 0;
    while (changed && rounds < MAX_PARENT_LOOKUP_ROUNDS) {
      rounds += 1;
      changed = false;
      for (const spanId of [...relatedIds]) {
        const span = await loadSpan(spanId);
        if (!span) continue;
        const parentId = parentFor(span);
        if (parentId && !relatedIds.has(parentId)) {
          relatedIds.add(parentId);
          changed = true;
        }
      }
    }

    return [...relatedIds]
      .map((spanId) => byId.get(spanId))
      .filter((span): span is NonNullable<typeof span> => Boolean(span))
      .map(clientSpan);
  },
});

export const listSpansByPolicyInternal = internalQuery({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("sourceSpans")
      .withIndex("policy", (q) => q.eq("policyId", args.policyId))
      .collect();
  },
});

export const hasSpansForOrg = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const first = await ctx.db
      .query("sourceSpans")
      .withIndex("organization", (q) => q.eq("orgId", args.orgId))
      .first();
    return first !== null;
  },
});

export const insertSpansBatch = internalMutation({
  args: {
    spans: v.array(v.object(sourceSpanInsertFields)),
  },
  handler: async (ctx, args) => {
    const inserted = [];
    for (const span of args.spans) {
      inserted.push(await ctx.db.insert("sourceSpans", span));
    }
    return { inserted: inserted.length };
  },
});

export const deleteByPolicy = internalMutation({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const spans = await ctx.db
      .query("sourceSpans")
      .withIndex("policy", (q) => q.eq("policyId", args.policyId))
      .take(100);
    for (const span of spans) await ctx.db.delete(span._id);
    return { deleted: spans.length };
  },
});
