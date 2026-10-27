import dayjs from "dayjs";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { IntakeApplication } from "../lib/intake-application";
import { INTAKE_AUTHORITY_STATEMENT, INTAKE_TERMS_VERSION, SPOT_REPRESENTATION_TERMS } from "../lib/intake-terms";

/** Called only by the owner-authorized submit transaction, never by draft saves. */
export async function createIntakeAuthorization(
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
  const previous = request.intakeAuthorizationId ? await ctx.db.get(request.intakeAuthorizationId) : null;
  if (previous?.contentHash === contentHash) return previous._id;
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
  // Old PDFs remain evidence, but only the current declaration is published.
  if (previous?.fileItemId) await ctx.db.patch(previous.fileItemId, { brokerRelease: "hidden", clientVisible: false });
  await ctx.db.patch(requestId, { intakeAuthorizationId: id });
  await ctx.scheduler.runAfter(0, internal.actions.intakeAuthorization.generate, { authorizationId: id });
  return id;
}

export const getInternal = internalQuery({
  args: { authorizationId: v.id("requestIntakeAuthorizations") },
  handler: async (ctx, { authorizationId }) => {
    const row = await ctx.db.get(authorizationId);
    if (!row || row.status !== "pending") return null;
    const request = await ctx.db.get(row.requestId);
    const org = await ctx.db.get(row.clientOrgId);
    return request && !request.deletedAt && request.clientOrgId === row.clientOrgId && org && !org.deletedAt ? row : null;
  },
});

export const finishInternal = internalMutation({
  args: { authorizationId: v.id("requestIntakeAuthorizations"), fileId: v.id("_storage") },
  handler: async (ctx, { authorizationId, fileId }) => {
    const row = await ctx.db.get(authorizationId);
    if (!row || row.status !== "pending") return false;
    const request = await ctx.db.get(row.requestId);
    const org = await ctx.db.get(row.clientOrgId);
    if (!request || request.deletedAt || request.clientOrgId !== row.clientOrgId || !org || org.deletedAt) return false;
    const metadata = await ctx.db.system.get(fileId);
    if (!metadata || metadata.contentType !== "application/pdf") throw new Error("Authorization PDF missing");
    const now = dayjs().valueOf();
    let fileItemId: Id<"procurementFileItems"> | undefined;
    if (request.intakeAuthorizationId === row._id) {
      const name = `Spot authorization - ${row.legalName} - ${dayjs(row.submittedAt).format("YYYY-MM-DD")}.pdf`;
      const clientFileId = await ctx.db.insert("clientFiles", {
        orgId: row.clientOrgId, fileId, name, originalName: name, contentType: "application/pdf",
        size: metadata.size, sha256: metadata.sha256, clientVisible: true,
        uploadedByUserId: row.userId, uploadedBySide: "client", nameSource: "original", nameStatus: "ready",
        createdAt: now, updatedAt: now,
      });
      fileItemId = await ctx.db.insert("procurementFileItems", {
        requestId: row.requestId, clientOrgId: row.clientOrgId, clientFileId, label: name,
        documentCategory: "supporting", brokerRelease: "attached", clientVisible: true,
        createdByUserId: row.userId, updatedByUserId: row.userId, createdAt: now, updatedAt: now,
      });
      await ctx.db.patch(request._id, { packetRevision: (request.packetRevision ?? 0) + 1 });
    }
    await ctx.db.patch(row._id, { status: "ready", fileId, ...(fileItemId ? { fileItemId } : {}) });
    return true;
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
