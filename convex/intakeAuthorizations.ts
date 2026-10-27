import dayjs from "dayjs";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { IntakeApplication } from "../lib/intake-application";
import { INTAKE_AUTHORITY_STATEMENT, INTAKE_TERMS_VERSION, SPOT_REPRESENTATION_TERMS } from "../lib/intake-terms";

async function authorizationClientFile(ctx: MutationCtx, row: Doc<"requestIntakeAuthorizations">) {
  // Older declarations published the client file through a request attachment.
  const item = !row.clientFileId && row.fileItemId ? await ctx.db.get(row.fileItemId) : null;
  const clientFileId = row.clientFileId ?? item?.clientFileId;
  const file = clientFileId ? await ctx.db.get(clientFileId) : null;
  if (file?.orgId === row.clientOrgId && file.fileId === row.fileId) return file;
  // Request entries can be edited/detached; the stored signed blob is authoritative.
  return row.fileId ? await ctx.db.query("clientFiles")
    .withIndex("storage", (q) => q.eq("fileId", row.fileId!))
    .filter((q) => q.eq(q.field("orgId"), row.clientOrgId)).first() : null;
}

async function linkAuthorizationToRequest(
  ctx: MutationCtx,
  row: Doc<"requestIntakeAuthorizations">,
  request: Doc<"procurementRequests">,
  clientFileId: Id<"clientFiles">,
) {
  if (request.deletedAt || request.clientOrgId !== row.clientOrgId) return;
  const existing = await ctx.db.query("procurementFileItems")
    .withIndex("by_requestId_and_clientFileId", (q) => q.eq("requestId", request._id).eq("clientFileId", clientFileId))
    .filter((q) => q.eq(q.field("outreachId"), undefined)).first();
  // Repeated submissions must not undo an operator's explicit hide/removal.
  if (existing) return;
  const now = dayjs().valueOf();
  const oldGrant = request.intakeAuthorizationId && request.intakeAuthorizationId !== row._id
    ? await ctx.db.get(request.intakeAuthorizationId) : null;
  const oldItem = oldGrant?.fileItemId ? await ctx.db.get(oldGrant.fileItemId) : null;
  const oldFile = oldGrant ? await authorizationClientFile(ctx, oldGrant) : null;
  if (oldGrant?.clientOrgId === row.clientOrgId && oldFile && oldItem?.clientFileId === oldFile._id && oldItem.requestId === request._id && oldItem.clientOrgId === row.clientOrgId) {
    // Adopt legacy request grants without resetting their release/removal choices.
    if (!oldGrant.clientFileId) await ctx.db.patch(oldGrant._id, { clientFileId: oldFile._id });
    await ctx.db.patch(oldItem._id, { clientFileId, label: `Spot authorization - ${row.legalName}.pdf`, updatedAt: now });
    await ctx.db.patch(request._id, { packetRevision: (request.packetRevision ?? 0) + 1 });
    return;
  }
  await ctx.db.insert("procurementFileItems", {
    requestId: request._id, clientOrgId: row.clientOrgId, clientFileId, label: `Spot authorization - ${row.legalName}.pdf`,
    documentCategory: "supporting", brokerRelease: "attached", clientVisible: true,
    createdByUserId: row.userId, updatedByUserId: row.userId, createdAt: now, updatedAt: now,
  });
  await ctx.db.patch(request._id, { packetRevision: (request.packetRevision ?? 0) + 1 });
}

/** Reuse an existing client grant; this never creates or implies new consent. */
export async function linkClientIntakeAuthorization(ctx: MutationCtx, requestId: Id<"procurementRequests">) {
  const request = await ctx.db.get(requestId);
  if (!request?.clientOrgId || request.deletedAt || request.intakeAnswers?.intakeGoal === "savings") return;
  const org = await ctx.db.get(request.clientOrgId);
  const row = org?.intakeAuthorizationId ? await ctx.db.get(org.intakeAuthorizationId) : null;
  if (!org || org.deletedAt || !row || row.clientOrgId !== org._id) return;
  if (row.status === "ready") {
    const file = await authorizationClientFile(ctx, row);
    if (file && !file.deletedAt && !file.archivedAt) await linkAuthorizationToRequest(ctx, row, request, file._id);
  }
  await ctx.db.patch(request._id, { intakeAuthorizationId: row._id });
}

/** Called only by the owner-authorized submit transaction, never by draft saves.
 * The first accepted grant belongs to the client, independently of later requests.
 */
export async function ensureClientIntakeAuthorization(
  ctx: MutationCtx,
  requestId: Id<"procurementRequests">,
  application: IntakeApplication,
  contentHash: string,
) {
  const request = await ctx.db.get(requestId);
  const consent = request?.intakeTermsAcceptance;
  if (!request?.clientOrgId || !request.intakeSubmittedAt ||
      !consent?.signerName || !consent.signerEmail || consent.version !== INTAKE_TERMS_VERSION ||
      application.answers.intakeGoal === "savings") throw new Error("Signed quote authorization required");
  const org = await ctx.db.get(request.clientOrgId);
  if (!org || org.deletedAt) throw new Error("Authorization client missing");
  // Adopt the latest existing grant without rewriting its signed facts or PDF.
  const previous = org.intakeAuthorizationId
    ? await ctx.db.get(org.intakeAuthorizationId)
    : await ctx.db.query("requestIntakeAuthorizations")
      .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", org._id)).order("desc").first();
  if (previous) {
    if (previous.clientOrgId !== org._id) throw new Error("Authorization client mismatch");
    await ctx.db.patch(org._id, { intakeAuthorizationId: previous._id });
    await ctx.db.patch(requestId, { intakeAuthorizationId: previous._id });
    if (previous.status === "ready") {
      const file = await authorizationClientFile(ctx, previous);
      if (file) {
        await ctx.db.patch(previous._id, { clientFileId: file._id });
        if (!file.archivedAt && !file.deletedAt) {
          await linkAuthorizationToRequest(ctx, previous, request, file._id);
          if (!org.intakeAuthorizationId) await ctx.scheduler.runAfter(0, internal.intakeAuthorizations.adoptLegacyGrantsInternal, {
            authorizationId: previous._id, cursor: null,
          });
        }
      }
    } else if (previous.status === "failed") {
      await ctx.db.patch(previous._id, { status: "pending", attempts: 0 });
      await ctx.scheduler.runAfter(0, internal.actions.intakeAuthorization.generate, { authorizationId: previous._id });
    }
    return previous._id;
  }
  const id = await ctx.db.insert("requestIntakeAuthorizations", {
    requestId, clientOrgId: request.clientOrgId, userId: consent.userId,
    signerName: consent.signerName, signerEmail: consent.signerEmail,
    legalName: application.answers.legalName!.trim(),
    ...(application.answers.dba?.trim() ? { dba: application.answers.dba.trim() } : {}),
    acceptedAt: consent.acceptedAt, submittedAt: application.submittedAt, contentHash,
    termsVersion: consent.version,
    termsUrl: new URL(consent.url, "https://app.spot.insure").toString(),
    statement: consent.statement, representationTerms: SPOT_REPRESENTATION_TERMS,
    authorityStatement: INTAKE_AUTHORITY_STATEMENT,
    status: "pending", attempts: 0, createdAt: dayjs().valueOf(),
  });
  await ctx.db.patch(org._id, { intakeAuthorizationId: id });
  await ctx.db.patch(requestId, { intakeAuthorizationId: id });
  await ctx.scheduler.runAfter(0, internal.actions.intakeAuthorization.generate, { authorizationId: id });
  return id;
}

export const getInternal = internalQuery({
  args: { authorizationId: v.id("requestIntakeAuthorizations") },
  handler: async (ctx, { authorizationId }) => {
    const row = await ctx.db.get(authorizationId);
    if (!row || row.status !== "pending") return null;
    const org = await ctx.db.get(row.clientOrgId);
    if (!org || org.deletedAt) return null;
    if (org.intakeAuthorizationId) return org.intakeAuthorizationId === row._id ? row : null;
    // Compatibility for work queued before client ownership was introduced.
    const request = await ctx.db.get(row.requestId);
    return request && !request.deletedAt && request.clientOrgId === row.clientOrgId && request.intakeAuthorizationId === row._id ? row : null;
  },
});

// Lazy adoption of already generated forms: keep their signed bytes as archived
// evidence, and point existing packet entries at the client's one shared file.
// This runs only when an authorized submission first claims client ownership.
export const adoptLegacyGrantsInternal = internalMutation({
  args: { authorizationId: v.id("requestIntakeAuthorizations"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { authorizationId, cursor }) => {
    const row = await ctx.db.get(authorizationId);
    if (!row || row.status !== "ready") return null;
    const org = await ctx.db.get(row.clientOrgId);
    const file = await authorizationClientFile(ctx, row);
    if (!org || org.deletedAt || org.intakeAuthorizationId !== row._id || !file || file.archivedAt || file.deletedAt) return null;
    const page = await ctx.db.query("requestIntakeAuthorizations")
      .withIndex("by_clientOrgId", (q) => q.eq("clientOrgId", row.clientOrgId))
      .paginate({ cursor, numItems: 50 });
    const now = dayjs().valueOf();
    for (const historical of page.page) {
      if (historical._id === row._id) continue;
      const oldFile = await authorizationClientFile(ctx, historical);
      const request = await ctx.db.get(historical.requestId);
      if (request && !request.deletedAt && request.clientOrgId === row.clientOrgId && request.intakeAuthorizationId === historical._id) {
        await linkAuthorizationToRequest(ctx, row, request, file._id);
        await ctx.db.patch(request._id, { intakeAuthorizationId: row._id });
      }
      // An older file item may remain after resubmission already selected the
      // canonical grant. Hide that historical publication rather than duplicate it.
      const item = historical.fileItemId ? await ctx.db.get(historical.fileItemId) : null;
      if (oldFile && item && item.clientOrgId === row.clientOrgId && item.clientFileId === oldFile._id && item.clientFileId !== file._id && !item.removedAt) {
        await ctx.db.patch(item._id, { brokerRelease: "hidden", clientVisible: false, removedAt: now, updatedAt: now });
        if (request && !request.deletedAt && request.clientOrgId === row.clientOrgId) {
          const latest = await ctx.db.get(request._id);
          await ctx.db.patch(request._id, { packetRevision: (latest?.packetRevision ?? 0) + 1 });
        }
      }
      if (oldFile && oldFile._id !== file._id && !oldFile.archivedAt && !oldFile.deletedAt) {
        await ctx.db.patch(oldFile._id, { archivedAt: now, archivedByUserId: row.userId, updatedAt: now });
      }
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.intakeAuthorizations.adoptLegacyGrantsInternal, {
      authorizationId, cursor: page.continueCursor,
    });
    return null;
  },
});

export const finishInternal = internalMutation({
  args: { authorizationId: v.id("requestIntakeAuthorizations"), fileId: v.id("_storage") },
  handler: async (ctx, { authorizationId, fileId }) => {
    const row = await ctx.db.get(authorizationId);
    if (!row || row.status !== "pending") return false;
    const org = await ctx.db.get(row.clientOrgId);
    if (!org || org.deletedAt || (org.intakeAuthorizationId && org.intakeAuthorizationId !== row._id)) return false;
    if (!org.intakeAuthorizationId) {
      const request = await ctx.db.get(row.requestId);
      if (!request || request.deletedAt || request.clientOrgId !== row.clientOrgId || request.intakeAuthorizationId !== row._id) return false;
      await ctx.db.patch(org._id, { intakeAuthorizationId: row._id });
    }
    const metadata = await ctx.db.system.get(fileId);
    if (!metadata || metadata.contentType !== "application/pdf") throw new Error("Authorization PDF missing");
    const now = dayjs().valueOf();
    const name = `Spot authorization - ${row.legalName}.pdf`;
    const clientFileId = await ctx.db.insert("clientFiles", {
      orgId: row.clientOrgId, fileId, name, originalName: name, contentType: "application/pdf",
      size: metadata.size, sha256: metadata.sha256, clientVisible: true,
      uploadedByUserId: row.userId, uploadedBySide: "client", nameSource: "original", nameStatus: "ready",
      createdAt: now, updatedAt: now,
    });
    await ctx.db.patch(row._id, { status: "ready", fileId, clientFileId });
    await ctx.scheduler.runAfter(0, internal.intakeAuthorizations.linkRequestsInternal, { authorizationId, cursor: null });
    await ctx.scheduler.runAfter(0, internal.intakeAuthorizations.adoptLegacyGrantsInternal, { authorizationId, cursor: null });
    return true;
  },
});

// Client requests share one file, including manual requests and submissions made
// while its renderer was running. Unsubmitted intake drafts stay unpublished.
export const linkRequestsInternal = internalMutation({
  args: { authorizationId: v.id("requestIntakeAuthorizations"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { authorizationId, cursor }) => {
    const row = await ctx.db.get(authorizationId);
    if (!row || row.status !== "ready") return null;
    const org = await ctx.db.get(row.clientOrgId);
    const file = await authorizationClientFile(ctx, row);
    if (!org || org.deletedAt || org.intakeAuthorizationId !== row._id || !file || file.deletedAt || file.archivedAt) return null;
    const page = await ctx.db.query("procurementRequests")
      .withIndex("organization", (q) => q.eq("clientOrgId", row.clientOrgId))
      .paginate({ cursor, numItems: 50 });
    for (const request of page.page) {
      if (request.deletedAt || (request.ownerUserId && !request.intakeSubmittedAt) || request.intakeAnswers?.intakeGoal === "savings") continue;
      await linkAuthorizationToRequest(ctx, row, request, file._id);
      if (request.intakeAuthorizationId !== row._id) await ctx.db.patch(request._id, { intakeAuthorizationId: row._id });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.intakeAuthorizations.linkRequestsInternal, {
      authorizationId, cursor: page.continueCursor,
    });
    return null;
  },
});

export const failInternal = internalMutation({
  args: { authorizationId: v.id("requestIntakeAuthorizations") },
  handler: async (ctx, { authorizationId }) => {
    const row = await ctx.db.get(authorizationId);
    if (!row || row.status !== "pending") return null;
    const attempts = row.attempts + 1;
    await ctx.db.patch(row._id, { attempts, ...(attempts >= 3 ? { status: "failed" as const } : {}) });
    if (attempts < 3) await ctx.scheduler.runAfter(5000 * attempts, internal.actions.intakeAuthorization.generate, { authorizationId });
    return null;
  },
});
