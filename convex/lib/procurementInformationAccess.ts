import { closeInformationFormOutreach } from "../providerOutreach";
import { normalizeProcurementEmail } from "./procurement";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireOperator, writeOperatorAudit } from "./operatorIdentity";
import {
  requireDirectOperatorWrite,
  requireRequest,
} from "../procurementRequests";
import { getOrgAccess } from "./access";
import { ownedRequest } from "../requestIntake";
import { getSessionUserId } from "./sessionIdentity";

export type Ctx = QueryCtx | MutationCtx;
export const MAX = 200;
export function text(value: string, max = 500) {
  const result = value.trim();
  if (!result || result.length > max)
    throw new Error(`Enter between 1 and ${max} characters`);
  return result;
}
export async function bounded<T>(promise: Promise<T[]>) {
  const rows = await promise;
  if (rows.length > MAX)
    throw new Error(
      "This request has reached its information tracking limit (200). Contact Spot.",
    );
  return rows;
}
export async function operatorWrite(
  ctx: MutationCtx,
  requestId: Id<"procurementRequests">,
) {
  const operator = await requireOperator(ctx);
  await requireDirectOperatorWrite(ctx, operator.user._id);
  const request = await requireRequest(ctx, requestId);
  if (request.deletedAt) throw new Error("Request not found");
  return { operator, request };
}
export async function clientAccess(
  ctx: Ctx,
  requestId: Id<"procurementRequests">,
  write = false,
) {
  // Unverified applicants may access their own request through ownedRequest below.
  const userId = await getSessionUserId(ctx, true);
  const user = userId ? await ctx.db.get(userId) : null;
  if (!user || user.serviceAccountKind) throw new Error("Sign in to continue");
  const request = await ctx.db.get(requestId);
  if (!request || request.deletedAt) throw new Error("Request not found");
  if (user.intakeRestricted || !request.clientVisible || !request.clientOrgId) {
    if (request.ownerUserId !== user._id || user.accountKind === "operator")
      throw new Error("Request not found");
    return { ...(await ownedRequest(ctx, requestId)), impersonated: false };
  }
  const access = await getOrgAccess(ctx, request.clientOrgId);
  if (
    access.orgType !== "client" ||
    access.accessType !== "member" ||
    (write && access.role !== "admin" && request.ownerUserId !== user._id)
  )
    throw new Error("Client request access required");
  return { request, user, impersonated: access.impersonated ?? false };
}
export async function audit(
  ctx: MutationCtx,
  userId: Id<"users">,
  request: Doc<"procurementRequests">,
  summary: string,
) {
  await writeOperatorAudit(ctx, {
    operatorUserId: userId,
    type: "setup_write",
    targetOrgId: request.clientOrgId,
    summary,
    metadata: { requestId: request._id },
  });
}
export async function requireInformationQuestion(
  ctx: Ctx,
  id: Id<"procurementInformationQuestions">,
  requestId: Id<"procurementRequests">,
) {
  const row = await ctx.db.get(id);
  if (!row || row.archivedAt || row.requestId !== requestId)
    throw new Error("Question not found");
  return row;
}
export async function requestFacts(
  ctx: Ctx,
  requestId: Id<"procurementRequests">,
) {
  const rows = await bounded(
    ctx.db
      .query("procurementInformationQuestions")
      .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
      .take(MAX + 1),
  );
  return Promise.all(
    rows
      .filter((q) => !q.archivedAt)
      .map(async (q) => ({
        ...q,
        answer: q.answerId ? await ctx.db.get(q.answerId) : null,
      })),
  );
}
export async function sourceMessage(
  ctx: Ctx,
  id: Id<"teamEmailMessages">,
  requestId: Id<"procurementRequests">,
  outreachId?: Id<"procurementBrokerOutreaches">,
) {
  const message = await ctx.db.get(id);
  const thread = message ? await ctx.db.get(message.threadId) : null;
  if (
    !message ||
    !thread ||
    thread.deletedAt ||
    thread.requestId !== requestId ||
    (outreachId && thread.outreachId && thread.outreachId !== outreachId)
  )
    throw new Error("Choose an email linked to this provider and request");
  if (outreachId && !thread.outreachId) {
    const outreach = await ctx.db.get(outreachId);
    const email =
      outreach?.contactEmail &&
      normalizeProcurementEmail(outreach.contactEmail);
    if (
      !outreach ||
      outreach.requestId !== requestId ||
      !email ||
      (message.direction === "inbound"
        ? normalizeProcurementEmail(message.fromEmail) !== email
        : !message.toAddresses
            .concat(message.ccAddresses)
            .some((value) => normalizeProcurementEmail(value) === email))
    )
      throw new Error("Email does not match this provider contact");
  }
  return message;
}
export async function filesForClient(
  ctx: Ctx,
  requestId: Id<"procurementRequests">,
) {
  const items = await bounded(
    ctx.db
      .query("procurementFileItems")
      .withIndex("request", (q) => q.eq("requestId", requestId))
      .take(MAX + 1),
  );
  const result = [];
  for (const item of items) {
    if (!item.clientVisible || item.removedAt || !item.clientFileId) continue;
    const file = await ctx.db.get(item.clientFileId);
    if (!file || file.deletedAt || file.archivedAt) continue;
    result.push({
      id: item._id,
      clientFileId: file._id,
      contentType: file.contentType,
      name: item.label || file.name,
      size: file.size,
    });
  }
  return result;
}
export async function businessNameForRequest(
  ctx: Ctx,
  request: Doc<"procurementRequests">,
) {
  return (
    request.intakeSubmittedApplication?.answers.dba?.trim() ||
    request.intakeAnswers?.dba?.trim() ||
    request.intakeSubmittedApplication?.answers.legalName?.trim() ||
    request.intakeAnswers?.legalName?.trim() ||
    (request.clientOrgId
      ? (await ctx.db.get(request.clientOrgId))?.name
      : undefined)
  );
}
export async function cancelSupersededForms(
  ctx: MutationCtx,
  requestId: Id<"procurementRequests">,
  questionId: Id<"procurementInformationQuestions">,
) {
  const forms = await bounded(
    ctx.db
      .query("procurementInformationForms")
      .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
      .take(MAX + 1),
  );
  for (const form of forms)
    if (
      form.status === "open" &&
      (form.questions.some((q) => q.questionId === questionId) ||
        form.prerequisites?.some((q) => q.questionId === questionId))
    ) {
      await ctx.db.patch(form._id, {
        status: "cancelled",
        revision: form.revision + 1,
      });
      await closeInformationFormOutreach(
        ctx,
        form,
        "information_form_cancelled",
      );
    }
}
/** Prerequisites of remaining questions and questions in an open form stay until those resolve. */
export async function assertInformationQuestionsArchivable(
  ctx: Ctx,
  requestId: Id<"procurementRequests">,
  questionIds: Id<"procurementInformationQuestions">[],
) {
  const archiving = new Set<string>(questionIds);
  const [facts, forms] = await Promise.all([
    requestFacts(ctx, requestId),
    bounded(
      ctx.db
        .query("procurementInformationForms")
        .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
        .take(MAX + 1),
    ),
  ]);
  if (
    facts.some(
      (q) =>
        !archiving.has(q._id) &&
        q.question.conditions?.some((c) => archiving.has(c.questionId)),
    )
  )
    throw new Error(
      "Remove dependent questions before removing their prerequisite",
    );
  if (
    forms.some(
      (f) =>
        f.status === "open" &&
        f.questions.some((q) => archiving.has(q.questionId)),
    )
  )
    throw new Error(
      "Cancel the open client form before removing this question",
    );
}
