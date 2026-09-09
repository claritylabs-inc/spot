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
  PACKET_SECTIONS,
  assemblePacketMarkdown,
  composeRequestMarkdown,
  defaultPacketSection,
  audienceIncludes,
  type PacketAudience,
} from "./lib/procurementPacket";

const audienceValidator = v.union(
  v.literal("operator"),
  v.literal("client"),
  v.literal("broker"),
);
const PACKET_LINK_TTL_DAYS = 30;
const MAX_PACKET_LINK_TTL_DAYS = 90;

function brokerSectionProjectionChanged(
  previous: Pick<
    Doc<"procurementPacketSections">,
    "audience" | "heading" | "body" | "order"
  > | null,
  next: Pick<
    Doc<"procurementPacketSections">,
    "audience" | "heading" | "body" | "order"
  >,
) {
  const wasVisible = previous
    ? audienceIncludes(previous.audience, "client")
    : false;
  const isVisible = audienceIncludes(next.audience, "client");
  return (
    wasVisible !== isVisible ||
    (isVisible &&
      (!previous ||
        previous.heading !== next.heading ||
        previous.body !== next.body ||
        previous.order !== next.order))
  );
}

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
      : link.expiresAt <= now
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
  const now = dayjs().valueOf();
  const canonical = defaultPacketSection(args.key);
  const existing = await ctx.db
    .query("procurementPacketSections")
    .withIndex("request_key", (q) =>
      q.eq("requestId", request._id).eq("key", args.key),
    )
    .first();
  const audience =
    args.audience ?? existing?.audience ?? canonical.defaultAudience;
  if (canonical.sensitive && audience !== "operator")
    throw new Error("Sensitive packet sections require operator visibility");
  const values = {
    requestId: request._id,
    clientOrgId: request.clientOrgId,
    key: args.key,
    heading: args.heading?.trim() || existing?.heading || canonical.heading,
    body: args.body.trim(),
    order:
      existing?.order ?? PACKET_SECTIONS.findIndex(([key]) => key === args.key),
    audience,
    source: args.source ?? existing?.source ?? "manual",
    sourceRefs: args.sourceRefs ?? existing?.sourceRefs,
    manuallyEditedAt: now,
    createdByUserId: existing?.createdByUserId ?? args.operatorUserId,
    updatedByUserId: args.operatorUserId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const id =
    existing?._id ?? (await ctx.db.insert("procurementPacketSections", values));
  if (existing) await ctx.db.patch(existing._id, values);
  if (brokerSectionProjectionChanged(existing, values))
    await ctx.db.patch(request._id, {
      packetRevision: (request.packetRevision ?? 0) + 1,
      updatedAt: now,
      updatedByUserId: args.operatorUserId,
    });
  const auditEventId = await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: request.clientOrgId,
    summary: `${existing ? "Updated" : "Created"} packet section ${values.heading} on ${request.title}`,
    metadata: {
      domain: "procurement",
      requestId: request._id,
      packetSectionId: id,
      operation: existing ? "update_packet_section" : "create_packet_section",
      audience,
      source: values.source,
    },
  });
  return { id, auditEventId };
}

export async function setPacketSectionAudienceByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    sectionId: Id<"procurementPacketSections">;
    audience: PacketAudience;
  },
) {
  await directOperator(ctx, args.operatorUserId);
  const section = await ctx.db.get(args.sectionId);
  if (!section) throw new Error("Packet section not found");
  const canonical = defaultPacketSection(section.key);
  if (canonical.sensitive && args.audience !== "operator")
    throw new Error("Sensitive packet sections cannot be widened");
  if (
    args.audience === "operator" ||
    audienceIncludes(args.audience, section.audience)
  ) {
    const now = dayjs().valueOf();
    await ctx.db.patch(section._id, {
      audience: args.audience,
      audienceProposed: undefined,
      updatedByUserId: args.operatorUserId,
      updatedAt: now,
    });
    const request = await ctx.db.get(section.requestId);
    if (
      request &&
      brokerSectionProjectionChanged(section, {
        ...section,
        audience: args.audience,
      })
    )
      await ctx.db.patch(request._id, {
        packetRevision: (request.packetRevision ?? 0) + 1,
        updatedAt: now,
        updatedByUserId: args.operatorUserId,
      });
    if (request && args.audience !== section.audience)
      await writeOperatorAudit(ctx, {
        operatorUserId: args.operatorUserId,
        type: "setup_write",
        targetOrgId: request.clientOrgId,
        summary: `Changed packet section ${section.heading} audience to ${args.audience}`,
        metadata: {
          domain: "procurement",
          requestId: request._id,
          packetSectionId: section._id,
          operation: "set_packet_section_audience",
          previousAudience: section.audience,
          nextAudience: args.audience,
        },
      });
  }
  return { ok: true };
}

/** The client wiki composes in on read rather than being copied into the
 * packet, so a new request starts with the client's durable background and
 * later wiki edits reach requests already open. Operator audience only: the
 * client and broker projections stay the packet alone. */
export async function listPacketSections(
  ctx: QueryCtx | MutationCtx,
  args: { requestId: Id<"procurementRequests">; audience?: PacketAudience },
) {
  const request = await requestForOperator(ctx, args.requestId);
  const sections = await ctx.db
    .query("procurementPacketSections")
    .withIndex("request", (q) => q.eq("requestId", request._id))
    .collect();
  const audience = args.audience ?? "operator";
  const wiki =
    audience === "operator"
      ? await readOrgWiki(ctx, request.clientOrgId)
      : null;
  return {
    requestId: request._id,
    packetRevision: request.packetRevision ?? 0,
    sections: sections
      .filter(
        (section) =>
          audience === "operator" ||
          audienceIncludes(section.audience, audience),
      )
      .sort((a, b) => a.order - b.order),
    clientWiki: wiki
      ? { orgId: wiki.orgId, sections: wiki.sections, markdown: wiki.markdown }
      : null,
    markdown: composeRequestMarkdown({
      wikiMarkdown: wiki?.markdown ?? "",
      packetMarkdown: assemblePacketMarkdown(sections, { audience }),
    }),
    gaps: PACKET_SECTIONS.filter(
      ([key]) =>
        !sections.some((section) => section.key === key && section.body.trim()),
    ).map(([key, heading]) => ({ key, heading })),
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
  const [sections, fileItems] = await Promise.all([
    ctx.db
      .query("procurementPacketSections")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .collect(),
    ctx.db
      .query("procurementFileItems")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .collect(),
  ]);
  const visibleSections = sections
    // Client and broker views are intentionally the same shared document.
    // "operator" remains the only private section audience.
    .filter((section) => audienceIncludes(section.audience, "client"))
    .sort((left, right) => left.order - right.order)
    .map(({ key, heading, body, order }) => ({ key, heading, body, order }));
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
    gaps: PACKET_SECTIONS.filter(
      ([key, , defaultAudience]) =>
        audienceIncludes(defaultAudience, "client") &&
        !visibleSections.some(
          (section) => section.key === key && section.body.trim(),
        ),
    ).map(([key, heading]) => ({ key, heading })),
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
    return await listPacketSections(ctx, args);
  },
});

export const updateSections = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    expectedPacketRevision: v.number(),
    sections: v.array(v.object({ key: v.string(), body: v.string() })),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await directOperator(ctx, operator.userId);
    const request = await requestForOperator(ctx, args.requestId);
    if ((request.packetRevision ?? 0) !== args.expectedPacketRevision)
      throw new Error(
        "The packet changed while you were editing. Copy your changes, then reopen the editor to review the latest packet.",
      );
    for (const section of args.sections) {
      await upsertPacketSectionByOperator(ctx, {
        operatorUserId: operator.userId,
        requestId: args.requestId,
        ...section,
        source: "manual",
      });
    }
    return {
      ok: true,
      packetRevision: (await ctx.db.get(args.requestId))?.packetRevision ?? 0,
    };
  },
});

/** Apply source-backed machine updates without silently changing a human edit
 * or the projection already visible to a recipient. */
export const applyAgentUpdateInternal = internalMutation({
  args: {
    requestId: v.id("procurementRequests"),
    sourceFingerprint: v.string(),
    sections: v.array(
      v.object({
        key: v.string(),
        body: v.string(),
        audienceProposed: v.optional(
          v.union(v.literal("client"), v.literal("broker")),
        ),
        rationale: v.optional(v.string()),
        sourceRefs: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const request = await requestForOperator(ctx, args.requestId);
    const now = dayjs().valueOf();
    let changed = false;
    for (const update of args.sections) {
      const canonical = defaultPacketSection(update.key);
      if (canonical.sensitive && update.audienceProposed) continue;
      const existing = await ctx.db
        .query("procurementPacketSections")
        .withIndex("request_key", (q) =>
          q.eq("requestId", request._id).eq("key", update.key),
        )
        .first();
      if (existing?.manuallyEditedAt) continue;
      const priorRefs = new Set(existing?.sourceRefs ?? []);
      if (update.sourceRefs.some((ref) => priorRefs.has(ref))) continue;
      const sourceRefs = [...priorRefs, ...update.sourceRefs].slice(-50);
      if (!existing) {
        await ctx.db.insert("procurementPacketSections", {
          requestId: request._id,
          clientOrgId: request.clientOrgId,
          key: update.key,
          heading: canonical.heading,
          body: update.body.trim(),
          order: PACKET_SECTIONS.findIndex(([key]) => key === update.key),
          audience: "operator",
          audienceProposed: update.audienceProposed,
          source: "email",
          sourceRefs,
          proposedRationale: update.rationale,
          createdByUserId: request.updatedByUserId,
          updatedByUserId: request.updatedByUserId,
          createdAt: now,
          updatedAt: now,
        });
        changed = true;
      } else {
        const patch: Record<string, unknown> = { sourceRefs, updatedAt: now };
        if (existing.audience === "operator") patch.body = update.body.trim();
        else patch.proposedBody = update.body.trim();
        if (update.audienceProposed)
          patch.audienceProposed = update.audienceProposed;
        if (update.rationale) patch.proposedRationale = update.rationale;
        await ctx.db.patch(existing._id, patch);
        changed = true;
      }
    }
    if (changed) {
      const run = await ctx.db
        .query("procurementPacketUpdateRuns")
        .withIndex("request", (q) => q.eq("requestId", request._id))
        .order("desc")
        .first();
      if (!run || run.sourceFingerprint !== args.sourceFingerprint)
        await ctx.db.insert("procurementPacketUpdateRuns", {
          requestId: request._id,
          sourceFingerprint: args.sourceFingerprint,
          status: "complete",
          attempts: 1,
          updatedAt: now,
        });
    }
    return { changed };
  },
});

export const acceptProposal = mutation({
  args: { sectionId: v.id("procurementPacketSections") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await directOperator(ctx, operator.userId);
    const section = await ctx.db.get(args.sectionId);
    if (!section || (!section.proposedBody && !section.audienceProposed))
      throw new Error("No packet proposal pending");
    const now = dayjs().valueOf();
    const nextAudience = section.audienceProposed ?? section.audience;
    await ctx.db.patch(section._id, {
      body: section.proposedBody ?? section.body,
      audience: nextAudience,
      proposedBody: undefined,
      audienceProposed: undefined,
      proposedRationale: undefined,
      updatedAt: now,
      updatedByUserId: operator.userId,
    });
    const request = await ctx.db.get(section.requestId);
    if (
      request &&
      brokerSectionProjectionChanged(section, {
        ...section,
        body: section.proposedBody ?? section.body,
        audience: nextAudience,
      })
    )
      await ctx.db.patch(request._id, {
        packetRevision: (request.packetRevision ?? 0) + 1,
        updatedAt: now,
        updatedByUserId: operator.userId,
      });
    const auditEventId = request
      ? await writeOperatorAudit(ctx, {
          operatorUserId: operator.userId,
          type: "setup_write",
          targetOrgId: request.clientOrgId,
          summary: `Accepted proposed changes to packet section ${section.heading}`,
          metadata: {
            domain: "procurement",
            requestId: request._id,
            packetSectionId: section._id,
            operation: "accept_packet_section_proposal",
          },
        })
      : null;
    return { ok: true, auditEventId };
  },
});

export const rejectProposal = mutation({
  args: { sectionId: v.id("procurementPacketSections") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await directOperator(ctx, operator.userId);
    const section = await ctx.db.get(args.sectionId);
    if (!section) throw new Error("Packet section not found");
    const request = await ctx.db.get(section.requestId);
    await ctx.db.patch(section._id, {
      proposedBody: undefined,
      audienceProposed: undefined,
      proposedRationale: undefined,
      updatedAt: dayjs().valueOf(),
      updatedByUserId: operator.userId,
    });
    const auditEventId = request
      ? await writeOperatorAudit(ctx, {
          operatorUserId: operator.userId,
          type: "setup_write",
          targetOrgId: request.clientOrgId,
          summary: `Rejected proposed changes to packet section ${section.heading}`,
          metadata: {
            domain: "procurement",
            requestId: request._id,
            packetSectionId: section._id,
            operation: "reject_packet_section_proposal",
          },
        })
      : null;
    return { ok: true, auditEventId };
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

/** Callers name a lifetime in days and let the server date it. A raw
 * `expiresAt` from a browser whose clock runs ahead would trip the maximum. */
function requestedPacketLinkExpiry(
  now: number,
  args: { expiresAt?: number; expiresInDays?: number },
) {
  if (args.expiresInDays === undefined) return args.expiresAt;
  if (
    !Number.isInteger(args.expiresInDays) ||
    args.expiresInDays < 1 ||
    args.expiresInDays > MAX_PACKET_LINK_TTL_DAYS
  )
    throw new Error(
      `Packet link lifetime must be between 1 and ${MAX_PACKET_LINK_TTL_DAYS} days`,
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
  const maximumExpiry = dayjs(now)
    .add(MAX_PACKET_LINK_TTL_DAYS, "day")
    .valueOf();
  const requestedExpiry = requestedPacketLinkExpiry(now, args);
  if (
    requestedExpiry !== undefined &&
    (!Number.isFinite(requestedExpiry) || requestedExpiry <= now)
  )
    throw new Error("Packet link expiry must be in the future");
  if (requestedExpiry !== undefined && requestedExpiry > maximumExpiry)
    throw new Error(
      `Packet links may expire at most ${MAX_PACKET_LINK_TTL_DAYS} days after issue`,
    );
  const expiresAt =
    requestedExpiry ?? dayjs(now).add(PACKET_LINK_TTL_DAYS, "day").valueOf();
  const replacedLinkIds: Id<"procurementPacketLinks">[] = [];
  if (!outreach) {
    const currentRequestLinks = await ctx.db
      .query("procurementPacketLinks")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .collect();
    for (const link of currentRequestLinks) {
      if (link.outreachId || link.revokedAt || link.expiresAt <= now) continue;
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
      (link) => !link.outreachId && !link.revokedAt && link.expiresAt > now,
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
    if (!link || link.revokedAt || link.expiresAt <= now) return null;
    const request = await ctx.db.get(link.requestId);
    const outreach = link.outreachId ? await ctx.db.get(link.outreachId) : null;
    if (
      !request ||
      (link.outreachId && (!outreach || outreach.requestId !== request._id))
    )
      return null;
    const sections = await ctx.db
      .query("procurementPacketSections")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .collect();
    const visible = link.sectionSnapshot
      ? link.sectionSnapshot
      : sections
          .filter((section) => audienceIncludes(section.audience, "client"))
          .sort((a, b) => a.order - b.order);
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
    if (!link || link.revokedAt || link.expiresAt <= now) return null;
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
  if (!link || link.revokedAt || link.expiresAt <= dayjs().valueOf())
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
      if (!link.revokedAt && link.expiresAt <= now) {
        await ctx.db.patch(link._id, { revokedAt: now, updatedAt: now });
        count += 1;
      }
    return { count };
  },
});
