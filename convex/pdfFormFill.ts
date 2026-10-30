import dayjs from "dayjs";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { submittedIntakeApplication } from "../lib/intake-application";
import { activeClientFile, setClientFileArchived } from "./clientFiles";
import { createClientFileFromGeneratedCertificate } from "./lib/clientFiles";
import {
  getActiveOperatorProfile,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import {
  pdfFormFieldValidator,
  pdfFormVersionFilename,
} from "./lib/pdfFormFields";
import {
  PDF_FORM_SOURCE_FORMATS,
  parsePdfFormSourceId,
} from "./lib/pdfFormSource";
import { NoWriteInputError } from "./lib/noWriteInputError";
import { readOrgWiki } from "./orgWiki";

const MAX_FORM_PDF_BYTES = 25 * 1024 * 1024;
const MAX_CONTEXT_POLICIES = 20;
const MAX_CONTEXT_NOTES_CHARS = 20_000;

type FormSource = {
  fileId: Id<"_storage">;
  filename: string;
  orgId?: Id<"organizations">;
  requestId?: Id<"procurementRequests">;
  brokerOrgId?: Id<"organizations">;
  submissionDefaultId?: Id<"providerSubmissionDefaults">;
  coverageCode?: string;
};

/** The form a saved version belongs to, so refilling restarts from its original. */
export async function fillForVersionFile(
  ctx: QueryCtx,
  fileId: Id<"_storage">,
) {
  const version = await ctx.db
    .query("pdfFormFillVersions")
    .withIndex("by_fileId", (q) => q.eq("fileId", fileId))
    .first();
  return version ? await ctx.db.get(version.fillId) : null;
}

async function savedFormSource(
  ctx: QueryCtx,
  fileId: Id<"_storage">,
): Promise<FormSource | null> {
  const fill = await fillForVersionFile(ctx, fileId);
  return fill
    ? {
        fileId: fill.sourceFileId,
        filename: fill.sourceFilename,
        orgId: fill.clientOrgId,
        requestId: fill.requestId,
        brokerOrgId: fill.brokerOrgId,
        submissionDefaultId: fill.submissionDefaultId,
        coverageCode: fill.coverageCode,
      }
    : null;
}

async function resolveSource(
  ctx: QueryCtx,
  threadId: Id<"operatorAgentThreads">,
  source: string,
): Promise<FormSource | null> {
  const parsed = parsePdfFormSourceId(source);
  if (parsed?.kind === "operatorAttachment") {
    const fileId = ctx.db.system.normalizeId("_storage", parsed.fileId);
    // A filled copy restarts from its original, whichever conversation shows it.
    const saved = fileId ? await savedFormSource(ctx, fileId) : null;
    if (saved) return saved;
    const attachment = fileId
      ? await ctx.db
          .query("operatorAgentAttachments")
          .withIndex("thread_file", (q) =>
            q.eq("threadId", threadId).eq("fileId", fileId),
          )
          .first()
      : null;
    return attachment
      ? { fileId: attachment.fileId, filename: attachment.filename }
      : null;
  }
  if (parsed?.kind === "clientFile") {
    const id = ctx.db.normalizeId("clientFiles", parsed.clientFileId);
    const file = id ? await ctx.db.get(id) : null;
    if (!file || file.deletedAt) return null;
    const saved = await savedFormSource(ctx, file.fileId);
    if (saved) return saved;
    if (!activeClientFile(file)) return null;
    return { fileId: file.fileId, filename: file.name, orgId: file.orgId };
  }
  if (parsed?.kind === "teamEmailAttachment") {
    const id = ctx.db.normalizeId("teamEmailMessages", parsed.messageId);
    const message = id ? await ctx.db.get(id) : null;
    const attachment = message?.unfiledAttachments?.find(
      (candidate) => candidate.storageId === parsed.storageId,
    );
    if (!message || !attachment) return null;
    const thread = await ctx.db.get(message.threadId);
    return {
      fileId: attachment.storageId,
      filename: attachment.name,
      orgId: message.clientOrgId ?? thread?.clientOrgId,
      requestId: thread?.requestId,
    };
  }
  if (parsed?.kind === "submissionDefaultForm") {
    const id = ctx.db.normalizeId(
      "providerSubmissionDefaults",
      parsed.defaultId,
    );
    const row = id ? await ctx.db.get(id) : null;
    const form = row?.forms.find(
      (candidate) => candidate.storageId === parsed.storageId,
    );
    return row && form
      ? {
          fileId: form.storageId,
          filename: form.name,
          brokerOrgId: row.brokerOrgId,
          submissionDefaultId: row._id,
          coverageCode: row.coverageCode,
        }
      : null;
  }
  return null;
}

function compactPolicy(policy: Doc<"policies">) {
  return {
    carrier: policy.security ?? policy.carrier,
    policyNumber: policy.policyNumber,
    linesOfBusiness: policy.linesOfBusiness,
    effectiveDate: policy.effectiveDate,
    expirationDate: policy.expirationDate,
    insuredName: policy.insuredName,
    insuredAddress: policy.insuredAddress,
    broker: policy.brokerAgency ?? policy.broker,
    premium: policy.premium,
    vehicles: policy.vehicles?.slice(0, 20).map((vehicle) => ({
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      vin: vehicle.vin,
      vehicleType: vehicle.vehicleType,
    })),
  };
}

function optionalId<T extends "organizations" | "procurementRequests">(
  ctx: QueryCtx,
  table: T,
  value: string | undefined,
  label: string,
) {
  if (!value) return null;
  const id = ctx.db.normalizeId(table, value);
  if (!id) throw new Error(`${label} not found`);
  return id;
}

/**
 * The form PDF, the client record the autofill may draw on, and the
 * procurement request and provider its versions are filed under.
 */
export const getSourceInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
    source: v.string(),
    orgId: v.optional(v.string()),
    procurementRequestId: v.optional(v.string()),
    brokerOrgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    const source = await resolveSource(ctx, args.threadId, args.source);
    if (!source)
      throw new Error(
        `PDF source not found. Use ${PDF_FORM_SOURCE_FORMATS}, from the PDF page context or this conversation.`,
      );
    const metadata = await ctx.db.system.get("_storage", source.fileId);
    if (!metadata) throw new Error("The PDF file is no longer available");
    if (metadata.size > MAX_FORM_PDF_BYTES)
      throw new Error("Form filling supports PDFs up to 25 MB");

    const requestId =
      optionalId(
        ctx,
        "procurementRequests",
        args.procurementRequestId,
        "Procurement request",
      ) ?? source.requestId;
    const request = requestId ? await ctx.db.get(requestId) : null;
    if (requestId && (!request || request.deletedAt))
      throw new Error("Procurement request not found");

    const orgId =
      optionalId(ctx, "organizations", args.orgId, "Client organization") ??
      request?.clientOrgId ??
      source.orgId;
    const org = orgId ? await ctx.db.get(orgId) : null;
    if (orgId && (!org || org.type !== "client" || org.deletedAt !== undefined))
      throw new Error(
        "Client organization not found. Use an exact client organization ID from search_organizations.",
      );
    if (request && request.clientOrgId !== org?._id)
      throw new Error("The procurement request belongs to another client");

    const brokerOrgId =
      optionalId(ctx, "organizations", args.brokerOrgId, "Provider") ??
      source.brokerOrgId;
    const provider = brokerOrgId ? await ctx.db.get(brokerOrgId) : null;
    if (brokerOrgId && (!provider || provider.type !== "broker"))
      throw new Error("Provider not found");
    const outreach =
      request && provider
        ? await ctx.db
            .query("procurementBrokerOutreaches")
            .withIndex("request_broker", (q) =>
              q.eq("requestId", request._id).eq("brokerOrgId", provider._id),
            )
            .first()
        : null;

    let client = null;
    if (org) {
      const [wiki, policies] = await Promise.all([
        readOrgWiki(ctx, org._id),
        ctx.db
          .query("policies")
          .withIndex("organization", (q) => q.eq("orgId", org._id))
          .order("desc")
          .take(MAX_CONTEXT_POLICIES * 2),
      ]);
      client = {
        orgId: org._id,
        name: org.name,
        website: org.website,
        businessProfile: wiki.businessProfile ?? wiki.legacyBusinessProfile,
        notes: wiki.body.slice(0, MAX_CONTEXT_NOTES_CHARS),
        policies: policies
          .filter((policy) => !policy.deletedAt)
          .slice(0, MAX_CONTEXT_POLICIES)
          .map(compactPolicy),
        ...(request
          ? {
              procurementRequest: {
                title: request.title,
                targetEffectiveDate: request.targetEffectiveDate,
                application: submittedIntakeApplication(request),
              },
            }
          : {}),
      };
    }
    return {
      fileId: source.fileId,
      filename: source.filename,
      size: metadata.size,
      client,
      filing: {
        ...(org ? { clientOrgId: org._id } : {}),
        ...(request ? { requestId: request._id } : {}),
        ...(provider ? { brokerOrgId: provider._id } : {}),
        ...(outreach ? { outreachId: outreach._id } : {}),
        ...(source.submissionDefaultId
          ? { submissionDefaultId: source.submissionDefaultId }
          : {}),
        ...(source.coverageCode ? { coverageCode: source.coverageCode } : {}),
      },
      request: request
        ? { requestId: request._id, title: request.title }
        : null,
      provider: provider
        ? {
            brokerOrgId: provider._id,
            name: provider.name,
            outreachId: outreach?._id ?? null,
          }
        : null,
    };
  },
});

const filingValidator = {
  clientOrgId: v.optional(v.id("organizations")),
  requestId: v.optional(v.id("procurementRequests")),
  brokerOrgId: v.optional(v.id("organizations")),
  outreachId: v.optional(v.id("procurementBrokerOutreaches")),
  submissionDefaultId: v.optional(v.id("providerSubmissionDefaults")),
  coverageCode: v.optional(v.string()),
};

/**
 * Files the next version of a form: a hidden client file that replaces the
 * previous version's (now archived), and on a procurement request one
 * provider-scoped file item that always points at the latest version.
 */
async function addVersion(
  ctx: MutationCtx,
  fill: Doc<"pdfFormFills">,
  args: {
    operatorUserId: Id<"users">;
    fileId: Id<"_storage">;
    version: number;
    source: Doc<"pdfFormFillVersions">["source"];
  },
) {
  const filename = pdfFormVersionFilename(fill.sourceFilename, args.version);
  const now = dayjs().valueOf();
  let clientFileId: Id<"clientFiles"> | undefined;
  let fileItemId = fill.fileItemId;
  if (fill.clientOrgId) {
    clientFileId = await createClientFileFromGeneratedCertificate(ctx, {
      operatorUserId: args.operatorUserId,
      orgId: fill.clientOrgId,
      fileId: args.fileId,
      filename,
    });
    const previous = await ctx.db
      .query("pdfFormFillVersions")
      .withIndex("by_fillId_and_version", (q) => q.eq("fillId", fill._id))
      .order("desc")
      .first();
    const previousFile = previous?.clientFileId
      ? await ctx.db.get(previous.clientFileId)
      : null;
    if (previousFile && activeClientFile(previousFile))
      await setClientFileArchived(ctx, previousFile, true, args.operatorUserId);
  }
  if (fill.requestId && fill.clientOrgId && clientFileId) {
    const provider = fill.brokerOrgId
      ? await ctx.db.get(fill.brokerOrgId)
      : null;
    const label =
      `${provider ? `${provider.name} application: ` : ""}${filename}`.slice(
        0,
        300,
      );
    const current = fileItemId ? await ctx.db.get(fileItemId) : null;
    if (current && !current.removedAt)
      await ctx.db.patch(current._id, {
        clientFileId,
        label,
        updatedByUserId: args.operatorUserId,
        updatedAt: now,
      });
    else
      fileItemId = await ctx.db.insert("procurementFileItems", {
        requestId: fill.requestId,
        clientOrgId: fill.clientOrgId,
        ...(fill.outreachId ? { outreachId: fill.outreachId } : {}),
        clientFileId,
        label,
        documentCategory: "supporting",
        // Provider-specific: not released in the shared request packet.
        brokerRelease: "hidden",
        clientVisible: false,
        createdByUserId: args.operatorUserId,
        updatedByUserId: args.operatorUserId,
        createdAt: now,
        updatedAt: now,
      });
  }
  await ctx.db.insert("pdfFormFillVersions", {
    fillId: fill._id,
    version: args.version,
    fileId: args.fileId,
    filename,
    ...(clientFileId ? { clientFileId } : {}),
    source: args.source,
    createdAt: now,
    createdByUserId: args.operatorUserId,
  });
  await ctx.db.patch(fill._id, {
    outputFileId: args.fileId,
    outputFilename: filename,
    ...(fileItemId ? { fileItemId } : {}),
    version: args.version,
    updatedAt: now,
    updatedByUserId: args.operatorUserId,
  });
  if (fill.clientOrgId)
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "setup_write",
      targetOrgId: fill.clientOrgId,
      summary: `${args.source === "edit" ? "Saved" : "Filled"} version ${args.version} of ${fill.sourceFilename}`,
      metadata: {
        domain: "pdf_forms",
        fillId: fill._id,
        requestId: fill.requestId,
        outreachId: fill.outreachId,
        version: args.version,
      },
    });
  return {
    version: args.version,
    filename,
    previousFileId: fill.outputFileId,
    ...(clientFileId ? { clientFileId } : {}),
    ...(fileItemId ? { fileItemId } : {}),
  };
}

/**
 * Records an autofill. Refilling the same original for the same client,
 * request and provider adds the next version instead of a second copy.
 */
export const recordFillInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
    sourceFileId: v.id("_storage"),
    sourceFilename: v.string(),
    outputFileId: v.id("_storage"),
    pageCount: v.number(),
    fields: v.array(pdfFormFieldValidator),
    ...filingValidator,
  },
  handler: async (ctx, { operatorUserId, ...args }) => {
    await requireOperatorForUser(ctx, operatorUserId);
    const now = dayjs().valueOf();
    const candidates = await ctx.db
      .query("pdfFormFills")
      .withIndex("by_sourceFileId", (q) => q.eq("sourceFileId", args.sourceFileId))
      .order("desc")
      .take(50);
    const existing = candidates.find(
      (fill) =>
        fill.clientOrgId === args.clientOrgId &&
        fill.requestId === args.requestId &&
        fill.brokerOrgId === args.brokerOrgId,
    );
    const fillId = existing
      ? existing._id
      : await ctx.db.insert("pdfFormFills", {
          ...args,
          operatorUserId,
          outputFilename: pdfFormVersionFilename(args.sourceFilename, 1),
          version: 0,
          createdAt: now,
          updatedAt: now,
        });
    if (existing)
      await ctx.db.patch(existing._id, {
        threadId: args.threadId,
        pageCount: args.pageCount,
        fields: args.fields,
        ...(args.outreachId ? { outreachId: args.outreachId } : {}),
      });
    const fill = (await ctx.db.get(fillId))!;
    const filed = await addVersion(ctx, fill, {
      operatorUserId,
      fileId: args.outputFileId,
      version: fill.version + 1,
      source: "autofill",
    });
    return { fillId, ...filed };
  },
});

/** The filled form behind a PDF source (any of its versions), for edit_pdf_form. */
export const getFillForEditInternal = internalQuery({
  args: { operatorUserId: v.id("users"), source: v.string() },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    const fileId = await pdfSourceFileId(ctx, args.source);
    const fill = fileId ? await fillForVersionFile(ctx, fileId) : null;
    if (!fill)
      throw new NoWriteInputError(
        "form_not_filled",
        "That PDF is not a filled form. Fill it with fill_pdf_form first.",
      );
    // Fills from before every form was filled flat have no field positions.
    if (fill.mode === "acroform")
      throw new NoWriteInputError(
        "form_refill_required",
        "This form was filled with an older method. Refill it with fill_pdf_form, passing the corrections in answers.",
      );
    return {
      fillId: fill._id,
      version: fill.version,
      sourceFileId: fill.sourceFileId,
      fields: fill.fields,
    };
  },
});

/**
 * Commits an agent edit as the next version. The caller has already rendered
 * `fileId` from the original with `renderPdfFormFields`; a stale
 * `expectedVersion` means another edit landed first.
 */
export const commitEditInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    fillId: v.id("pdfFormFills"),
    expectedVersion: v.number(),
    fields: v.array(pdfFormFieldValidator),
    fileId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    const fill = await ctx.db.get(args.fillId);
    if (!fill) throw new NoWriteInputError("form_not_found", "Filled form not found");
    if (fill.version !== args.expectedVersion)
      throw new NoWriteInputError(
        "form_version_conflict",
        "The form changed while editing. Read it again and retry.",
      );
    await ctx.db.patch(fill._id, { fields: args.fields });
    return await addVersion(ctx, fill, {
      operatorUserId: args.operatorUserId,
      fileId: args.fileId,
      version: fill.version + 1,
      source: "edit",
    });
  },
});

/** A run that stopped reporting this long ago failed without saying so. */
const PDF_FORM_RUN_STALE_MS = 5 * 60 * 1000;

export function isLivePdfFormRun(
  run: Doc<"pdfFormFillRuns">,
): run is Doc<"pdfFormFillRuns"> & { stage: "reading" | "placing" } {
  return (
    (run.stage === "reading" || run.stage === "placing") &&
    dayjs().valueOf() - run.updatedAt < PDF_FORM_RUN_STALE_MS
  );
}

export async function latestPdfFormRun(
  ctx: QueryCtx,
  sourceFileId: Id<"_storage">,
) {
  return await ctx.db
    .query("pdfFormFillRuns")
    .withIndex("by_sourceFileId", (q) => q.eq("sourceFileId", sourceFileId))
    .order("desc")
    .first();
}

export const startRunInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
    sourceFileId: v.id("_storage"),
    sourceFilename: v.string(),
    clientOrgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    return await ctx.db.insert("pdfFormFillRuns", {
      ...args,
      stage: "reading",
      fields: [],
      startedAt: now,
      updatedAt: now,
    });
  },
});

export const progressRunInternal = internalMutation({
  args: {
    runId: v.id("pdfFormFillRuns"),
    stage: v.union(v.literal("reading"), v.literal("placing")),
    fields: v.array(pdfFormFieldValidator),
    total: v.optional(v.number()),
  },
  handler: async (ctx, { runId, ...progress }) => {
    const run = await ctx.db.get(runId);
    if (!run || !isLivePdfFormRun(run)) return null;
    await ctx.db.patch(runId, { ...progress, updatedAt: dayjs().valueOf() });
    return null;
  },
});

export const finishRunInternal = internalMutation({
  args: {
    runId: v.id("pdfFormFillRuns"),
    fillId: v.optional(v.id("pdfFormFills")),
    outputFileId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { runId, fillId, outputFileId }) => {
    await ctx.db.patch(runId, {
      stage: fillId && outputFileId ? "done" : "failed",
      ...(fillId ? { fillId } : {}),
      ...(outputFileId ? { outputFileId } : {}),
      updatedAt: dayjs().valueOf(),
    });
    return null;
  },
});

/** The form this conversation's agent is filling now, so the panel can show it live. */
export const activeRunForThread = query({
  args: { threadId: v.id("operatorAgentThreads") },
  returns: v.union(
    v.null(),
    v.object({
      runId: v.id("pdfFormFillRuns"),
      sourceFileId: v.id("_storage"),
      sourceFilename: v.string(),
      url: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { threadId }) => {
    if (!(await getActiveOperatorProfile(ctx))) return null;
    const run = await ctx.db
      .query("pdfFormFillRuns")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .order("desc")
      .first();
    if (!run || !isLivePdfFormRun(run)) return null;
    return {
      runId: run._id,
      sourceFileId: run.sourceFileId,
      sourceFilename: run.sourceFilename,
      url: await ctx.storage.getUrl(run.sourceFileId),
    };
  },
});

/** The stored file behind a PDF panel source. */
export async function pdfSourceFileId(ctx: QueryCtx, source: string) {
  const parsed = parsePdfFormSourceId(source);
  if (parsed?.kind === "clientFile") {
    const id = ctx.db.normalizeId("clientFiles", parsed.clientFileId);
    const file = id ? await ctx.db.get(id) : null;
    return file && !file.deletedAt ? file.fileId : null;
  }
  const storageId =
    parsed?.kind === "operatorAttachment" ? parsed.fileId : parsed?.storageId;
  return storageId ? ctx.db.system.normalizeId("_storage", storageId) : null;
}

const pdfDocumentSourceValidator = v.union(
  v.object({
    kind: v.literal("clientFile"),
    clientFileId: v.id("clientFiles"),
    filename: v.string(),
  }),
  v.object({
    kind: v.literal("operatorAttachment"),
    fileId: v.id("_storage"),
    filename: v.string(),
  }),
);

/**
 * What the PDF panel shows for the open PDF: a fill in progress (live, for
 * every operator viewing it), a filled form (edited through the agent), or
 * Fill form. A fill that just finished points at its filled copy so viewers
 * move to it.
 */
export const getForDocument = query({
  args: { source: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      status: v.literal("fillable"),
      finished: v.union(
        v.null(),
        v.object({
          runId: v.id("pdfFormFillRuns"),
          url: v.string(),
          source: pdfDocumentSourceValidator,
        }),
      ),
    }),
    v.object({
      status: v.literal("filling"),
      runId: v.id("pdfFormFillRuns"),
      stage: v.union(v.literal("reading"), v.literal("placing")),
      fields: v.array(pdfFormFieldValidator),
      total: v.union(v.number(), v.null()),
    }),
    v.object({
      status: v.literal("filled"),
      version: v.number(),
      isLatest: v.boolean(),
    }),
  ),
  handler: async (ctx, { source }) => {
    // Clients open the same files in their library; filling is operator-only.
    if (!(await getActiveOperatorProfile(ctx))) return null;
    const fileId = await pdfSourceFileId(ctx, source);
    if (!fileId) return null;
    const fill = await fillForVersionFile(ctx, fileId);
    if (fill)
      return {
        status: "filled" as const,
        version: fill.version,
        isLatest: fill.outputFileId === fileId,
      };
    const run = await latestPdfFormRun(ctx, fileId);
    if (run && isLivePdfFormRun(run))
      return {
        status: "filling" as const,
        runId: run._id,
        stage: run.stage,
        fields: run.fields,
        total: run.total ?? null,
      };
    const version =
      run?.stage === "done" && run.outputFileId
        ? await ctx.db
            .query("pdfFormFillVersions")
            .withIndex("by_fileId", (q) => q.eq("fileId", run.outputFileId!))
            .first()
        : null;
    const url = version ? await ctx.storage.getUrl(version.fileId) : null;
    return {
      status: "fillable" as const,
      finished:
        run && version && url
          ? {
              runId: run._id,
              url,
              source: version.clientFileId
                ? {
                    kind: "clientFile" as const,
                    clientFileId: version.clientFileId,
                    filename: version.filename,
                  }
                : {
                    kind: "operatorAttachment" as const,
                    fileId: version.fileId,
                    filename: version.filename,
                  },
            }
          : null,
    };
  },
});
