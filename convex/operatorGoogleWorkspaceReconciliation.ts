import { scanInsuredAddressValidator } from "./lib/scanReconciliationSchema";
import {
  googleWorkspaceScanBodyFingerprint,
  googleWorkspaceScanContentFingerprint,
} from "./lib/googleWorkspaceScan";
import { extractEmailAddress } from "./lib/emailAddress";
import dayjs from "dayjs";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertGoogleWorkspaceScanSourceLease } from "./lib/googleWorkspaceScanState";
import {
  scanOperationSchema,
  sourceEffectiveAt,
  assertUnchangedSnapshot,
  ScanAttention,
} from "./lib/googleWorkspaceReconciliation";
import { resolveScanTarget, writeScanDomain } from "./lib/workspaceScanDomain";
import {
  writeOperatorAudit,
  requireOperatorForUser,
} from "./lib/operatorIdentity";
import { actionConfirmationFingerprint } from "./lib/actionConfirmationFingerprint";
import {
  commitValidatedOperatorPolicyImport,
  type OperatorPolicySource,
} from "./operatorPolicyImports";
import { normalizeClientFileSha256 } from "./lib/clientFiles";

const leaseArgs = {
  sourceId: v.id("operatorGoogleWorkspaceScanSources"),
  leaseToken: v.string(),
};
async function sourceBody(
  ctx: QueryCtx | MutationCtx,
  source: Doc<"operatorGoogleWorkspaceScanSources">,
) {
  const parts = await ctx.db
    .query("operatorGoogleWorkspaceScanSourceParts")
    .withIndex("source_ordinal", (q) => q.eq("sourceId", source._id))
    .take(33);
  if (
    source.status !== "running" ||
    !source.evidence?.bodyComplete ||
    parts.some((part, index) => part.ordinal !== index) ||
    parts.length !== source.evidence.bodyPartCount ||
    parts.length > 32
  )
    throw new ScanAttention(
      "Complete source body is not available for reconciliation",
    );
  const body = parts.map((p) => p.text).join("");
  if (
    (source.originalContentFingerprint !== undefined &&
      source.originalContentFingerprint !==
        source.evidence.contentFingerprint) ||
    !source.evidence.bodyFingerprint ||
    (await googleWorkspaceScanBodyFingerprint(body)) !==
      source.evidence.bodyFingerprint ||
    (await googleWorkspaceScanContentFingerprint(source.evidence, body)) !==
      source.evidence.contentFingerprint
  )
    throw new ScanAttention(
      "Source body fingerprint does not match collected evidence",
    );
  if (body.length > 160_000)
    throw new ScanAttention(
      "Source exceeds the bounded analysis size; review the full thread",
    );
  return body;
}
async function validatedPdfIdentity(
  ctx: QueryCtx | MutationCtx,
  sourceId: Id<"operatorGoogleWorkspaceScanSources">,
  operation: ReturnType<typeof scanOperationSchema.parse>,
) {
  if (operation.kind !== "import_policy") return false;
  const pdf = await ctx.db
    .query("operatorWorkspaceScanImports")
    .withIndex("attachment", (q) =>
      q.eq("sourceId", sourceId).eq("attachmentId", operation.attachmentId),
    )
    .unique();
  return Boolean(
    pdf?.boundPolicy &&
    pdf.insuredName?.trim().toLowerCase() ===
      operation.identity.name.trim().toLowerCase() &&
    pdf.insuredAddress &&
    operation.identity.address &&
    Object.entries(pdf.insuredAddress).every(
      ([key, value]) =>
        value.trim().toLowerCase() ===
        operation.identity.address?.[key as keyof typeof pdf.insuredAddress]
          ?.trim()
          .toLowerCase(),
    ),
  );
}
export async function scanOperationKey(
  operationJson: string,
  source: Doc<"operatorGoogleWorkspaceScanSources">,
) {
  const operation = scanOperationSchema.parse(JSON.parse(operationJson));
  return actionConfirmationFingerprint({
    toolName: "workspace_scan_event",
    toolVersion: 2,
    input: {
      evidence: source.evidence?.contentFingerprint ?? source.messageId,
      importSource:
        operation.kind === "import_policy"
          ? { mailbox: source.mailbox, messageId: source.messageId }
          : null,
      kind: operation.kind,
      identity: operation.identity,
      effectiveDate: operation.effectiveDate,
      target:
        "request" in operation
          ? operation.request
          : operation.kind === "company_facts"
            ? operation.section
            : operation.kind === "import_policy"
              ? operation.attachmentId
              : null,
    },
  });
}
async function linkFindingSource(
  ctx: MutationCtx,
  findingId: Id<"operatorWorkspaceScanFindings">,
  sourceId: Id<"operatorGoogleWorkspaceScanSources">,
  excerpt: string,
) {
  const existing = await ctx.db
    .query("operatorWorkspaceScanFindingSources")
    .withIndex("pair", (q) =>
      q.eq("findingId", findingId).eq("sourceId", sourceId),
    )
    .unique();
  if (!existing)
    await ctx.db.insert("operatorWorkspaceScanFindingSources", {
      findingId,
      sourceId,
      excerpt,
    });
}

async function selectionFor(
  ctx: QueryCtx | MutationCtx,
  operationKey: string,
  sourceId: Id<"operatorGoogleWorkspaceScanSources">,
) {
  const finding = await ctx.db
    .query("operatorWorkspaceScanFindings")
    .withIndex("operation", (q) => q.eq("operationKey", operationKey))
    .first();
  if (finding?.selectedByUserId)
    await requireOperatorForUser(ctx, finding.selectedByUserId);
  const inventory = await ctx.db
    .query("operatorWorkspaceScanInventories")
    .withIndex("operation", (q) =>
      q.eq("sourceId", sourceId).eq("operationKey", operationKey),
    )
    .unique();
  return {
    finding,
    inventory,
    selection: {
      organizationIds: inventory?.organizationIds,
      requestIds: inventory?.requestIds,
      selectedOrgId: finding?.selectedOrgId,
      selectedRequestId: finding?.selectedRequestId,
    },
  };
}
export const prepareInternal = internalQuery({
  args: { ...leaseArgs, operationJson: v.string() },
  handler: async (ctx, args) => {
    const { source } = await assertGoogleWorkspaceScanSourceLease(ctx, args);
    const operation = scanOperationSchema.parse(JSON.parse(args.operationJson));
    const key = await scanOperationKey(args.operationJson, source);
    const { selection } = await selectionFor(ctx, key, args.sourceId);
    const target = await resolveScanTarget(ctx, operation, selection);
    const body = await sourceBody(ctx, source);
    sourceEffectiveAt(
      operation,
      source.evidence!,
      body,
      (await ctx.db
        .query("operatorWorkspaceScanContexts")
        .withIndex("source", (q) => q.eq("sourceId", source._id))
        .unique()) ?? undefined,
      await validatedPdfIdentity(ctx, source._id, operation),
    );
    return {
      snapshot: JSON.stringify(target),
      targetOrgId: target.org?._id ?? null,
    };
  },
});
export const getEvidenceInternal = internalQuery({
  args: leaseArgs,
  handler: async (ctx, args) => {
    const { source } = await assertGoogleWorkspaceScanSourceLease(ctx, args);
    const context = await ctx.db
      .query("operatorWorkspaceScanContexts")
      .withIndex("source", (q) => q.eq("sourceId", source._id))
      .unique();
    return { source, body: await sourceBody(ctx, source), context };
  },
});
export const recordFindingInternal = internalMutation({
  args: {
    ...leaseArgs,
    operationJson: v.optional(v.string()),
    status: v.union(v.literal("needs_attention"), v.literal("failed")),
    explanation: v.string(),
    excerpt: v.string(),
  },
  handler: async (ctx, args) => {
    const { source, operatorUserId } =
      await assertGoogleWorkspaceScanSourceLease(ctx, args);
    const key = args.operationJson
      ? await scanOperationKey(args.operationJson, source)
      : `${source._id}:${args.status}:${args.explanation.slice(0, 150)}`;
    const previous = await ctx.db
      .query("operatorWorkspaceScanFindings")
      .withIndex("operation", (q) => q.eq("operationKey", key))
      .first();
    if (previous) {
      await linkFindingSource(ctx, previous._id, source._id, args.excerpt);
      if (previous.status === "updated" || previous.resolvedAt)
        return previous._id;
    }
    const values = {
      sourceId: source._id,
      status: args.status,
      title: args.operationJson
        ? scanOperationSchema
            .parse(JSON.parse(args.operationJson))
            .kind.replaceAll("_", " ")
        : "Mail review",
      explanation: args.explanation.slice(0, 2000),
      excerpt: args.excerpt.slice(0, 4000),
      operationJson: args.operationJson,
      operationKey: key,
      createdAt: dayjs().valueOf(),
      recordLinks: [],
      authorizingOperatorId: operatorUserId,
    };
    if (previous) {
      await ctx.db.patch(previous._id, {
        ...values,
        sourceId: previous.sourceId,
      });
      return previous._id;
    }
    const id = await ctx.db.insert("operatorWorkspaceScanFindings", values);
    await linkFindingSource(ctx, id, source._id, args.excerpt);
    return id;
  },
});
export const applyInternal = internalMutation({
  args: {
    ...leaseArgs,
    operationJson: v.string(),
    snapshot: v.string(),
    importId: v.optional(v.id("operatorWorkspaceScanImports")),
  },
  handler: async (ctx, args) => {
    const { source, operatorUserId } =
      await assertGoogleWorkspaceScanSourceLease(ctx, args);
    const operation = scanOperationSchema.parse(JSON.parse(args.operationJson));
    const key = await scanOperationKey(args.operationJson, source);
    const { finding, selection, inventory } = await selectionFor(
      ctx,
      key,
      args.sourceId,
    );
    await sourceBody(ctx, source);
    if (finding) {
      await linkFindingSource(ctx, finding._id, source._id, operation.excerpt);
      if (finding.status === "updated" || finding.resolvedAt)
        return { status: "duplicate" as const, findingId: finding._id };
    }
    const body = await sourceBody(ctx, source);
    const effectiveAt = sourceEffectiveAt(
      operation,
      source.evidence!,
      body,
      (await ctx.db
        .query("operatorWorkspaceScanContexts")
        .withIndex("source", (q) => q.eq("sourceId", source._id))
        .unique()) ?? undefined,
      await validatedPdfIdentity(ctx, source._id, operation),
    );
    const target = await resolveScanTarget(ctx, operation, selection);
    assertUnchangedSnapshot(target, args.snapshot);
    if (
      (operation.kind === "create_organization" && !target.org) ||
      (operation.kind === "create_request" && !target.request)
    ) {
      if (!inventory?.complete)
        throw new ScanAttention(
          "Complete existing-record discovery is required before creation",
        );
      const recent = await ctx.db
        .query("organizations")
        .withIndex("type", (q) =>
          q
            .eq("type", operation.identity.kind)
            .gt("_creationTime", inventory.startedAt),
        )
        .take(101);
      if (
        recent.length > 100 ||
        recent.some(
          (org) =>
            org.name.trim().toLowerCase() ===
            operation.identity.name.trim().toLowerCase(),
        )
      )
        throw new ScanAttention(
          "Organization inventory changed during discovery; re-evaluate before creation",
        );
    }

    let result;
    if (operation.kind === "import_policy") {
      const staged = args.importId ? await ctx.db.get(args.importId) : null;
      if (
        !staged ||
        staged.sourceId !== source._id ||
        staged.attachmentId !== operation.attachmentId ||
        !staged.boundPolicy ||
        !target.org ||
        staged.clientOrgId !== target.org._id
      )
        throw new ScanAttention(
          "Validated bound-policy attachment does not match the source and client",
        );
      const imported = await commitValidatedOperatorPolicyImport(ctx, {
        operatorUserId,
        orgId: target.org._id,
        mode: "separate",
        files: [staged.file],
        workspaceScanImportId: staged._id,
      });
      result = {
        table: "policies" as const,
        id: imported[0].policyId,
        created: imported[0].status === "queued",
        noChange: imported[0].status === "duplicate",
      };
      await ctx.db.patch(staged._id, { policyId: result.id });
    } else
      result = await writeScanDomain(ctx, {
        operation,
        target,
        operatorUserId,
        effectiveAt,
      });
    const record = await ctx.db.get(result.id);
    if (!record)
      throw new Error("Reconciliation write did not produce a record");
    const orgId =
      target.org?._id ?? (result.table === "organizations" ? result.id : null);
    const href =
      result.table === "procurementRequests"
        ? `/operator/clients/${orgId}/procurement/${result.id}`
        : result.table === "policies"
          ? `/operator/clients/${orgId}/policies/${result.id}`
          : target.request
            ? `/operator/clients/${orgId}/procurement/${target.request._id}`
            : operation.identity.kind === "broker"
              ? `/operator/brokers?brokerId=${encodeURIComponent(String(orgId))}`
              : `/operator/clients/${orgId}`;
    const values = {
      sourceId: source._id,
      operationKey: key,
      status: "updated" as const,
      title: operation.kind.replaceAll("_", " "),
      explanation: result.noChange
        ? "Existing record reused; no duplicate created."
        : operation.explanation,
      excerpt: operation.excerpt,
      operationJson: args.operationJson,
      entityId: String(orgId ?? result.id),
      recordId: String(result.id),
      brokerId:
        operation.identity.kind === "broker"
          ? (target.org?._id ?? ctx.db.normalizeId("organizations", result.id) ?? undefined)
          : result.table === "procurementBrokerOutreaches" && "brokerOrgId" in record
            ? record.brokerOrgId
            : undefined,
      requestId:
        result.table === "procurementRequests"
          ? (ctx.db.normalizeId("procurementRequests", result.id) ?? undefined)
          : target.request?._id,
      recordLinks: [{ label: operation.identity.name, href }],
      createdAt: dayjs().valueOf(),
      authorizingOperatorId: operatorUserId,
      resolvedAt: undefined,
      resolution: undefined,
    };
    const findingId = finding
      ? finding._id
      : await ctx.db.insert("operatorWorkspaceScanFindings", values);
    if (finding)
      await ctx.db.patch(findingId, { ...values, sourceId: finding.sourceId });
    await linkFindingSource(ctx, findingId, source._id, operation.excerpt);
    if (!result.noChange) {
      const before = result.created ? null : target.record;
      const beforeValue: Record<string, unknown> = before ?? {};
      const afterValue: Record<string, unknown> = record;
      const fields = [
        ...new Set([...Object.keys(beforeValue), ...Object.keys(afterValue)]),
      ].filter(
        (field) =>
          !field.startsWith("_") &&
          ![
            "createdAt",
            "updatedAt",
            "updatedByUserId",
            "sourceRefs",
            "manuallyEditedAt",
          ].includes(field) &&
          JSON.stringify(beforeValue[field]) !==
            JSON.stringify(afterValue[field]),
      );
      await ctx.db.insert("operatorWorkspaceScanChanges", {
        findingId,
        entityId: result.id,
        table: result.table,
        beforeJson: JSON.stringify(before),
        afterJson: JSON.stringify(record),
        fields,
        created: result.created,
        effectiveAt,
        appliedAt: dayjs().valueOf(),
      });
      await writeOperatorAudit(ctx, {
        operatorUserId,
        type: "setup_write",
        targetOrgId:
          target.org?._id ??
          (result.table === "organizations"
            ? (result.id as Id<"organizations">)
            : undefined),
        summary: `Workspace scan: ${operation.kind.replaceAll("_", " ")}`,
        metadata: {
          source: "workspace_scan",
          sourceId: source._id,
          findingId,
          entityId: result.id,
        },
      });
    }
    return { status: "updated" as const, findingId };
  },
});

export const getStagedImportInternal = internalQuery({
  args: { ...leaseArgs, attachmentId: v.string() },
  handler: async (ctx, args) => {
    await assertGoogleWorkspaceScanSourceLease(ctx, args);
    return ctx.db
      .query("operatorWorkspaceScanImports")
      .withIndex("attachment", (q) =>
        q.eq("sourceId", args.sourceId).eq("attachmentId", args.attachmentId),
      )
      .unique();
  },
});
export const stageImportInternal = internalMutation({
  args: {
    ...leaseArgs,
    attachmentId: v.string(),
    clientOrgId: v.optional(v.id("organizations")),
    insuredName: v.optional(v.string()),
    insuredAddress: v.optional(scanInsuredAddressValidator),
    fileId: v.id("_storage"),
    boundPolicy: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { source } = await assertGoogleWorkspaceScanSourceLease(ctx, args);
    await sourceBody(ctx, source);
    const attachment = source.evidence?.attachments.find(
      (a) => a.attachmentId === args.attachmentId,
    );
    const metadata = await ctx.db.system.get("_storage", args.fileId);
    if (
      !attachment ||
      !metadata ||
      !attachment.filename.toLowerCase().endsWith(".pdf") ||
      metadata.size !== attachment.size ||
      metadata.size > 15 * 1024 * 1024
    )
      throw new ScanAttention(
        "Original policy attachment is unavailable or changed",
      );
    const existing = await ctx.db
      .query("operatorWorkspaceScanImports")
      .withIndex("attachment", (q) =>
        q.eq("sourceId", args.sourceId).eq("attachmentId", args.attachmentId),
      )
      .unique();
    if (existing) return existing._id;
    const file: OperatorPolicySource = {
      fileId: args.fileId,
      fileName: attachment.filename,
      fileSha256: normalizeClientFileSha256(metadata.sha256),
      size: metadata.size,
    };
    return ctx.db.insert("operatorWorkspaceScanImports", {
      sourceId: source._id,
      attachmentId: args.attachmentId,
      clientOrgId: args.clientOrgId,
      insuredName: args.insuredName,
      insuredAddress: args.insuredAddress,
      file,
      boundPolicy: args.boundPolicy,
      createdAt: dayjs().valueOf(),
    });
  },
});

export const discoverTargetsInternal = internalMutation({
  args: { ...leaseArgs, operationJson: v.string() },
  handler: async (ctx, args) => {
    const { source } = await assertGoogleWorkspaceScanSourceLease(ctx, args);
    const operation = scanOperationSchema.parse(JSON.parse(args.operationJson));
    const operationKey = await scanOperationKey(args.operationJson, source);
    let inventory = await ctx.db
      .query("operatorWorkspaceScanInventories")
      .withIndex("operation", (q) =>
        q.eq("sourceId", args.sourceId).eq("operationKey", operationKey),
      )
      .unique();
    if (inventory?.complete) return true;
    if (!inventory) {
      const org = await resolveScanTarget(ctx, operation).catch(() => null);
      const newest = await ctx.db
        .query("organizations")
        .withIndex("type", (q) => q.eq("type", operation.identity.kind))
        .order("desc")
        .first();
      const id = await ctx.db.insert("operatorWorkspaceScanInventories", {
        sourceId: args.sourceId,
        operationKey,
        cursor: null,
        complete: false,
        startedAt: newest?._creationTime ?? dayjs().valueOf(),
        organizationIds: [],
        requestIds: [],
        orgId: org?.org?._id,
      });
      inventory = (await ctx.db.get(id))!;
    }
    if (inventory.orgId && "request" in operation) {
      const page = await ctx.db
        .query("procurementRequests")
        .withIndex("organization", (q) => q.eq("clientOrgId", inventory.orgId!))
        .paginate({ cursor: inventory.cursor, numItems: 100 });
      const ids = [
        ...inventory.requestIds,
        ...page.page
          .filter(
            (r) =>
              r.title.trim().toLowerCase() ===
              operation.request.title.trim().toLowerCase(),
          )
          .map((r) => r._id),
      ];
      if (ids.length > 20)
        throw new ScanAttention(
          "Several requests have this exact title; choose one explicitly",
        );
      await ctx.db.patch(inventory._id, {
        requestIds: ids,
        cursor: page.continueCursor,
        complete: page.isDone,
      });
      return page.isDone;
    }
    const page = await ctx.db
      .query("organizations")
      .withIndex("type", (q) => q.eq("type", operation.identity.kind))
      .paginate({ cursor: inventory.cursor, numItems: 100 });
    const ids = [
      ...inventory.organizationIds,
      ...page.page
        .filter(
          (org) =>
            org.name.trim().toLowerCase() ===
            operation.identity.name.trim().toLowerCase(),
        )
        .map((org) => org._id),
    ];
    if (ids.length > 20)
      throw new ScanAttention(
        "Several organizations share this name; choose one explicitly",
      );
    await ctx.db.patch(inventory._id, {
      organizationIds: ids,
      cursor: page.continueCursor,
      complete: page.isDone,
    });
    return page.isDone;
  },
});

export const saveContextInternal = internalMutation({
  args: {
    ...leaseArgs,
    messages: v.array(
      v.object({
        messageId: v.string(),
        threadId: v.string(),
        mailbox: v.string(),
        sentAt: v.string(),
        body: v.string(),
        participants: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { source } = await assertGoogleWorkspaceScanSourceLease(ctx, args);
    await sourceBody(ctx, source);
    if (
      args.messages.length > 30 ||
      args.messages.some(
        (message) =>
          message.threadId !== source.threadId ||
          message.mailbox !== source.mailbox ||
          message.messageId === source.messageId ||
          !dayjs(message.sentAt).isValid() ||
          dayjs(message.sentAt).valueOf() >
            dayjs(source.evidence!.sentAt!).valueOf(),
      )
    )
      throw new ScanAttention(
        "Thread context does not belong to this source's earlier history",
      );
    const body = args.messages.map((message) => message.body).join("\n\n");
    if (body.length > 160000)
      throw new ScanAttention("Parent thread exceeds bounded context");
    const value = {
      sourceId: source._id,
      body,
      participants: [...new Set(args.messages.flatMap((m) => m.participants))],
      messages: args.messages.map((m) => ({
        messageId: m.messageId,
        sentAt: m.sentAt,
        excerpt: m.body.slice(0, 1000),
      })),
      createdAt: dayjs().valueOf(),
    };
    const existing = await ctx.db
      .query("operatorWorkspaceScanContexts")
      .withIndex("source", (q) => q.eq("sourceId", source._id))
      .unique();
    if (existing) await ctx.db.replace(existing._id, value);
    else await ctx.db.insert("operatorWorkspaceScanContexts", value);
  },
});

export const getKnownContextInternal = internalQuery({
  args: leaseArgs,
  handler: async (ctx, args) => {
    const { source } = await assertGoogleWorkspaceScanSourceLease(ctx, args);
    const evidence = source.evidence;
    if (!evidence) return [];
    const context = await ctx.db
      .query("operatorWorkspaceScanContexts")
      .withIndex("source", (q) => q.eq("sourceId", source._id))
      .unique();
    const emails = [
      ...new Set(
        [
          evidence.from,
          ...evidence.to,
          ...evidence.cc,
          ...(context?.participants ?? []),
        ].flatMap((value) => {
          const email = extractEmailAddress(value ?? undefined);
          return email ? [email] : [];
        }),
      ),
    ];
    if (emails.length > 40)
      throw new ScanAttention(
        "Too many participants for unambiguous entity context",
      );
    const organizations = new Map<Id<"organizations">, Doc<"organizations">>();
    for (const email of emails) {
      const [contacts, users] = await Promise.all([
        ctx.db
          .query("organizations")
          .withIndex("scan_contact", (q) => q.eq("primaryContactEmail", email))
          .take(11),
        ctx.db
          .query("users")
          .withIndex("email", (q) => q.eq("email", email))
          .take(11),
      ]);
      if (contacts.length > 10 || users.length > 10)
        throw new ScanAttention("Participant identity is ambiguous");
      for (const org of contacts) organizations.set(org._id, org);
      for (const user of users) {
        const memberships = await ctx.db
          .query("orgMemberships")
          .withIndex("user", (q) => q.eq("userId", user._id))
          .take(11);
        if (memberships.length > 10)
          throw new ScanAttention(
            "Participant has too many organization associations",
          );
        for (const membership of memberships) {
          const org = await ctx.db.get(membership.orgId);
          if (org) organizations.set(org._id, org);
        }
      }
    }
    if (organizations.size > 20)
      throw new ScanAttention(
        "Thread involves too many organizations to reconcile automatically",
      );
    return Promise.all(
      [...organizations.values()].map(async (org) => ({
        id: org._id,
        name: org.name,
        type: org.type,
        address: org.mailingAddress,
        contactEmail: org.primaryContactEmail,
        wiki:
          org.type === "client"
            ? await ctx.db
                .query("orgWikiSections")
                .withIndex("organization", (q) => q.eq("orgId", org._id))
                .take(7)
            : [],
        requests:
          org.type === "client"
            ? (
                await ctx.db
                  .query("procurementRequests")
                  .withIndex("organization", (q) =>
                    q.eq("clientOrgId", org._id),
                  )
                  .order("desc")
                  .take(50)
              ).map((r) => ({
                title: r.title,
                narrative: r.narrative,
                status: r.status,
                targetEffectiveDate: r.targetEffectiveDate,
              }))
            : [],
      })),
    );
  },
});

export const cleanupNoopContextInternal = internalMutation({
  args: { sourceId: v.id("operatorGoogleWorkspaceScanSources") },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (source?.status !== "completed") return;
    const finding = await ctx.db
      .query("operatorWorkspaceScanFindingSources")
      .withIndex("source", (q) => q.eq("sourceId", args.sourceId))
      .first();
    if (finding) return;
    const context = await ctx.db
      .query("operatorWorkspaceScanContexts")
      .withIndex("source", (q) => q.eq("sourceId", args.sourceId))
      .unique();
    if (context) await ctx.db.delete(context._id);
    const inventories = await ctx.db
      .query("operatorWorkspaceScanInventories")
      .withIndex("operation", (q) => q.eq("sourceId", args.sourceId))
      .take(24);
    for (const inventory of inventories) await ctx.db.delete(inventory._id);
  },
});

export const bindImportInternal = internalMutation({
  args: {
    ...leaseArgs,
    importId: v.id("operatorWorkspaceScanImports"),
    operationJson: v.string(),
    clientOrgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const { source } = await assertGoogleWorkspaceScanSourceLease(ctx, args);
    const body = await sourceBody(ctx, source);
    const operation = scanOperationSchema.parse(JSON.parse(args.operationJson));
    if (operation.kind !== "import_policy")
      throw new ScanAttention("Only policy evidence can bind an import");
    const staged = await ctx.db.get(args.importId);
    if (
      !staged ||
      staged.sourceId !== source._id ||
      staged.attachmentId !== operation.attachmentId ||
      !staged.boundPolicy
    )
      throw new ScanAttention(
        "Original PDF is not validated as a bound policy",
      );
    const context = await ctx.db
      .query("operatorWorkspaceScanContexts")
      .withIndex("source", (q) => q.eq("sourceId", source._id))
      .unique();
    sourceEffectiveAt(
      operation,
      source.evidence!,
      body,
      context ?? undefined,
      await validatedPdfIdentity(ctx, source._id, operation),
    );
    const target = await resolveScanTarget(ctx, operation);
    if (target.org?._id !== args.clientOrgId || target.org.type !== "client")
      throw new ScanAttention(
        "Policy insured identity does not match this client",
      );
    if (staged.clientOrgId && staged.clientOrgId !== args.clientOrgId)
      throw new ScanAttention(
        "Original PDF was already bound to another client",
      );
    await ctx.db.patch(staged._id, { clientOrgId: args.clientOrgId });
    return staged._id;
  },
});
