import { v } from "convex/values";
import dayjs from "dayjs";

import { internalMutation, mutation, query } from "./_generated/server";
import { requireOperator } from "./lib/operatorIdentity";
import {
  normalizedDraftEmail,
  providerDraftProblem,
  queueProviderOutreachDraft,
  readProviderOutreachDraft,
  readyDraftEmail,
  writeProviderOutreachDraft,
} from "./lib/providerOutreachDrafts";
import { MAX_LAUNCH_PROVIDERS } from "./lib/providerOutreachSchedule";
import { MERGE_VARIABLES } from "./lib/providerOutreachMerge";
import { requireDirectOperatorWrite } from "./procurementRequests";
import { loadCompanyRequest, providerEmailDraftContext, requestEmailTemplate } from "./providerOutreach";
import { loadEmailPrompts } from "./lib/emailPrompts";

/**
 * Spot's drafts of a request's first provider emails, for the composer: the
 * provider's own draft (tailored by Spot or written by the AI panel) and the
 * request's mail-merge template. `revision` changes on every rewrite so an
 * unedited composer takes it.
 */
export const get = query({
  args: {
    requestId: v.id("procurementRequests"),
    brokerOrgId: v.optional(v.id("organizations")),
    /** A mail merge's providers: their own emails edited by an operator or the AI panel. */
    brokerOrgIds: v.optional(v.array(v.id("organizations"))),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const { request, client } = await loadCompanyRequest(ctx, args.requestId);
    const template = await requestEmailTemplate(ctx, request, client);
    const own = args.brokerOrgId
      ? await readProviderOutreachDraft(ctx, request._id, args.brokerOrgId)
      : null;
    return {
      template: { subject: template.subject, body: template.body, source: template.source },
      draft: own
        ? {
            status: own.status,
            subject: own.subject ?? null,
            body: own.body ?? null,
            source: own.source ?? null,
            revision: own.updatedAt,
          }
        : null,
      variables: MERGE_VARIABLES,
      edits: (
        await Promise.all(
          (args.brokerOrgIds ?? []).slice(0, MAX_LAUNCH_PROVIDERS).map(async (brokerOrgId) => {
            const draft = await readProviderOutreachDraft(ctx, request._id, brokerOrgId);
            const email = readyDraftEmail(draft);
            return email && (draft?.source === "operator" || draft?.source === "agent")
              ? [{ brokerOrgId, ...email, source: draft.source, revision: draft.updatedAt }]
              : [];
          }),
        )
      ).flat(),
    };
  },
});

/**
 * Saves the email an operator edited for one provider in a mail merge's
 * preview. It is that provider's own draft, so the AI panel reads and revises
 * it too; sending still passes the reviewed text.
 */
export const saveEdit = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    brokerOrgId: v.id("organizations"),
    subject: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireDirectOperatorWrite(ctx, operator.userId);
    const { request } = await loadCompanyRequest(ctx, args.requestId);
    const provider = await ctx.db.get(args.brokerOrgId);
    if (!provider || provider.type !== "broker" || provider.deletedAt !== undefined)
      throw new Error("Provider not found");
    await writeProviderOutreachDraft(ctx, {
      requestId: request._id,
      brokerOrgId: provider._id,
      email: { subject: args.subject, body: args.body },
      source: "operator",
    });
  },
});

/** Drops a provider's edited email so the mail merge's template applies again. */
export const resetEdit = mutation({
  args: { requestId: v.id("procurementRequests"), brokerOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireDirectOperatorWrite(ctx, operator.userId);
    const draft = await readProviderOutreachDraft(ctx, args.requestId, args.brokerOrgId);
    if (draft && (draft.source === "operator" || draft.source === "agent")) await ctx.db.delete(draft._id);
  },
});

/** Asks Spot to tailor this provider's first email, once; the composer shows the template meanwhile. */
export const requestTailored = mutation({
  args: { requestId: v.id("procurementRequests"), brokerOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireDirectOperatorWrite(ctx, operator.userId);
    if (!(await providerEmailDraftContext(ctx, args.requestId, args.brokerOrgId))) {
      return { queued: false, status: null };
    }
    return await queueProviderOutreachDraft(ctx, args);
  },
});

/** Claims the one generation for a pending draft and returns what it may draw on. */
export const tailorContextInternal = internalMutation({
  args: { draftId: v.id("providerOutreachDrafts") },
  handler: async (ctx, { draftId }) => {
    const draft = await ctx.db.get(draftId);
    if (!draft?.brokerOrgId || draft.status !== "pending" || draft.generationStartedAt !== undefined) return null;
    await ctx.db.patch(draft._id, { generationStartedAt: dayjs().valueOf() });
    const context = await providerEmailDraftContext(ctx, draft.requestId, draft.brokerOrgId).catch(() => null);
    if (!context) {
      await ctx.db.patch(draft._id, { status: "failed", updatedAt: dayjs().valueOf() });
      return null;
    }
    return { ...context, prompts: await loadEmailPrompts(ctx) };
  },
});

/** Stores the tailored email unless the AI panel wrote one meanwhile; an invalid one leaves the template. */
export const saveTailoredInternal = internalMutation({
  args: {
    draftId: v.id("providerOutreachDrafts"),
    email: v.optional(v.object({ subject: v.string(), body: v.string() })),
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.status !== "pending") return;
    const email = args.email ? normalizedDraftEmail(args.email) : null;
    await ctx.db.patch(
      draft._id,
      email && !providerDraftProblem(email)
        ? { status: "ready", ...email, source: "spot", updatedAt: dayjs().valueOf() }
        : { status: "failed", updatedAt: dayjs().valueOf() },
    );
  },
});
