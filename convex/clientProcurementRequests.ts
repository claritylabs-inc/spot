import dayjs from "dayjs";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { getCurrentOrgAccess } from "./lib/access";
import {
  findReusableClientFileByContent,
  normalizeClientFileSha256,
} from "./lib/clientFiles";
import { createProcurementInboxToken } from "./lib/procurement";
import {
  requestNarrative,
  seedNarrativePacketSection,
} from "./lib/procurementNarrative";
import { assemblePacketMarkdown } from "./lib/procurementPacket";

async function createUniqueInboxToken(ctx: MutationCtx) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inboxToken = createProcurementInboxToken();
    const existing = await ctx.db
      .query("procurementRequests")
      .withIndex("inbox", (index) => index.eq("inboxToken", inboxToken))
      .first();
    if (!existing) return inboxToken;
  }
  throw new Error("Could not create a unique procurement forwarding address");
}

function optionalEffectiveDate(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(normalized) ||
    !dayjs(normalized).isValid() ||
    dayjs(normalized).format("YYYY-MM-DD") !== normalized
  ) {
    throw new Error("Effective date must use YYYY-MM-DD");
  }
  return normalized;
}

function clientStatus(status: Doc<"procurementRequests">["status"]) {
  if (status === "draft" || status === "submitted") return "submitted" as const;
  if (status === "gathering_information") return "information_needed" as const;
  if (
    [
      "marketing",
      "proposal_review",
      "quote_review",
      "client_decision",
    ].includes(status)
  )
    return "in_progress" as const;
  if (["binding", "accepted"].includes(status)) return "finalizing" as const;
  if (["completed", "closed"].includes(status)) return "completed" as const;
  return "cancelled" as const;
}

type Ctx = QueryCtx | MutationCtx;

async function requireClientMembership(ctx: Ctx) {
  const access = await getCurrentOrgAccess(ctx);
  if (!access || access.orgType !== "client")
    throw new Error("Client membership required");
  return access;
}

async function requireVisibleRequest(
  ctx: Ctx,
  requestId: Id<"procurementRequests">,
) {
  const access = await requireClientMembership(ctx);
  const request = await ctx.db.get(requestId);
  if (
    !request ||
    request.clientOrgId !== access.orgId ||
    !request.clientVisible
  )
    throw new Error("Request not found");
  return { access, request };
}

async function requestDto(ctx: QueryCtx, request: Doc<"procurementRequests">) {
  const [fileItems, resultingPolicy, packetSections] = await Promise.all([
    ctx.db
      .query("procurementFileItems")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .collect(),
    request.resultingPolicyId ? ctx.db.get(request.resultingPolicyId) : null,
    ctx.db
      .query("procurementPacketSections")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .collect(),
  ]);
  const files = await Promise.all(
    fileItems
      .filter((item) => item.clientVisible === true && item.clientFileId)
      .map(async (item) => {
        const file = await ctx.db.get(item.clientFileId!);
        if (!file || file.archivedAt || file.deletedAt) return null;
        return {
          _id: item._id,
          clientFileId: file._id,
          name: item.label || file.name,
          contentType: file.contentType,
          size: file.size,
          uploadedBySide: file.uploadedBySide,
          createdAt: item.createdAt,
          url: await ctx.storage.getUrl(file.fileId),
        };
      }),
  );
  return {
    _id: request._id,
    title: request.title,
    narrative: requestNarrative(request),
    packet: {
      markdown: assemblePacketMarkdown(packetSections, { audience: "client" }),
    },
    status: clientStatus(request.status),
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    targetEffectiveDate: request.targetEffectiveDate,
    resultingPolicy:
      resultingPolicy && !resultingPolicy.deletedAt
        ? {
            _id: resultingPolicy._id,
            carrier: resultingPolicy.carrier,
            policyNumber: resultingPolicy.policyNumber,
          }
        : undefined,
    files: files.filter((file): file is NonNullable<typeof file> => !!file),
  };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const access = await requireClientMembership(ctx);
    const rows = await ctx.db
      .query("procurementRequests")
      .withIndex("organization", (q) => q.eq("clientOrgId", access.orgId))
      .order("desc")
      .collect();
    return await Promise.all(
      rows
        .filter((row) => row.clientVisible)
        .map((row) => requestDto(ctx, row)),
    );
  },
});

export const get = query({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, args) =>
    requestDto(ctx, (await requireVisibleRequest(ctx, args.requestId)).request),
});

export const create = mutation({
  args: {
    title: v.string(),
    narrative: v.string(),
    targetEffectiveDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireClientMembership(ctx);
    const title = args.title.trim();
    const narrative = args.narrative.trim();
    if (!title || !narrative)
      throw new Error("Title and narrative are required");
    const now = dayjs().valueOf();
    const requestId = await ctx.db.insert("procurementRequests", {
      clientOrgId: access.orgId,
      title: title.slice(0, 200),
      narrative,
      targetEffectiveDate: optionalEffectiveDate(args.targetEffectiveDate),
      status: "submitted",
      clientVisible: true,
      requirementRevision: 0,
      specificationRevision: 0,
      inboxToken: await createUniqueInboxToken(ctx),
      createdByUserId: access.userId,
      updatedByUserId: access.userId,
      createdAt: now,
      updatedAt: now,
    });
    await seedNarrativePacketSection(ctx, {
      requestId,
      clientOrgId: access.orgId,
      narrative,
      userId: access.userId,
      source: "client",
    });
    await ctx.scheduler.runAfter(
      0,
      internal.procurementPacket.ensureRequestLinkInternal,
      { requestId, createdByUserId: access.userId },
    );
    return { requestId };
  },
});

export const generateUploadUrl = mutation({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, args) => {
    await requireVisibleRequest(ctx, args.requestId);
    return await ctx.storage.generateUploadUrl();
  },
});

export const attachFile = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    const { access, request } = await requireVisibleRequest(
      ctx,
      args.requestId,
    );
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata) throw new Error("Uploaded file not found");
    const createdAt = dayjs().valueOf();
    const fileName = args.fileName.trim() || "Document";
    const sha256 = normalizeClientFileSha256(metadata.sha256);
    const reusableFile = await findReusableClientFileByContent(ctx, {
      orgId: request.clientOrgId,
      sha256,
    });
    const clientFileId = reusableFile
      ? reusableFile._id
      : await ctx.db.insert("clientFiles", {
          orgId: request.clientOrgId,
          fileId: args.storageId,
          name: fileName,
          originalName: fileName,
          contentType: metadata.contentType || args.contentType,
          size: metadata.size,
          sha256,
          clientVisible: true,
          uploadedByUserId: access.userId,
          uploadedBySide: "client",
          nameSource: "original",
          nameStatus: "ready",
          createdAt,
          updatedAt: createdAt,
        });
    if (reusableFile) {
      await ctx.storage.delete(args.storageId);
      if (!reusableFile.clientVisible)
        await ctx.db.patch(reusableFile._id, {
          clientVisible: true,
          updatedAt: createdAt,
        });
    }
    const existingItems = await ctx.db
      .query("procurementFileItems")
      .withIndex("file", (query) => query.eq("clientFileId", clientFileId))
      .collect();
    const existingItem = existingItems.find(
      (item) => item.requestId === request._id && item.clientVisible === true,
    );
    if (existingItem) return { clientFileId, fileItemId: existingItem._id };
    const fileItemId = await ctx.db.insert("procurementFileItems", {
      requestId: request._id,
      clientOrgId: request.clientOrgId,
      clientFileId,
      purpose: "other",
      label: fileName,
      status: "available",
      clientVisible: true,
      createdByUserId: access.userId,
      updatedByUserId: access.userId,
      createdAt,
      updatedAt: createdAt,
    });
    return { clientFileId, fileItemId };
  },
});
