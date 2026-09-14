import { saveMarkdownDocument } from "./markdownDocuments";
import {
  parseMarkdownDocument,
  stringifyMarkdownDocument,
  replaceMarkdownHeading,
  parseDocumentVisibility,
} from "./lib/markdownDocument";
import {
  readPacketDocument,
  readPacketProjection,
  migratePacketDocuments,
  packetFileVisibility,
} from "./lib/packetDocuments";
import dayjs from "dayjs";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { getClientPortalUrl } from "./lib/domains";
import {
  createMagicLinkToken,
  hashMagicLinkToken,
} from "./lib/magicLinkTokens";
import {
  requireOperator,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import { requireDirectOperatorWrite } from "./procurementRequests";
import { readOrgWiki } from "./orgWiki";
import {
  assemblePacketMarkdown,
  composeRequestMarkdown,
  defaultPacketSection,
  type PacketAudience,
} from "./lib/procurementPacket";

const audienceValidator = v.union(
  v.literal("operator"),
  v.literal("client"),
  v.literal("broker"),
);

function packetLinkStatus(
  link: Pick<
    Doc<"procurementPacketLinks">,
    "revokedAt" | "expiresAt" | "packetRevisionAtIssue"
  >,
  packetRevision: number,
  now: number,
) {
  return {
    state: link.revokedAt
      ? ("revoked" as const)
      : link.expiresAt !== undefined && link.expiresAt <= now
        ? ("expired" as const)
        : ("active" as const),
    stale: link.packetRevisionAtIssue !== packetRevision,
  };
}

async function requestForOperator(
  ctx: QueryCtx | MutationCtx,
  requestId: Id<"procurementRequests">,
) {
  const request = await ctx.db.get(requestId);
  if (!request) throw new Error("Procurement request not found");
  return request;
}

async function directOperator(ctx: MutationCtx, userId: Id<"users">) {
  await requireOperatorForUser(ctx, userId);
  await requireDirectOperatorWrite(ctx, userId);
}

export async function updatePacketDocumentByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    requestId: Id<"procurementRequests">;
    filename: string;
    markdown: string;
    expectedRevision: number;
  },
) {
  await directOperator(ctx, args.operatorUserId);
  const request = await requestForOperator(ctx, args.requestId);
  const previous = await readPacketDocument(ctx, request, args.filename);
  if (previous.revision !== args.expectedRevision)
    throw new Error(
      "The packet changed while you were editing. Reload it before saving.",
    );
  const parsed = parseMarkdownDocument(args.markdown);
  const visibility = packetFileVisibility(args.filename);
  if (parseDocumentVisibility(args.markdown, visibility) !== visibility)
    throw new Error(`${args.filename} must use visibility: ${visibility}`);
  const markdown = stringifyMarkdownDocument(
    { ...parsed.frontmatter, visibility },
    parsed.body,
  );
  // Materialize and retire the legacy source in this same transaction before
  // applying an intentional edit, so the later backfill cannot resurrect it.
  await migratePacketDocuments(ctx, request._id);
  const canonical = await readPacketDocument(ctx, request, args.filename);
  const document = await saveMarkdownDocument(ctx, {
    orgId: request.clientOrgId,
    requestId: request._id,
    kind: "packet",
    filename: args.filename,
    markdown,
    expectedRevision: canonical.revision,
  });
  const changed = previous.markdown !== markdown;
  if (changed && (visibility === "shared" || previous.visibility === "shared"))
    await ctx.db.patch(request._id, {
      packetRevision: (request.packetRevision ?? 0) + 1,
      updatedByUserId: args.operatorUserId,
      updatedAt: dayjs().valueOf(),
    });
  const auditEventId = await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: request.clientOrgId,
    summary: `Updated ${document.filename} on ${request.title}`,
    metadata: {
      domain: "procurement",
      requestId: request._id,
      documentId: document._id,
      operation: "update_packet_document",
      filename: args.filename,
      visibility,
    },
  });
  return { id: document._id, revision: document.revision, auditEventId };
}

// Compatibility adapter for local fixture builders. The stored owner is the
// Markdown document; new APIs edit it as a whole with a revision check.
export async function upsertPacketSectionByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    requestId: Id<"procurementRequests">;
    key: string;
    body: string;
    heading?: string;
    audience?: PacketAudience;
    source?: Doc<"procurementPacketSections">["source"];
    sourceRefs?: string[];
  },
) {
  await directOperator(ctx, args.operatorUserId);
  const request = await requestForOperator(ctx, args.requestId);
  const canonical = defaultPacketSection(args.key);
  const visibility = args.audience ?? canonical.defaultAudience;
  if (canonical.sensitive && visibility !== "operator")
    throw new Error("Sensitive packet content requires operator visibility");
  const filename = visibility === "operator" ? "private.md" : "public.md";
  const previous = await readPacketDocument(ctx, request, filename);
  const parsed = parseMarkdownDocument(previous.markdown);
  return await updatePacketDocumentByOperator(ctx, {
    operatorUserId: args.operatorUserId,
    requestId: args.requestId,
    filename,
    expectedRevision: previous.revision,
    markdown: stringifyMarkdownDocument(
      {
        ...parsed.frontmatter,
        visibility: visibility === "operator" ? "private" : "shared",
      },
      replaceMarkdownHeading(
        parsed.body,
        args.heading ?? canonical.heading,
        args.body.trim(),
      ),
    ),
  });
}

export async function listPacketDocuments(
  ctx: QueryCtx | MutationCtx,
  args: { requestId: Id<"procurementRequests">; audience?: PacketAudience },
) {
  const request = await requestForOperator(ctx, args.requestId);
  const audience = args.audience ?? "operator";
  const projection = await readPacketProjection(ctx, request, audience);
  const wiki =
    audience === "operator"
      ? await readOrgWiki(ctx, request.clientOrgId)
      : null;
  return {
    requestId: request._id,
    packetRevision: request.packetRevision ?? 0,
    documents: projection.documents,
    clientWiki: wiki
      ? {
          orgId: wiki.orgId,
          filename: wiki.filename,
          revision: wiki.revision,
          markdown: wiki.markdown,
        }
      : null,
    markdown: composeRequestMarkdown({
      wikiMarkdown: wiki?.markdown ?? "",
      packetMarkdown: projection.markdown,
    }),
  };
}

async function brokerPacketProjection(
  ctx: QueryCtx | MutationCtx,
  args: {
    requestId: Id<"procurementRequests">;
    outreachId?: Id<"procurementBrokerOutreaches">;
  },
) {
  const request = await requestForOperator(ctx, args.requestId);
  const outreach = args.outreachId ? await ctx.db.get(args.outreachId) : null;
  if (args.outreachId && (!outreach || outreach.requestId !== request._id))
    throw new Error("Outreach does not belong to this request");
  const [projection, fileItems] = await Promise.all([
    readPacketProjection(ctx, request, "client"),
    ctx.db
      .query("procurementFileItems")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .collect(),
  ]);
  const visibleSections = projection.sections.map(
    ({ key, heading, body, order }) => ({ key, heading, body, order }),
  );
  const files = (
    await Promise.all(
      fileItems
        .filter(
          (item) =>
            (!item.outreachId ||
              (outreach !== null && item.outreachId === outreach._id)) &&
            (item.brokerRelease === "listed" ||
              item.brokerRelease === "attached"),
        )
        .map(async (item) => {
          const file = item.clientFileId
            ? await ctx.db.get(item.clientFileId)
            : null;
          if (
            !file ||
            file.orgId !== request.clientOrgId ||
            file.deletedAt ||
            file.archivedAt
          )
            return null;
          return {
            fileItemId: item._id,
            clientFileId: file._id,
            name: item.label || file.name,
            contentType: file.contentType,
            size: file.size,
            purpose: item.purpose,
            release: item.brokerRelease as "listed" | "attached",
          };
        }),
    )
  ).filter((file): file is NonNullable<typeof file> => file !== null);
  return {
    request: {
      requestId: request._id,
      title: request.title,
      packetRevision: request.packetRevision ?? 0,
    },
    outreach: outreach
      ? {
          outreachId: outreach._id,
          brokerOrgId: outreach.brokerOrgId ?? null,
          brokerName: outreach.brokerName,
          recipientLabel: outreach.contactName || outreach.brokerName,
          recipientEmail: outreach.contactEmail ?? null,
        }
      : null,
    sections: visibleSections,
    markdown: assemblePacketMarkdown(
      visibleSections.map((section) => ({ ...section, audience: "broker" })),
      { audience: "broker" },
    ),
    files,
    gaps: [],
  };
}

export async function previewBrokerPacket(
  ctx: QueryCtx | MutationCtx,
  args: {
    requestId: Id<"procurementRequests">;
    outreachId?: Id<"procurementBrokerOutreaches">;
  },
) {
  return await brokerPacketProjection(ctx, args);
}

export const preview = query({
  args: {
    requestId: v.id("procurementRequests"),
    outreachId: v.optional(v.id("procurementBrokerOutreaches")),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    return await previewBrokerPacket(ctx, args);
  },
});

export async function listPacketLinksForOperator(
  ctx: QueryCtx | MutationCtx,
  requestId: Id<"procurementRequests">,
) {
  const request = await requestForOperator(ctx, requestId);
  const links = await ctx.db
    .query("procurementPacketLinks")
    .withIndex("request", (q) => q.eq("requestId", request._id))
    .order("desc")
    .collect();
  const now = dayjs().valueOf();
  return await Promise.all(
    links.map(async (link) => {
      const outreach = link.outreachId
        ? await ctx.db.get(link.outreachId)
        : null;
      return {
        linkId: link._id,
        outreachId: link.outreachId ?? null,
        brokerName: outreach?.brokerName ?? "All brokers",
        recipientLabel: link.recipientLabel,
        recipientEmail: link.recipientEmail ?? null,
        expiresAt: link.expiresAt,
        revokedAt: link.revokedAt ?? null,
        packetRevisionAtIssue: link.packetRevisionAtIssue,
        sectionCount: link.sectionSnapshot?.length ?? null,
        fileCount:
          link.artifactSnapshot?.length ??
          link.includedFileItemIds?.length ??
          null,
        includedFileItemIds:
          link.artifactSnapshot?.map((file) => file.fileItemId) ??
          link.includedFileItemIds ??
          null,
        includedArtifacts: link.artifactSnapshot ?? null,
        deliveryStatus: link.deliveryStatus ?? "not_sent",
        deliveryError: link.deliveryError ?? null,
        sentAt: link.sentAt ?? null,
        lastViewedAt: link.lastViewedAt ?? null,
        viewCount: link.viewCount,
        createdAt: link.createdAt,
        ...packetLinkStatus(link, request.packetRevision ?? 0, now),
      };
    }),
  );
}

export const listLinks = query({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    return await listPacketLinksForOperator(ctx, args.requestId);
  },
});

export const get = query({
  args: {
    requestId: v.id("procurementRequests"),
    audience: v.optional(audienceValidator),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    return await listPacketDocuments(ctx, args);
  },
});

export const updateDocument = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    filename: v.string(),
    markdown: v.string(),
    expectedRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return updatePacketDocumentByOperator(ctx, {
      ...args,
      operatorUserId: operator.userId,
    });
  },
});

export const mintLink = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    expiresAt: v.optional(v.number()),
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await directOperator(ctx, operator.userId);
    return mintPacketLinkForOperator(ctx, {
      ...args,
      operatorUserId: operator.userId,
    });
  },
});

/** An expiry is optional; explicit durations use the server clock. */
function requestedPacketLinkExpiry(
  now: number,
  args: { expiresAt?: number; expiresInDays?: number },
) {
  if (args.expiresInDays === undefined) return args.expiresAt;
  if (!Number.isSafeInteger(args.expiresInDays) || args.expiresInDays < 1)
    throw new Error(
      "Packet link lifetime must be a positive whole number of days",
    );
  return dayjs(now).add(args.expiresInDays, "day").valueOf();
}

async function createPacketLink(
  ctx: MutationCtx,
  args: {
    actorUserId: Id<"users">;
    auditOperatorUserId?: Id<"users">;
    requestId: Id<"procurementRequests">;
    outreachId?: Id<"procurementBrokerOutreaches">;
    recipientLabel?: string;
    recipientEmail?: string;
    expiresAt?: number;
    expiresInDays?: number;
  },
) {
  const request = await requestForOperator(ctx, args.requestId);
  const outreach = args.outreachId ? await ctx.db.get(args.outreachId) : null;
  if (args.outreachId && (!outreach || outreach.requestId !== request._id))
    throw new Error("Outreach does not belong to this request");
  const now = dayjs().valueOf();
  const preview = await brokerPacketProjection(ctx, {
    requestId: request._id,
    outreachId: outreach?._id,
  });
  const token = createMagicLinkToken();
  const requestedExpiry = requestedPacketLinkExpiry(now, args);
  if (
    requestedExpiry !== undefined &&
    (!Number.isFinite(requestedExpiry) || requestedExpiry <= now)
  )
    throw new Error("Packet link expiry must be in the future");
  const expiresAt = requestedExpiry;
  const replacedLinkIds: Id<"procurementPacketLinks">[] = [];
  if (!outreach) {
    const currentRequestLinks = await ctx.db
      .query("procurementPacketLinks")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .collect();
    for (const link of currentRequestLinks) {
      if (
        link.outreachId ||
        link.revokedAt ||
        (link.expiresAt !== undefined && link.expiresAt <= now)
      )
        continue;
      await ctx.db.patch(link._id, {
        revokedAt: now,
        revokedByUserId: args.actorUserId,
        updatedAt: now,
      });
      replacedLinkIds.push(link._id);
    }
  }
  const id = await ctx.db.insert("procurementPacketLinks", {
    requestId: request._id,
    clientOrgId: request.clientOrgId,
    outreachId: outreach?._id,
    tokenHash: await hashMagicLinkToken(token),
    recipientLabel:
      args.recipientLabel?.trim() || outreach?.brokerName || "All brokers",
    recipientEmail: args.recipientEmail?.trim().toLowerCase(),
    expiresAt,
    packetRevisionAtIssue: request.packetRevision ?? 0,
    sectionSnapshot: preview.sections,
    artifactSnapshot: preview.files.map((file) => ({
      fileItemId: file.fileItemId,
      clientFileId: file.clientFileId,
      name: file.name,
      release: file.release,
    })),
    includedFileItemIds: preview.files.map((file) => file.fileItemId),
    viewCount: 0,
    createdByUserId: args.actorUserId,
    createdAt: now,
    updatedAt: now,
  });
  if (outreach)
    await ctx.db.patch(outreach._id, {
      packetRevisionAtIssue: request.packetRevision ?? 0,
      updatedAt: now,
      updatedByUserId: args.actorUserId,
    });
  const auditEventId = args.auditOperatorUserId
    ? await writeOperatorAudit(ctx, {
        operatorUserId: args.auditOperatorUserId,
        type: "setup_write",
        targetOrgId: request.clientOrgId,
        summary: outreach
          ? `Created broker packet link for ${outreach.brokerName}`
          : replacedLinkIds.length
            ? "Replaced shared broker packet link"
            : "Created shared broker packet link",
        metadata: {
          domain: "procurement",
          operation: "create_packet_link",
          requestId: request._id,
          outreachId: outreach?._id,
          linkId: id,
          replacedLinkIds,
          expiresAt,
          packetRevisionAtIssue: request.packetRevision ?? 0,
          sectionCount: preview.sections.length,
          fileCount: preview.files.length,
        },
      })
    : null;
  return {
    id,
    token,
    url: `${getClientPortalUrl()}/share/packet/${token}`,
    expiresAt,
    audience: "broker" as const,
    packetRevisionAtIssue: request.packetRevision ?? 0,
    sectionCount: preview.sections.length,
    fileCount: preview.files.length,
    includedArtifacts: preview.files.map((file) => ({
      fileItemId: file.fileItemId,
      clientFileId: file.clientFileId,
      name: file.name,
      release: file.release,
    })),
    auditEventId,
  };
}

export async function mintPacketLinkForOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    requestId: Id<"procurementRequests">;
    outreachId?: Id<"procurementBrokerOutreaches">;
    recipientLabel?: string;
    recipientEmail?: string;
    expiresAt?: number;
    expiresInDays?: number;
  },
) {
  await directOperator(ctx, args.operatorUserId);
  return await createPacketLink(ctx, {
    ...args,
    actorUserId: args.operatorUserId,
    auditOperatorUserId: args.operatorUserId,
  });
}

export const ensureRequestLinkInternal = internalMutation({
  args: {
    requestId: v.id("procurementRequests"),
    createdByUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request || request.createdByUserId !== args.createdByUserId)
      return null;
    const now = dayjs().valueOf();
    const links = await ctx.db
      .query("procurementPacketLinks")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .collect();
    const active = links.find(
      (link) =>
        !link.outreachId &&
        !link.revokedAt &&
        (link.expiresAt === undefined || link.expiresAt > now),
    );
    if (active) return { id: active._id, created: false };
    const created = await createPacketLink(ctx, {
      actorUserId: args.createdByUserId,
      requestId: request._id,
    });
    return { id: created.id, created: true };
  },
});

export const mintLinkInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    requestId: v.id("procurementRequests"),
    outreachId: v.optional(v.id("procurementBrokerOutreaches")),
    recipientLabel: v.optional(v.string()),
    recipientEmail: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => mintPacketLinkForOperator(ctx, args),
});

export async function revokePacketLinkByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    linkId: Id<"procurementPacketLinks">;
  },
) {
  await directOperator(ctx, args.operatorUserId);
  const link = await ctx.db.get(args.linkId);
  if (!link) throw new Error("Packet link not found");
  const now = dayjs().valueOf();
  if (!link.revokedAt)
    await ctx.db.patch(link._id, {
      revokedAt: now,
      revokedByUserId: args.operatorUserId,
      updatedAt: now,
    });
  const auditEventId = !link.revokedAt
    ? await writeOperatorAudit(ctx, {
        operatorUserId: args.operatorUserId,
        type: "setup_write",
        targetOrgId: link.clientOrgId,
        summary: `Revoked broker packet link for ${link.recipientLabel}`,
        metadata: {
          domain: "procurement",
          operation: "revoke_packet_link",
          requestId: link.requestId,
          outreachId: link.outreachId,
          linkId: link._id,
        },
      })
    : null;
  return {
    linkId: link._id,
    revoked: !link.revokedAt,
    revokedAt: link.revokedAt ?? now,
    auditEventId,
  };
}

export const revokeLink = mutation({
  args: { linkId: v.id("procurementPacketLinks") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await revokePacketLinkByOperator(ctx, {
      operatorUserId: operator.userId,
      linkId: args.linkId,
    });
  },
});

export async function rotatePacketLinkByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    linkId: Id<"procurementPacketLinks">;
    expiresAt?: number;
    expiresInDays?: number;
  },
) {
  await directOperator(ctx, args.operatorUserId);
  const current = await ctx.db.get(args.linkId);
  if (!current) throw new Error("Packet link not found");
  await revokePacketLinkByOperator(ctx, args);
  return await mintPacketLinkForOperator(ctx, {
    operatorUserId: args.operatorUserId,
    requestId: current.requestId,
    outreachId: current.outreachId,
    recipientLabel: current.recipientLabel,
    recipientEmail: current.recipientEmail,
    expiresAt: args.expiresAt,
    expiresInDays: args.expiresInDays,
  });
}

export const rotateLink = mutation({
  args: {
    linkId: v.id("procurementPacketLinks"),
    expiresAt: v.optional(v.number()),
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await rotatePacketLinkByOperator(ctx, {
      operatorUserId: operator.userId,
      ...args,
    });
  },
});

export const recordDeliveryInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    linkId: v.id("procurementPacketLinks"),
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId);
    if (!link) throw new Error("Packet link not found");
    const now = dayjs().valueOf();
    await ctx.db.patch(link._id, {
      deliveryStatus: args.status,
      deliveryError: args.error,
      sentAt: args.status === "sent" ? now : link.sentAt,
      updatedAt: now,
    });
    if (args.status === "sent") {
      const outreach = link.outreachId
        ? await ctx.db.get(link.outreachId)
        : null;
      if (outreach)
        await ctx.db.patch(outreach._id, {
          sentAt: now,
          updatedByUserId: args.operatorUserId,
          updatedAt: now,
        });
    }
    const auditEventId =
      args.status !== "pending"
        ? await writeOperatorAudit(ctx, {
            operatorUserId: args.operatorUserId,
            type: "setup_write",
            targetOrgId: link.clientOrgId,
            summary: `${args.status === "sent" ? "Sent" : "Failed to send"} broker packet to ${link.recipientLabel}`,
            metadata: {
              domain: "procurement",
              operation: "send_packet",
              requestId: link.requestId,
              outreachId: link.outreachId,
              linkId: link._id,
              status: args.status,
              error: args.error,
            },
          })
        : null;
    return { auditEventId };
  },
});

export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const token = args.token.trim();
    if (!token) return null;
    const hash = await hashMagicLinkToken(token);
    const link = await ctx.db
      .query("procurementPacketLinks")
      .withIndex("token", (q) => q.eq("tokenHash", hash))
      .unique();
    const now = dayjs().valueOf();
    if (
      !link ||
      link.revokedAt ||
      (link.expiresAt !== undefined && link.expiresAt <= now)
    )
      return null;
    const request = await ctx.db.get(link.requestId);
    const outreach = link.outreachId ? await ctx.db.get(link.outreachId) : null;
    if (
      !request ||
      (link.outreachId && (!outreach || outreach.requestId !== request._id))
    )
      return null;
    const current = await readPacketProjection(ctx, request, "client");
    const visible = link.sectionSnapshot ?? current.sections;
    const fileItems = await ctx.db
      .query("procurementFileItems")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .collect();
    const currentItems = new Map(
      fileItems.map((item) => [String(item._id), item] as const),
    );
    const artifactSnapshot =
      link.artifactSnapshot ??
      fileItems
        .filter(
          (item) =>
            (!link.includedFileItemIds ||
              link.includedFileItemIds.includes(item._id)) &&
            (!item.outreachId ||
              (link.outreachId !== undefined &&
                item.outreachId === link.outreachId)) &&
            item.clientFileId &&
            (item.brokerRelease === "listed" ||
              item.brokerRelease === "attached"),
        )
        .map((item) => ({
          fileItemId: item._id,
          clientFileId: item.clientFileId!,
          name: item.label,
          release: item.brokerRelease as "listed" | "attached",
        }));
    const files = (
      await Promise.all(
        artifactSnapshot.map(async (snapshot) => {
          const item = currentItems.get(String(snapshot.fileItemId));
          if (
            !item ||
            item.requestId !== request._id ||
            (item.outreachId && item.outreachId !== link.outreachId) ||
            (item.brokerRelease !== "listed" &&
              item.brokerRelease !== "attached")
          )
            return null;
          const file = await ctx.db.get(snapshot.clientFileId);
          if (
            !file ||
            file.orgId !== link.clientOrgId ||
            file.deletedAt ||
            file.archivedAt
          )
            return null;
          const release: "listed" | "attached" =
            snapshot.release === "attached" && item.brokerRelease === "attached"
              ? "attached"
              : "listed";
          const siteUrl =
            process.env.CONVEX_SITE_URL?.trim() || getClientPortalUrl();
          const downloadUrl = new URL("/packet-file", siteUrl);
          downloadUrl.searchParams.set("token", token);
          downloadUrl.searchParams.set("item", snapshot.fileItemId);
          return {
            _id: snapshot.fileItemId,
            name: snapshot.name,
            brokerRelease: release,
            downloadUrl: release === "attached" ? downloadUrl.toString() : null,
          };
        }),
      )
    ).filter((file): file is NonNullable<typeof file> => file !== null);
    return {
      state: "ready" as const,
      recipientLabel: link.recipientLabel,
      expiresAt: link.expiresAt,
      markdown: assemblePacketMarkdown(
        visible.map((section) => ({ ...section, audience: "broker" })),
        { audience: "broker" },
      ),
      files,
    };
  },
});

export const getFileByTokenInternal = internalQuery({
  args: { token: v.string(), item: v.string() },
  handler: async (ctx, args) => {
    const hash = await hashMagicLinkToken(args.token.trim());
    const link = await ctx.db
      .query("procurementPacketLinks")
      .withIndex("token", (q) => q.eq("tokenHash", hash))
      .unique();
    const now = dayjs().valueOf();
    if (
      !link ||
      link.revokedAt ||
      (link.expiresAt !== undefined && link.expiresAt <= now)
    )
      return null;
    const itemId = ctx.db.normalizeId("procurementFileItems", args.item);
    if (!itemId) return null;
    const item = await ctx.db.get(itemId);
    const snapshot = link.artifactSnapshot?.find(
      (candidate) => candidate.fileItemId === itemId,
    );
    if (
      !item ||
      item.requestId !== link.requestId ||
      (item.outreachId && item.outreachId !== link.outreachId) ||
      (link.artifactSnapshot && !snapshot) ||
      (!link.artifactSnapshot &&
        link.includedFileItemIds &&
        !link.includedFileItemIds.includes(item._id)) ||
      item.brokerRelease !== "attached" ||
      (snapshot && snapshot.release !== "attached") ||
      (!snapshot && !item.clientFileId)
    )
      return null;
    const clientFileId = snapshot?.clientFileId ?? item.clientFileId;
    if (!clientFileId) return null;
    const file = await ctx.db.get(clientFileId);
    if (
      !file ||
      file.orgId !== link.clientOrgId ||
      file.deletedAt ||
      file.archivedAt
    )
      return null;
    return {
      fileId: file.fileId,
      contentType: file.contentType,
      name: snapshot?.name ?? item.label,
    };
  },
});

export const recordView = mutation({
  args: {
    token: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tokenHash = await hashMagicLinkToken(args.token.trim());
    const link = await ctx.db
      .query("procurementPacketLinks")
      .withIndex("token", (query) => query.eq("tokenHash", tokenHash))
      .unique();
    if (!link) return { ok: false };
    return await recordViewInternalHandler(ctx, {
      linkId: link._id,
      path: "/share/packet/[token]",
      userAgent: args.userAgent,
    });
  },
});

async function recordViewInternalHandler(
  ctx: MutationCtx,
  args: {
    linkId: Id<"procurementPacketLinks">;
    path: string;
    userAgent?: string;
  },
) {
  const link = await ctx.db.get(args.linkId);
  if (
    !link ||
    link.revokedAt ||
    (link.expiresAt !== undefined && link.expiresAt <= dayjs().valueOf())
  )
    return { ok: false };
  const now = dayjs().valueOf();
  await ctx.db.insert("procurementPacketViews", {
    linkId: link._id,
    requestId: link.requestId,
    at: now,
    path: args.path.slice(0, 500),
    userAgent: args.userAgent?.slice(0, 1_000),
  });
  await ctx.db.patch(link._id, {
    lastViewedAt: now,
    viewCount: link.viewCount + 1,
    updatedAt: now,
  });
  return { ok: true };
}

export const sweepExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = dayjs().valueOf();
    const links = await ctx.db
      .query("procurementPacketLinks")
      .withIndex("expiration")
      .collect();
    let count = 0;
    for (const link of links)
      if (
        !link.revokedAt &&
        link.expiresAt !== undefined &&
        link.expiresAt <= now
      ) {
        await ctx.db.patch(link._id, { revokedAt: now, updatedAt: now });
        count += 1;
      }
    return { count };
  },
});
