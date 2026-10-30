import dayjs from "dayjs";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { submittedIntakeApplication } from "../lib/intake-application";
import { activeClientFile, setClientFileArchived } from "./clientFiles";
import { createClientFileFromGeneratedCertificate } from "./lib/clientFiles";
import {
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import {
  pdfFormFieldValidator,
  pdfFormModeValidator,
  pdfFormVersionFilename,
  type PdfFormField,
} from "./lib/pdfFormFields";
import {
  PDF_FORM_SOURCE_FORMATS,
  parsePdfFormSourceId,
} from "./lib/pdfFormSource";
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
    const attachment = fileId
      ? await ctx.db
          .query("operatorAgentAttachments")
          .withIndex("thread_file", (q) =>
            q.eq("threadId", threadId).eq("fileId", fileId),
          )
          .first()
      : null;
    if (!attachment) return null;
    return (
      (await savedFormSource(ctx, attachment.fileId)) ?? {
        fileId: attachment.fileId,
        filename: attachment.filename,
      }
    );
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
    mode: pdfFormModeValidator,
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
        mode: args.mode,
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

/**
 * Commits an operator edit as the next version. The caller has already
 * rendered `fileId` from the original with `renderPdfFormFields`; a stale
 * `expectedVersion` means someone else saved first.
 */
export async function commitPdfFormEdit(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    fillId: Id<"pdfFormFills">;
    expectedVersion: number;
    fields: PdfFormField[];
    fileId: Id<"_storage">;
  },
) {
  await requireOperatorForUser(ctx, args.operatorUserId);
  const fill = await ctx.db.get(args.fillId);
  if (!fill) throw new Error("Filled form not found");
  if (fill.version !== args.expectedVersion)
    throw new Error(
      "This form was saved by someone else. Reload before saving again.",
    );
  await ctx.db.patch(fill._id, { fields: args.fields });
  return await addVersion(ctx, fill, {
    operatorUserId: args.operatorUserId,
    fileId: args.fileId,
    version: fill.version + 1,
    source: "edit",
  });
}
